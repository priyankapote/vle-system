const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const { read, transact } = require("../db");
const { uid } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const { hasActiveWork } = require("../utils/workflow");

const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "..", "uploads"),
    filename: (req, file, cb) => cb(null, uid() + path.extname(file.originalname || "")),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
});

function strip(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

// GET /api/users  (admin only) - list all users, never includes password hashes
router.get("/", requireAuth, requireRole("admin"), (req, res) => {
  const db = read();
  const { profile_type } = req.query;
  let users = db.users;
  if (profile_type) users = users.filter((u) => u.profile_type === profile_type);
  res.json(users.map(strip));
});

// GET /api/users/delivery-personnel (admin only) - for assignment dropdown
router.get("/delivery-personnel", requireAuth, requireRole("admin", "member"), (req, res) => {
  const db = read();
  const list = db.users.filter((u) => u.profile_type === "delivery").map(strip);
  res.json(list);
});

// PUT /api/users/me - self edit (non-role fields only)
router.put("/me", requireAuth, upload.single("photo"), (req, res) => {
  const { full_name, nickname, phone, email, address } = req.body;
  const updated = transact((db) => {
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) throw { status: 404, message: "User not found." };
    if (full_name) user.full_name = full_name;
    if (nickname !== undefined) user.nickname = nickname || null;
    if (phone) user.phone = phone;
    if (email) user.email = email;
    if (address !== undefined) user.address = address;
    if (req.file) user.photo = `/uploads/${req.file.filename}`;
    user.updated_at = new Date().toISOString();
    return user;
  });
  res.json(strip(updated));
});

// PUT /api/users/me/delivery-status - delivery person updates own availability.
// Locked while there's an active outbound run, collection or refill trip — that
// transitions automatically once the job finishes.
router.put("/me/delivery-status", requireAuth, requireRole("delivery"), (req, res) => {
  const { delivery_status } = req.body;
  const allowed = ["Available", "Off Duty"]; // "On Delivery" is set automatically
  if (!allowed.includes(delivery_status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(", ")}` });
  }
  try {
    const updated = transact((db) => {
      const user = db.users.find((u) => u.id === req.user.id);
      if (!user) throw { status: 404, message: "User not found." };
      if (user.delivery_status !== delivery_status && hasActiveWork(db, user.id)) {
        throw { status: 400, message: "You have an active delivery or collection in progress — status will update automatically once it's done." };
      }
      user.delivery_status = delivery_status;
      user.updated_at = new Date().toISOString();
      return user;
    });
    res.json(strip(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// PUT /api/users/:id (admin only) - full edit including role/profile_type
router.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const updated = transact((db) => {
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) throw { status: 404, message: "User not found." };
      const fields = ["full_name", "nickname", "phone", "email", "address", "role_in_business", "delivery_status"];
      for (const f of fields) {
        if (req.body[f] !== undefined) user[f] = req.body[f];
      }
      if (req.body.new_password) {
        user.password_hash = bcrypt.hashSync(req.body.new_password, 10);
      }
      user.updated_at = new Date().toISOString();
      return user;
    });
    res.json(strip(updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// DELETE /api/users/:id (admin only)
router.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    transact((db) => {
      const idx = db.users.findIndex((u) => u.id === req.params.id);
      if (idx === -1) throw { status: 404, message: "User not found." };
      if (db.users[idx].id === req.user.id) throw { status: 400, message: "You cannot delete your own admin account." };
      if (hasActiveWork(db, req.params.id)) throw { status: 400, message: "This delivery person has an active job. Wait until it is finished." };
      const cust = db.customers.find((c) => c.user_id === req.params.id);
      if (cust && db.orders.some((o) => o.customer_id === cust.id && (o.status === "Requested" || o.status === "Order Placed"))) {
        throw { status: 400, message: "This customer has an open order. Resolve it before deleting." };
      }
      db.users.splice(idx, 1);
      // Also remove linked customer record if any
      db.customers = db.customers.filter((c) => c.user_id !== req.params.id);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Delete failed." });
  }
});

module.exports = router;
