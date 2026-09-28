const express = require("express");
const { read, transact } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const W = require("../utils/workflow");

const router = express.Router();

// Adds order/customer info so the delivery person sees where to go and what to collect.
function enrich(db, t) {
  const dp = db.users.find((u) => u.id === t.delivery_person_id);
  const out = { ...t, delivery_person_name: dp ? dp.full_name : null };
  if (t.order_id) {
    const o = db.orders.find((x) => x.id === t.order_id);
    if (o) {
      const { user } = W.customerOf(db, o);
      out.customer_name = user ? user.full_name : null;
      out.customer_address = user ? user.address : null;
      out.customer_phone = user ? user.phone : null;
      out.total_amount = o.total_amount;
      out.amount_paid = o.amount_paid;
      out.balance_due = W.round2((o.total_amount || 0) - (o.amount_paid || 0));
    }
  }
  return out;
}

function loadTask(db, req, expectedType, expectedStatus) {
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) throw { status: 404, message: "Job not found." };
  if (req.user.profile_type === "delivery" && t.delivery_person_id !== req.user.id) {
    throw { status: 403, message: "This job is not assigned to you." };
  }
  if (t.type !== expectedType) throw { status: 400, message: `This action is only for ${expectedType} jobs.` };
  if (t.status !== expectedStatus) throw { status: 400, message: `Job must be "${expectedStatus}", currently "${t.status}".` };
  return t;
}

