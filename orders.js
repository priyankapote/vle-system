const express = require("express");
const PDFDocument = require("pdfkit");
const { read, transact, nextSeq } = require("../db");
const { orderId } = require("../utils/id");
const { requireAuth, requireRole } = require("../middleware/auth");
const { buildBill, renderBillPdf } = require("../utils/bill");
const W = require("../utils/workflow");

const router = express.Router();

// Adds customer details plus, for the current viewer:
//  - the delivery person's contact while cylinders are on the way
//  - the pickup person's contact while an empty-cylinder pickup is arranged
// Customers see a cylinder as "Returned" as soon as it has been collected from them, even though
// staff keep tracking it until it is dropped at the store.
function enrich(db, order, role) {
  const { customer, user } = W.customerOf(db, order);
  const items = (order.items || []).map((it) => {
    const dTask = it.delivery_task_id ? db.tasks.find((t) => t.id === it.delivery_task_id) : null;
    const pTask = it.pickup_task_id ? db.tasks.find((t) => t.id === it.pickup_task_id) : null;
    const dp = dTask ? db.users.find((u) => u.id === dTask.delivery_person_id) : null;
    const pp = pTask ? db.users.find((u) => u.id === pTask.delivery_person_id) : null;
    const onTheWay = it.status === "On the Way" && dTask && dTask.status === "In Transit" && dp;
    const pickupArranged = it.status === "Empty - Ready to Be Collected" && pTask && pTask.status === "Assigned" && pp;
    const out = {
      ...it,
      delivery_person_name: dp ? dp.full_name : null,
      pickup_person_name: pp ? pp.full_name : null,
      delivery_contact: onTheWay ? { name: dp.full_name, phone: dp.phone, photo: dp.photo } : null,
      pickup_contact: pickupArranged ? { name: pp.full_name, phone: pp.phone, photo: pp.photo } : null,
    };
    if (role === "customer" && it.status === "Collected") {
      out.status = "Returned";
      out.returned_at = it.collected_at;
    }
    return out;
  });
  return {
    ...order,
    items,
    customer_name: user ? user.full_name : null,
    customer_address: user ? user.address : null,
    customer_phone: user ? user.phone : null,
    customer_type: customer ? customer.customer_type : null,
    pending_amount: W.round2((order.total_amount || 0) - (order.amount_paid || 0)),
  };
}

function canAccess(db, user, order) {
  if (user.profile_type === "admin" || user.profile_type === "member") return true;
  if (user.profile_type === "customer") {
    const c = db.customers.find((x) => x.user_id === user.id);
    return !!c && order.customer_id === c.id;
  }
  return false;
}

