const express = require("express");
const { read, transact, nextSeq } = require("../db");
const { typeId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/types - everyone logged in (staff pick from it when adding cylinders, customers see prices)
// "available" = in stock and not reserved for an accepted order, so order forms can show it.
router.get("/", requireAuth, (req, res) => {
  const db = read();
  res.json(db.cylinder_types.map((t) => ({
    ...t,
    available: db.cylinders.filter((c) => c.gas_type === t.gas_type && c.size === t.size && c.status === "In Stock" && !c.order_id).length,
  })));
});

// POST /api/types - admin only: add a new cylinder type with its price
router.post("/", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const gas_type = String(req.body.gas_type || "").trim();
    const size = String(req.body.size || "").trim();
    const price = Number(req.body.price);
    if (!gas_type || !size) return res.status(400).json({ error: "Gas type and size are required." });
    if (!isFinite(price) || price <= 0) return res.status(400).json({ error: "Enter a price greater than 0." });
    const created = transact((db) => {
      if (db.cylinder_types.some((t) => t.gas_type.toLowerCase() === gas_type.toLowerCase() && t.size.toLowerCase() === size.toLowerCase())) {
        throw { status: 409, message: "That cylinder type already exists." };
      }
      const t = { id: typeId(nextSeq(db, "type")), gas_type, size, price: Math.round(price * 100) / 100 };
      db.cylinder_types.push(t);
      return t;
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not add type." });
  }
});

// PUT /api/types/:id - admin only: change the price (existing orders keep the price they were placed at)
router.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const price = Number(req.body.price);
    if (!isFinite(price) || price <= 0) return res.status(400).json({ error: "Enter a price greater than 0." });
    const updated = transact((db) => {
      const t = db.cylinder_types.find((x) => x.id === req.params.id);
      if (!t) throw { status: 404, message: "Cylinder type not found." };
      t.price = Math.round(price * 100) / 100;
      return t;
    });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

module.exports = router;
