const express = require("express");
const { read, transact, nextSeq } = require("../db");
const { cylinderId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Physical cylinder statuses (what admin/staff track).
const STATUSES = [
  "In Stock",
  "In Transit",
  "In Use",
  "Empty - Ready to Be Collected",
  "Returning to Store",
  "Ready to Refill",
  "Refilling",
];

const typeExists = (db, gas_type, size) => db.cylinder_types.some((t) => t.gas_type === gas_type && t.size === size);

// GET /api/cylinders - admin & staff. Optional filters: status, gas_type, size.
router.get("/", requireAuth, requireRole("admin", "member"), (req, res) => {
  const db = read();
  const { status, gas_type, size } = req.query;
  let list = db.cylinders;
  if (status) list = list.filter((c) => c.status === status);
  if (gas_type) list = list.filter((c) => c.gas_type === gas_type);
  if (size) list = list.filter((c) => c.size === size);
  res.json(list);
});

// GET /api/cylinders/summary - one entry per cylinder type, with counts per status.
router.get("/summary", requireAuth, requireRole("admin", "member"), (req, res) => {
  const db = read();
  const groups = {};
  for (const t of db.cylinder_types) {
    groups[`${t.gas_type}|${t.size}`] = {
      type_id: t.id, gas_type: t.gas_type, size: t.size, price: t.price,
      total: 0,
      available: 0,   // In Stock and not reserved for an order
      reserved: 0,    // In Stock but reserved for an accepted order
      out: 0,         // In Transit + In Use + Empty - Ready to Be Collected + Returning to Store
      ready_to_refill: 0,
      refilling: 0,
      by_status: Object.fromEntries(STATUSES.map((s) => [s, 0])),
    };
  }
  for (const c of db.cylinders) {
    const g = groups[`${c.gas_type}|${c.size}`];
    if (!g) continue;
    g.total += 1;
    g.by_status[c.status] = (g.by_status[c.status] || 0) + 1;
    if (c.status === "In Stock") { if (c.order_id) g.reserved += 1; else g.available += 1; }
    else if (["In Transit", "In Use", "Empty - Ready to Be Collected", "Returning to Store"].includes(c.status)) g.out += 1;
    else if (c.status === "Ready to Refill") g.ready_to_refill += 1;
    else if (c.status === "Refilling") g.refilling += 1;
  }
  res.json(Object.values(groups));
});

// POST /api/cylinders - admin or staff, but only for cylinder types the admin has defined
router.post("/", requireAuth, requireRole("admin", "member"), (req, res) => {
  const { batch_number, reference_number, gas_type, size } = req.body;
  if (!batch_number || !gas_type || !size) {
    return res.status(400).json({ error: "Batch number and cylinder type are required." });
  }
  try {
    const cylinder = transact((db) => {
      if (!typeExists(db, gas_type, size)) throw { status: 400, message: "Choose one of the existing cylinder types. Only an admin can add new types." };
      if (db.cylinders.some((c) => c.batch_number === batch_number)) {
        throw { status: 409, message: "A cylinder with this batch number already exists." };
      }
      if (reference_number && db.cylinders.some((c) => c.reference_number === reference_number)) {
        throw { status: 409, message: "This reference number is already in use by another cylinder in the system." };
      }
      const now = new Date().toISOString();
      const c = {
        id: cylinderId(nextSeq(db, "cylinder")),
        batch_number,
        reference_number: reference_number || null,
        gas_type,
        size,
        status: "In Stock",
        order_id: null,
        delivery_assigned_to: null,
        created_at: now,
        updated_at: now,
      };
      db.cylinders.push(c);
      return c;
    });
    res.status(201).json(cylinder);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not add cylinder." });
  }
});

// PUT /api/cylinders/:id - admin only (corrections / manual status override)
router.put("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const updated = transact((db) => {
      const c = db.cylinders.find((x) => x.id === req.params.id);
      if (!c) throw { status: 404, message: "Cylinder not found." };
      const { batch_number, reference_number, gas_type, size, status } = req.body;
      if (batch_number && batch_number !== c.batch_number) {
        if (db.cylinders.some((x) => x.batch_number === batch_number && x.id !== c.id)) throw { status: 409, message: "Batch number already in use." };
        c.batch_number = batch_number;
      }
      if (reference_number !== undefined) {
        if (reference_number && db.cylinders.some((x) => x.reference_number === reference_number && x.id !== c.id)) {
          throw { status: 409, message: "Reference number already in use in the current ecosystem." };
        }
        c.reference_number = reference_number || null;
      }
      if (gas_type || size) {
        const g = gas_type || c.gas_type, s = size || c.size;
        if (!typeExists(db, g, s)) throw { status: 400, message: "That cylinder type does not exist." };
        c.gas_type = g; c.size = s;
      }
      if (status) {
        if (!STATUSES.includes(status)) throw { status: 400, message: "Invalid status." };
        c.status = status;
      }
      c.updated_at = new Date().toISOString();
      return c;
    });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// DELETE /api/cylinders/:id - admin only, and only while In Stock and not reserved
router.delete("/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    transact((db) => {
      const idx = db.cylinders.findIndex((x) => x.id === req.params.id);
      if (idx === -1) throw { status: 404, message: "Cylinder not found." };
      const c = db.cylinders[idx];
      if (c.status !== "In Stock" || c.order_id) {
        throw { status: 400, message: "Only cylinders that are In Stock and not reserved for an order can be removed." };
      }
      db.cylinders.splice(idx, 1);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Delete failed." });
  }
});

module.exports = router;
