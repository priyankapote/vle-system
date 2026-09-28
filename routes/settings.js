const express = require("express");
const { read, transact } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/settings/public - no login needed (landing/login pages show the business name)
router.get("/public", (req, res) => {
  res.json({ business_name: read().settings.business_name });
});

// GET /api/settings - any logged-in user (customers need the deposit % when ordering)
router.get("/", requireAuth, (req, res) => {
  res.json(read().settings);
});

// PUT /api/settings - admin only
router.put("/", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { business_name, min_deposit_percent, business_address, business_phone, business_gstin } = req.body;
    const updated = transact((db) => {
      const s = db.settings;
      if (business_name !== undefined) {
        const name = String(business_name).trim();
        if (!name) throw { status: 400, message: "Business name cannot be empty." };
        if (name.length > 80) throw { status: 400, message: "Business name is too long (max 80 characters)." };
        s.business_name = name;
      }
      if (min_deposit_percent !== undefined) {
        const p = Number(min_deposit_percent);
        if (!isFinite(p) || p < 0 || p > 100) throw { status: 400, message: "Minimum deposit must be between 0% and 100%." };
        s.min_deposit_percent = Math.round(p * 100) / 100;
      }
      if (business_address !== undefined) s.business_address = String(business_address).trim().slice(0, 300);
      if (business_phone !== undefined) s.business_phone = String(business_phone).trim().slice(0, 40);
      if (business_gstin !== undefined) s.business_gstin = String(business_gstin).trim().slice(0, 40);
      return s;
    });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

module.exports = router;
