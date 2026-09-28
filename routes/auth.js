const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const { read, transact, nextSeq } = require("../db");
const { uid, customerId } = require("../utils/id");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "..", "uploads"),
    filename: (req, file, cb) => {
      cb(null, uid() + path.extname(file.originalname || ""));
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
});

const VALID_PROFILE_TYPES = ["admin", "member", "delivery", "customer"];
const VALID_CUSTOMER_TYPES = [
  "Hospital",
  "Welding and Metal Fabrication",
  "Chemical Plants",
  "Mountaineering",
  "Scuba Diving",
  "Marine Operations",
];

function inviteCodeFor(profile_type) {
  if (profile_type === "admin") return process.env.ADMIN_INVITE_CODE;
  if (profile_type === "member") return process.env.STAFF_INVITE_CODE;
  if (profile_type === "delivery") return process.env.DELIVERY_INVITE_CODE;
  return null; // customer signup is open
}

// POST /api/auth/signup
router.post("/signup", upload.single("photo"), (req, res) => {
  try {
    const {
      full_name,
      nickname,
      phone,
      email,
      address,
      role_in_business,
      profile_type,
      password,
      invite_code,
      customer_type,
    } = req.body;

    if (!full_name || !password || !profile_type) {
      return res.status(400).json({ error: "Full name, password and profile type are required." });
    }
    if (!phone && !email) {
      return res.status(400).json({ error: "Provide at least an email or a phone number." });
    }
    if (!VALID_PROFILE_TYPES.includes(profile_type)) {
      return res.status(400).json({ error: "Invalid profile type." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const neededCode = inviteCodeFor(profile_type);
    if (neededCode && invite_code !== neededCode) {
      return res.status(403).json({
        error: `A valid invite code from an existing admin is required to sign up as ${profile_type}.`,
      });
    }
    if (profile_type === "customer") {
      if (!customer_type || !VALID_CUSTOMER_TYPES.includes(customer_type)) {
        return res.status(400).json({ error: "Please select a valid customer/industry type." });
      }
      if (!address) {
        return res.status(400).json({ error: "Address is required for customer accounts." });
      }
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();

    const result = transact((db) => {
      const emailTaken = email && db.users.some((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
      const phoneTaken = phone && db.users.some((u) => u.phone === phone);
      if (emailTaken) throw { status: 409, message: "An account with this email already exists." };
      if (phoneTaken) throw { status: 409, message: "An account with this phone number already exists." };

      const user = {
        id: uid(),
        full_name,
        nickname: nickname || null,
        photo: req.file ? `/uploads/${req.file.filename}` : null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        role_in_business: role_in_business || null,
        profile_type,
        password_hash,
        delivery_status: profile_type === "delivery" ? "Available" : null,
        created_at: now,
        updated_at: now,
      };
      db.users.push(user);

      let customer = null;
      if (profile_type === "customer") {
        const seq = nextSeq(db, "customer");
        customer = {
          id: customerId(seq),
          user_id: user.id,
          customer_type,
          created_at: now,
          updated_at: now,
        };
        db.customers.push(customer);
      }
      return { user, customer };
    });

    const { password_hash: _omit, ...safeUser } = result.user;
    const token = signToken(result.user);
    res.status(201).json({ token, user: safeUser, customer: result.customer });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Signup failed. Please try again." });
  }
});

// POST /api/auth/login  { identifier, password, profile_type }
router.post("/login", (req, res) => {
  const { identifier, password, profile_type } = req.body;
  if (!identifier || !password || !profile_type) {
    return res.status(400).json({ error: "Identifier, password and profile type are required." });
  }
  const db = read();
  const user = db.users.find(
    (u) =>
      u.profile_type === profile_type &&
      ((u.email && u.email.toLowerCase() === String(identifier).toLowerCase()) || u.phone === identifier)
  );
  if (!user) return res.status(401).json({ error: "No matching account found." });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect password." });
  }
  const { password_hash, ...safeUser } = user;
  const token = signToken(user);
  res.json({ token, user: safeUser });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  const db = read();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  const { password_hash, ...safeUser } = user;
  let customer = null;
  if (user.profile_type === "customer") {
    customer = db.customers.find((c) => c.user_id === user.id) || null;
  }
  res.json({ user: safeUser, customer });
});

module.exports = router;