// GET /api/tasks - delivery people see only their own; admin/staff see all. Filters: type, state=active|history
router.get("/", requireAuth, requireRole("admin", "member", "delivery"), (req, res) => {
  const db = read();
  let list = db.tasks;
  if (req.user.profile_type === "delivery") list = list.filter((t) => t.delivery_person_id === req.user.id);
  const { type, state } = req.query;
  if (type) list = list.filter((t) => t.type === type);
  if (state === "active") list = list.filter(W.isTaskActive);
  if (state === "history") list = list.filter((t) => !W.isTaskActive(t));
  res.json(list.map((t) => enrich(db, t)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
});

// PUT /api/tasks/:id/start - delivery person picks the cylinders up from the store: now In Transit.
router.put("/:id/start", requireAuth, requireRole("delivery", "admin"), (req, res) => {
  try {
    const task = transact((db) => {
      const t = loadTask(db, req, "delivery", "Assigned");
      const now = W.nowIso();
      W.setTaskStatus(t, "In Transit", "In Transit");
      const o = db.orders.find((x) => x.id === t.order_id);
      for (const ti of t.items) {
        const c = W.findCylinder(db, ti.cylinder_id);
        if (c) { c.status = "In Transit"; c.updated_at = now; }
        const oi = o && o.items.find((i) => i.cylinder_id === ti.cylinder_id && i.delivery_task_id === t.id);
        if (oi) oi.status = "On the Way";
      }
      if (o) {
        o.updated_at = now;
        const { user } = W.customerOf(db, o);
        const dp = db.users.find((u) => u.id === t.delivery_person_id);
        W.notify(db, user && user.id, `Your order ${o.id} is on the way with ${dp ? dp.full_name : "our delivery person"}.`, { kind: "order_update", order_id: o.id });
      }
      return t;
    });
    res.json(enrich(read(), task));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// PUT /api/tasks/:id/delivered { payment_verified }
//  - delivery job: needs the remaining bill paid (proof seen) before handing over.
//  - refill job:   cylinders are back in the store and go to In Stock.
router.put("/:id/delivered", requireAuth, requireRole("delivery", "admin"), (req, res) => {
  try {
    const task = transact((db) => {
      const t = db.tasks.find((x) => x.id === req.params.id);
      if (!t) throw { status: 404, message: "Job not found." };
      const now = W.nowIso();

      if (t.type === "refill") {
        const t2 = loadTask(db, req, "refill", "Refilling");
        W.setTaskStatus(t2, "Delivered", "Delivered");
        for (const ti of t2.items) {
          const c = W.findCylinder(db, ti.cylinder_id);
          if (c) { c.status = "In Stock"; c.delivery_assigned_to = null; c.order_id = null; c.updated_at = now; }
        }
        W.recalcDeliveryAvailability(db, t2.delivery_person_id);
        return t2;
      }

      const t2 = loadTask(db, req, "delivery", "In Transit");
      const o = db.orders.find((x) => x.id === t2.order_id);
      const balance = o ? W.round2((o.total_amount || 0) - (o.amount_paid || 0)) : 0;
      if (balance > 0.005 && req.body.payment_verified !== true) {
        throw { status: 400, message: `Confirm that you have seen proof of the remaining payment of Rs. ${balance} before handing over.` };
      }
      W.setTaskStatus(t2, "Delivered", "Delivered");
      for (const ti of t2.items) {
        const c = W.findCylinder(db, ti.cylinder_id);
        if (c) { c.status = "In Use"; c.updated_at = now; }
        const oi = o && o.items.find((i) => i.cylinder_id === ti.cylinder_id && i.delivery_task_id === t2.id);
        if (oi) oi.status = "In Use";
      }
      if (o) {
        if (balance > 0.005) o.amount_paid = o.total_amount; // remaining bill collected on delivery
        o.delivered_at = now;
        o.updated_at = now;
        const { user } = W.customerOf(db, o);
        W.notify(db, user && user.id, `Your order ${o.id} has been delivered. Your bill is ready.`, { kind: "order_update", order_id: o.id });
      }
      W.recalcDeliveryAvailability(db, t2.delivery_person_id);
      return t2;
    });
    res.json(enrich(read(), task));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// PUT /api/tasks/:id/collected - delivery person has collected the empty cylinder(s) from the customer.
// For the customer this ends their journey ("Returned"). Staff keep tracking the cylinders as they are
// carried back; nothing can be sent for refilling until they are dropped at the store.
router.put("/:id/collected", requireAuth, requireRole("delivery", "admin"), (req, res) => {
  try {
    const task = transact((db) => {
      const t = loadTask(db, req, "pickup", "Assigned");
      const now = W.nowIso();
      W.setTaskStatus(t, "Collected", "Collected");
      const o = db.orders.find((x) => x.id === t.order_id);
      for (const ti of t.items) {
        const c = W.findCylinder(db, ti.cylinder_id);
        if (c) { c.status = "Returning to Store"; c.updated_at = now; }
        const oi = o && o.items.find((i) => i.cylinder_id === ti.cylinder_id && i.pickup_task_id === t.id);
        if (oi) { oi.status = "Collected"; oi.collected_at = now; }
      }
      if (o) {
        o.updated_at = now;
        const { user } = W.customerOf(db, o);
        W.notify(db, user && user.id, `Your empty cylinder(s) for order ${o.id} have been collected. Thank you!`, { kind: "order_update", order_id: o.id });
      }
      return t;
    });
    res.json(enrich(read(), task));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// PUT /api/tasks/:id/dropped - the delivery person has dropped the empty cylinder(s) at the store.
// Only now does the order finish for staff, and the cylinders become "Ready to Refill".
router.put("/:id/dropped", requireAuth, requireRole("delivery", "admin"), (req, res) => {
  try {
    const task = transact((db) => {
      const t = loadTask(db, req, "pickup", "Collected");
      const now = W.nowIso();
      W.setTaskStatus(t, "Dropped", "Dropped at Store");
      const o = db.orders.find((x) => x.id === t.order_id);
      for (const ti of t.items) {
        const c = W.findCylinder(db, ti.cylinder_id);
        if (c) { c.status = "Ready to Refill"; c.delivery_assigned_to = null; c.order_id = null; c.updated_at = now; }
        const oi = o && o.items.find((i) => i.cylinder_id === ti.cylinder_id && i.pickup_task_id === t.id);
        if (oi) { oi.status = "Returned"; oi.returned_at = now; }
      }
      if (o) {
        o.updated_at = now;
        W.refreshOrderStatus(db, o);
      }
      W.notifyAdminsAndStaff(db, `${t.items.length} empty cylinder(s) dropped at the store — now Ready to Refill.`, { kind: "ready_to_refill", order_id: t.order_id });
      W.recalcDeliveryAvailability(db, t.delivery_person_id);
      return t;
    });
    res.json(enrich(read(), task));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// POST /api/tasks/refill { cylinder_ids, delivery_person_id } - staff/admin send chosen empties for refilling.
router.post("/refill", requireAuth, requireRole("admin", "member"), (req, res) => {
  try {
    const { cylinder_ids, delivery_person_id } = req.body;
    if (!Array.isArray(cylinder_ids) || cylinder_ids.length === 0) {
      return res.status(400).json({ error: "Select at least one cylinder to send for refilling." });
    }
    const task = transact((db) => {
      const ids = [...new Set(cylinder_ids)];
      const chosen = ids.map((id) => W.findCylinder(db, id));
      if (chosen.some((c) => !c)) throw { status: 404, message: "One or more selected cylinders were not found." };
      if (chosen.some((c) => c.status !== "Ready to Refill")) throw { status: 400, message: "All selected cylinders must be Ready to Refill." };
      const dp = W.getAvailableDeliveryPerson(db, delivery_person_id);

      const now = W.nowIso();
      const t = W.createTask(db, {
        type: "refill",
        delivery_person_id: dp.id,
        order_id: null,
        status: "Refilling",
        items: chosen.map((c) => ({
          cylinder_id: c.id, batch_number: c.batch_number, reference_number: c.reference_number,
          gas_type: c.gas_type, size: c.size, status: "Refilling",
        })),
      });
      for (const c of chosen) { c.status = "Refilling"; c.delivery_assigned_to = dp.id; c.updated_at = now; }
      dp.delivery_status = "On Delivery";
      dp.updated_at = now;
      W.notify(db, dp.id, `You have been assigned a refill run: take ${W.itemsText(chosen)} for refilling and bring them back to the store.`, { kind: "task_assigned" });
      return t;
    });
    res.status(201).json(enrich(read(), task));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not send cylinders for refilling." });
  }
});

module.exports = router;
