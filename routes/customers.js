const express = require("express");
const { read, transact, nextSeq } = require("../db");
const { uid, customerId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const CUSTOMER_TYPES = [
  "Hospital",
  "Welding and Metal Fabrication",
  "Chemical Plants",
  "Mountaineering",
  "Scuba Diving",
  "Marine Operations",
];

function withUserInfo(db, customer) {
  const user = db.users.find((u) => u.id === customer.user_id);
  return {
    ...customer,
    full_name: user ? user.full_name : null,
    phone: user ? user.phone : null,
    email: user ? user.email : null,
    address: user ? user.address : null,
  };
}

// GET /api/customers - admin/member can view all
router.get("/", requireAuth, requireRole("admin", "member"), (req, res) => {
  const db = read();
  res.json(db.customers.map((c) => withUserInfo(db, c)));
});

// GET /api/customers/me
router.get("/me", requireAuth, requireRole("customer"), (req, res) => {
  const db = read();
  const customer = db.customers.find((c) => c.user_id === req.user.id);
  if (!customer) return res.status(404).json({ error: "Customer record not found." });
  res.json(withUserInfo(db, customer));
});

// POST /api/customers - admin/member can create a walk-in customer record (no self-signup)
router.post("/", requireAuth, requireRole("admin", "member"), (req, res) => {
  const { full_name, phone, email, address, customer_type } = req.body;
  if (!full_name || !address || !customer_type) {
    return res.status(400).json({ error: "Name, address and customer type are required." });
  }
  if (!CUSTOMER_TYPES.includes(customer_type)) {
    return res.status(400).json({ error: "Invalid customer type." });
  }
  const result = transact((db) => {
    const now = new Date().toISOString();
    const user = {
      id: uid(),
      full_name,
      nickname: null,
      photo: null,
      phone: phone || null,
      email: email || null,
      address,
      role_in_business: null,
      profile_type: "customer",
      password_hash: null, // walk-in customer with no login account
      delivery_status: null,
      created_at: now,
      updated_at: now,
    };
    db.users.push(user);
    const seq = nextSeq(db, "customer");
    const customer = { id: customerId(seq), user_id: user.id, customer_type, created_at: now, updated_at: now };
    db.customers.push(customer);
    return customer;
  });
  res.status(201).json(withUserInfo(transact((d) => d), result));
});

// PUT /api/customers/me - customer edits own profile fields.
// Registered before the generic "/:id" route below so the literal path "me"
// isn't swallowed as an id (Express matches route patterns in registration order).
router.put("/me", requireAuth, requireRole("customer"), (req, res) => {
  const updated = transact((db) => {
    const c = db.customers.find((x) => x.user_id === req.user.id);
    if (!c) throw { status: 404, message: "Customer record not found." };
    if (req.body.customer_type) c.customer_type = req.body.customer_type;
    c.updated_at = new Date().toISOString();
    const user = db.users.find((u) => u.id === req.user.id);
    const fields = ["full_name", "phone", "email", "address"];
    for (const f of fields) if (req.body[f] !== undefined) user[f] = req.body[f];
    user.updated_at = new Date().toISOString();
    return c;
  });
  res.json(withUserInfo(read(), updated));
});

// PUT /api/customers/:id - admin only for full edits; customer can edit their own via /me
router.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const updated = transact((db) => {
      const c = db.customers.find((x) => x.id === req.params.id);
      if (!c) throw { status: 404, message: "Customer not found." };
      if (req.body.customer_type) {
        if (!CUSTOMER_TYPES.includes(req.body.customer_type)) throw { status: 400, message: "Invalid customer type." };
        c.customer_type = req.body.customer_type;
      }
      c.updated_at = new Date().toISOString();
      const user = db.users.find((u) => u.id === c.user_id);
      if (user) {
        const fields = ["full_name", "phone", "email", "address"];
        for (const f of fields) if (req.body[f] !== undefined) user[f] = req.body[f];
        user.updated_at = new Date().toISOString();
      }
      return c;
    });
    res.json(withUserInfo(read(), updated));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// DELETE /api/customers/:id - admin only
router.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    transact((db) => {
      const idx = db.customers.findIndex((x) => x.id === req.params.id);
      if (idx === -1) throw { status: 404, message: "Customer not found." };
      const hasOpenOrders = db.orders.some(
        (o) => o.customer_id === db.customers[idx].id && (o.status === "Requested" || o.status === "Order Placed")
      );
      if (hasOpenOrders) throw { status: 400, message: "This customer has an open order. Resolve it before deleting." };
      const userId = db.customers[idx].user_id;
      db.customers.splice(idx, 1);
      db.users = db.users.filter((u) => u.id !== userId);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Delete failed." });
  }
});

module.exports = router;