// GET /api/orders - optional filters: customer_id, gas_type, size, from, to (dates)
router.get("/", requireAuth, requireRole("admin", "member", "customer"), (req, res) => {
  const db = read();
  let list = db.orders;
  if (req.user.profile_type === "customer") {
    const c = db.customers.find((x) => x.user_id === req.user.id);
    list = c ? list.filter((o) => o.customer_id === c.id) : [];
  }
  const { customer_id, gas_type, size, from, to } = req.query;
  if (customer_id) list = list.filter((o) => o.customer_id === customer_id);
  if (gas_type || size) {
    list = list.filter((o) => (o.lines || []).some((l) => (!gas_type || l.gas_type === gas_type) && (!size || l.size === size)));
  }
  if (from) list = list.filter((o) => o.created_at >= from);
  if (to) list = list.filter((o) => o.created_at <= to + "T23:59:59.999Z");
  res.json(list.map((o) => enrich(db, o, req.user.profile_type)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
});

// POST /api/orders - place an order (with deposit). Body: { lines: [{type_id, quantity}], deposit_amount, customer_id? }
// Customers create a *request* that staff/admin must approve. If they ask for more than is
// available, the request is auto-rejected on the spot with a message. Orders placed by staff/admin
// on a customer's behalf are approved immediately (or refused with the same message).
router.post("/", requireAuth, requireRole("customer", "admin", "member"), (req, res) => {
  try {
    const { deposit_amount, customer_id } = req.body;
    const rawLines = Array.isArray(req.body.lines)
      ? req.body.lines
      : req.body.type_id ? [{ type_id: req.body.type_id, quantity: req.body.quantity }] : [];
    if (!rawLines.length) return res.status(400).json({ error: "Add at least one cylinder type to the order." });

    const order = transact((db) => {
      // Combine repeated types into one line.
      const merged = new Map();
      for (const l of rawLines) {
        const type = db.cylinder_types.find((t) => t.id === l.type_id);
        if (!type) throw { status: 400, message: "Please choose a cylinder type for every line." };
        const q = parseInt(l.quantity, 10);
        if (!q || q < 1) throw { status: 400, message: "Every line needs a quantity of at least 1." };
        merged.set(type.id, (merged.get(type.id) || 0) + q);
      }
      const lines = [...merged].map(([id, q]) => {
        const t = db.cylinder_types.find((x) => x.id === id);
        return { type_id: t.id, gas_type: t.gas_type, size: t.size, quantity: q, unit_price: t.price, line_total: W.round2(t.price * q) };
      });
      const qty = lines.reduce((n, l) => n + l.quantity, 0);
      const total = W.round2(lines.reduce((n, l) => n + l.line_total, 0));

      const pct = db.settings.min_deposit_percent;
      const minDeposit = W.round2((total * pct) / 100);
      const deposit = Number(deposit_amount);
      if (deposit_amount === undefined || deposit_amount === null || deposit_amount === "" || !isFinite(deposit)) {
        throw { status: 400, message: "Enter the deposit amount." };
      }
      if (deposit < minDeposit - 0.005 || deposit > total + 0.005) {
        throw { status: 400, message: `Deposit must be between Rs. ${minDeposit} and Rs. ${total}.` };
      }

      let custId = customer_id;
      if (req.user.profile_type === "customer") {
        const c = db.customers.find((x) => x.user_id === req.user.id);
        if (!c) throw { status: 404, message: "Customer record not found for your account." };
        custId = c.id;
      } else {
        if (!custId) throw { status: 400, message: "Please choose a customer." };
        if (!db.customers.some((c) => c.id === custId)) throw { status: 404, message: "Customer not found." };
      }

      const now = W.nowIso();
      const o = {
        id: orderId(nextSeq(db, "order")),
        customer_id: custId,
        gas_type: lines[0].gas_type,   // kept for older data; lines[] is the source of truth
        size: lines[0].size,
        quantity: qty,
        unit_price: lines.length === 1 ? lines[0].unit_price : null,
        lines,
        total_amount: total,
        min_deposit_percent: pct,
        min_deposit_amount: minDeposit,
        deposit_amount: W.round2(deposit),
        amount_paid: W.round2(deposit),
        status: "Requested",
        items: [],
        rejection_reason: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
        history: [],
      };
      W.pushHistory(o, "Requested");
      db.orders.push(o);

      const short = W.stockShortfalls(db, o);
      if (req.user.profile_type === "customer") {
        if (short.length) {
          W.rejectOrder(db, o, W.shortageMessage(short), true); // auto-reject right away
        } else {
          const { user: custUser } = W.customerOf(db, o);
          W.notifyAdminsAndStaff(
            db,
            `New order request ${o.id}: ${custUser ? custUser.full_name : "a customer"} wants ${W.linesText(o)} — total Rs. ${total}, deposit paid Rs. ${o.deposit_amount}.`,
            { kind: "order_request", order_id: o.id }
          );
        }
      } else {
        if (short.length) throw { status: 400, message: W.shortageMessage(short) };
        W.acceptOrder(db, o);
      }
      return o;
    });
    res.status(201).json(enrich(read(), order, req.user.profile_type));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not place order." });
  }
});

// PUT /api/orders/:id/accept - staff/admin approve a request. Auto-rejects if stock is short.
router.put("/:id/accept", requireAuth, requireRole("admin", "member"), (req, res) => {
  try {
    const result = transact((db) => {
      const o = db.orders.find((x) => x.id === req.params.id);
      if (!o) throw { status: 404, message: "Order not found." };
      if (o.status !== "Requested") throw { status: 400, message: `This order is already "${o.status}".` };
      const accepted = W.acceptOrder(db, o);
      return { order: o, accepted };
    });
    res.json({ order: enrich(read(), result.order, req.user.profile_type), accepted: result.accepted });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not accept order." });
  }
});

// PUT /api/orders/:id/reject { reason } - staff/admin reject a request; a reason is required.
router.put("/:id/reject", requireAuth, requireRole("admin", "member"), (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Please enter a reason for rejecting this order." });
    const order = transact((db) => {
      const o = db.orders.find((x) => x.id === req.params.id);
      if (!o) throw { status: 404, message: "Order not found." };
      if (o.status !== "Requested") throw { status: 400, message: `This order is already "${o.status}".` };
      W.rejectOrder(db, o, reason.slice(0, 300), false);
      return o;
    });
    res.json(enrich(read(), order, req.user.profile_type));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not reject order." });
  }
});

// PUT /api/orders/:id/assign-delivery { delivery_person_id } - staff/admin
router.put("/:id/assign-delivery", requireAuth, requireRole("admin", "member"), (req, res) => {
  try {
    const order = transact((db) => {
      const o = db.orders.find((x) => x.id === req.params.id);
      if (!o) throw { status: 404, message: "Order not found." };
      const waiting = o.items.filter((i) => i.status === "Order Placed");
      if (o.status !== "Order Placed" || waiting.length === 0) throw { status: 400, message: "This order has no cylinders waiting for a delivery person." };
      const dp = W.getAvailableDeliveryPerson(db, req.body.delivery_person_id);

      const now = W.nowIso();
      const task = W.createTask(db, {
        type: "delivery",
        delivery_person_id: dp.id,
        order_id: o.id,
        status: "Assigned",
        items: waiting.map((i) => ({
          cylinder_id: i.cylinder_id, batch_number: i.batch_number, reference_number: i.reference_number,
          gas_type: i.gas_type, size: i.size, status: "Available",
        })),
      });
      for (const i of waiting) {
        i.status = "Delivery Assigned";
        i.delivery_task_id = task.id;
        const c = W.findCylinder(db, i.cylinder_id);
        if (c) { c.delivery_assigned_to = dp.id; c.updated_at = now; }
      }
      dp.delivery_status = "On Delivery";
      dp.updated_at = now;
      o.updated_at = now;
      W.notify(db, dp.id, `You have been assigned a delivery: ${W.itemsText(waiting)} for order ${o.id}.`, { kind: "task_assigned", order_id: o.id });
      const { user } = W.customerOf(db, o);
      W.notify(db, user && user.id, `A delivery person has been assigned to your order ${o.id}.`, { kind: "order_update", order_id: o.id });
      return o;
    });
    res.json(enrich(read(), order, req.user.profile_type));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Assignment failed." });
  }
});

// PUT /api/orders/:id/cylinders/:cid/mark-empty - the customer who owns the order, or an admin.
router.put("/:id/cylinders/:cid/mark-empty", requireAuth, requireRole("customer", "admin"), (req, res) => {
  try {
    const order = transact((db) => {
      const o = db.orders.find((x) => x.id === req.params.id);
      if (!o) throw { status: 404, message: "Order not found." };
      if (!canAccess(db, req.user, o)) throw { status: 403, message: "This is not your order." };
      const item = o.items.find((i) => i.cylinder_id === req.params.cid);
      if (!item) throw { status: 404, message: "Cylinder not found in this order." };
      if (item.status !== "In Use") throw { status: 400, message: `Cylinder must be In Use, currently "${item.status}".` };
      const now = W.nowIso();
      item.status = "Empty - Ready to Be Collected";
      const c = W.findCylinder(db, item.cylinder_id);
      if (c) { c.status = "Empty - Ready to Be Collected"; c.updated_at = now; }
      o.updated_at = now;
      const { user } = W.customerOf(db, o);
      W.notifyAdminsAndStaff(
        db,
        `${user ? user.full_name : "A customer"}'s ${item.size} ${item.gas_type} cylinder (${item.cylinder_id}, order ${o.id}) is empty and ready to be collected.`,
        { kind: "cylinder_empty", order_id: o.id }
      );
      return o;
    });
    res.json(enrich(read(), order, req.user.profile_type));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

// PUT /api/orders/:id/assign-pickup { delivery_person_id } - staff/admin send someone to collect
// every empty cylinder of this order that has no pickup arranged yet.
router.put("/:id/assign-pickup", requireAuth, requireRole("admin", "member"), (req, res) => {
  try {
    const order = transact((db) => {
      const o = db.orders.find((x) => x.id === req.params.id);
      if (!o) throw { status: 404, message: "Order not found." };
      const empties = o.items.filter((i) => i.status === "Empty - Ready to Be Collected" && !i.pickup_task_id);
      if (empties.length === 0) throw { status: 400, message: "No empty cylinders are waiting for a pickup in this order." };
      const dp = W.getAvailableDeliveryPerson(db, req.body.delivery_person_id);

      const now = W.nowIso();
      const task = W.createTask(db, {
        type: "pickup",
        delivery_person_id: dp.id,
        order_id: o.id,
        status: "Assigned",
        items: empties.map((i) => ({
          cylinder_id: i.cylinder_id, batch_number: i.batch_number, reference_number: i.reference_number,
          gas_type: i.gas_type, size: i.size, status: "Ready to Collect",
        })),
      });
      for (const i of empties) {
        i.pickup_task_id = task.id;
        const c = W.findCylinder(db, i.cylinder_id);
        if (c) { c.delivery_assigned_to = dp.id; c.updated_at = now; }
      }
      dp.delivery_status = "On Delivery";
      dp.updated_at = now;
      W.notify(db, dp.id, `You have been assigned a pickup: collect ${W.itemsText(empties)} (empty) for order ${o.id}, then drop them at the store.`, { kind: "task_assigned", order_id: o.id });
      const { user: pickupCust } = W.customerOf(db, o);
      W.notify(db, pickupCust && pickupCust.id, `A pickup person has been assigned to collect your empty cylinder(s) for order ${o.id}.`, { kind: "order_update", order_id: o.id });
      return o;
    });
    res.json(enrich(read(), order, req.user.profile_type));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Assignment failed." });
  }
});

// ---------- Bills ----------
function loadBillableOrder(req, res) {
  const db = read();
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) { res.status(404).json({ error: "Order not found." }); return null; }
  if (!canAccess(db, req.user, o)) { res.status(403).json({ error: "You do not have permission to view this bill." }); return null; }
  if (o.status === "Requested" || o.status === "Rejected") {
    res.status(400).json({ error: "A bill is only available once the order has been accepted." });
    return null;
  }
  return { db, o };
}

router.get("/:id/bill", requireAuth, requireRole("admin", "member", "customer"), (req, res) => {
  const ctx = loadBillableOrder(req, res);
  if (ctx) res.json(buildBill(ctx.db, ctx.o));
});

router.get("/:id/bill.pdf", requireAuth, requireRole("admin", "member", "customer"), (req, res) => {
  const ctx = loadBillableOrder(req, res);
  if (!ctx) return;
  const bill = buildBill(ctx.db, ctx.o);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Bill-${bill.invoice_no}.pdf"`);
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Bill ${bill.invoice_no}`, Author: bill.business.name } });
  doc.pipe(res);
  renderBillPdf(doc, bill);
  doc.end();
});

// PUT /api/orders/:id/bill { total_amount, amount_paid } - admin only
router.put("/:id/bill", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const total = Number(req.body.total_amount);
    const paid = Number(req.body.amount_paid);
    if (!isFinite(total) || total < 0 || !isFinite(paid) || paid < 0) return res.status(400).json({ error: "Enter valid amounts." });
    if (paid > total + 0.005) return res.status(400).json({ error: "Amount paid cannot be more than the total bill." });
    const order = transact((db) => {
      const o = db.orders.find((x) => x.id === req.params.id);
      if (!o) throw { status: 404, message: "Order not found." };
      if (o.status === "Requested" || o.status === "Rejected") throw { status: 400, message: "Only accepted orders have a bill." };
      o.total_amount = W.round2(total);
      o.amount_paid = W.round2(paid);
      o.bill_adjusted = true;
      o.updated_at = W.nowIso();
      W.pushHistory(o, o.status, `Bill amounts edited by admin: total Rs. ${o.total_amount}, paid Rs. ${o.amount_paid}`);
      return o;
    });
    res.json(enrich(read(), order, req.user.profile_type));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Update failed." });
  }
});

module.exports = router;
