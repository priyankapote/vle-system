// Shared business logic.
//
// Three separate records track a cylinder, on purpose:
//  1. The physical cylinder (db.cylinders) — live status, seen by admin/staff.
//  2. The customer's order item (order.items[]) — the customer-side journey. Frozen once "Returned".
//  3. The delivery task item (task.items[]) — the delivery person's job. Frozen once the job is done.
// Completed orders and tasks are history: later reuse/refilling of a cylinder never changes them.

const { nextSeq } = require("../db");
const { taskId } = require("./id");

const TASK_DONE = ["Delivered", "Dropped"]; // "Collected" is an in-between step for pickups
const isTaskActive = (t) => !TASK_DONE.includes(t.status);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function nowIso() { return new Date().toISOString(); }

function pushHistory(obj, status, note) {
  obj.history = obj.history || [];
  const entry = { status, at: nowIso() };
  if (note) entry.note = note;
  obj.history.push(entry);
}

function notify(db, userIds, message, meta = {}) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const now = nowIso();
  for (const uid of ids) {
    if (!uid) continue;
    db.notifications.push({
      id: `NTF-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`,
      user_id: uid,
      message,
      read: false,
      created_at: now,
      ...meta,
    });
  }
}

function notifyAdminsAndStaff(db, message, meta = {}) {
  const ids = db.users.filter((u) => u.profile_type === "admin" || u.profile_type === "member").map((u) => u.id);
  notify(db, ids, message, meta);
}

// ----- delivery people -----
function hasActiveWork(db, dpId) {
  return !!dpId && db.tasks.some((t) => t.delivery_person_id === dpId && isTaskActive(t));
}

// Only ever moves someone TO "Available" when their last job ends. Never touches "Off Duty".
function recalcDeliveryAvailability(db, dpId) {
  const dp = db.users.find((u) => u.id === dpId && u.profile_type === "delivery");
  if (!dp || dp.delivery_status !== "On Delivery") return;
  if (!hasActiveWork(db, dpId)) {
    dp.delivery_status = "Available";
    dp.updated_at = nowIso();
  }
}

function getAvailableDeliveryPerson(db, dpId) {
  const dp = db.users.find((u) => u.id === dpId && u.profile_type === "delivery");
  if (!dp) throw { status: 404, message: "Delivery person not found." };
  if (dp.delivery_status !== "Available") throw { status: 400, message: `${dp.full_name} is not currently available.` };
  return dp;
}

// ----- stock -----
function availableCylinders(db, gas_type, size) {
  return db.cylinders.filter((c) => c.gas_type === gas_type && c.size === size && c.status === "In Stock" && !c.order_id);
}

const findCylinder = (db, id) => db.cylinders.find((c) => c.id === id);

// ----- order lines (an order can contain several cylinder types) -----
function linesText(order) {
  return (order.lines || []).map((l) => `${l.quantity} × ${l.size} ${l.gas_type}`).join(", ");
}

function itemsText(items) {
  const counts = {};
  items.forEach((i) => { const k = `${i.size} ${i.gas_type}`; counts[k] = (counts[k] || 0) + 1; });
  return Object.entries(counts).map(([k, n]) => `${n} × ${k}`).join(", ");
}

// Lines whose requested quantity is more than what is available right now.
function stockShortfalls(db, order) {
  const out = [];
  for (const l of order.lines || []) {
    const available = availableCylinders(db, l.gas_type, l.size).length;
    if (available < l.quantity) out.push({ gas_type: l.gas_type, size: l.size, quantity: l.quantity, available });
  }
  return out;
}

function shortageMessage(short) {
  return "Order rejected due to unavailability of cylinders: " +
    short.map((s) => `${s.gas_type} ${s.size} — requested ${s.quantity}, ${s.available > 0 ? "only " + s.available + " available" : "none available"}`).join("; ") + ".";
}

// ----- customers -----
function customerOf(db, order) {
  const customer = db.customers.find((c) => c.id === order.customer_id);
  const user = customer ? db.users.find((u) => u.id === customer.user_id) : null;
  return { customer, user };
}

// ----- orders -----
function rejectOrder(db, order, reason, auto) {
  order.status = "Rejected";
  order.rejection_reason = reason;
  order.auto_rejected = !!auto;
  order.completed_at = nowIso();
  order.updated_at = order.completed_at;
  pushHistory(order, "Rejected", reason);
  const { user } = customerOf(db, order);
  notify(db, user && user.id, `Your order ${order.id} was rejected. Reason: ${reason}`, { kind: "order_rejected", order_id: order.id });
}

// Returns true if accepted. If any line asks for more than is available, the order is
// auto-rejected (false). On acceptance the cylinders are reserved straight away, so the
// "available" and "reserved" numbers are correct for the next person ordering.
function acceptOrder(db, order) {
  const short = stockShortfalls(db, order);
  if (short.length) {
    rejectOrder(db, order, shortageMessage(short), true);
    return false;
  }
  const now = nowIso();
  const items = [];
  for (const l of order.lines) {
    const chosen = availableCylinders(db, l.gas_type, l.size).slice(0, l.quantity);
    for (const c of chosen) {
      c.order_id = order.id; // reserved for this order
      c.updated_at = now;
      items.push({
        cylinder_id: c.id, batch_number: c.batch_number, reference_number: c.reference_number,
        gas_type: c.gas_type, size: c.size, unit_price: l.unit_price, status: "Order Placed",
      });
    }
  }
  order.items = items;
  order.status = "Order Placed";
  order.updated_at = now;
  pushHistory(order, "Order Placed");
  const { user } = customerOf(db, order);
  notify(db, user && user.id, `Your order ${order.id} has been accepted.`, { kind: "order_accepted", order_id: order.id });
  return true;
}

// The order as a whole is finished once every cylinder in it has been returned.
function refreshOrderStatus(db, order) {
  if (order.status !== "Order Placed") return;
  if (order.items.length > 0 && order.items.every((i) => i.status === "Returned")) {
    order.status = "Returned";
    order.completed_at = nowIso();
    order.updated_at = order.completed_at;
    pushHistory(order, "Returned");
  }
}

// ----- tasks -----
function createTask(db, { type, delivery_person_id, order_id, items, status }) {
  const now = nowIso();
  const task = {
    id: taskId(nextSeq(db, "task")),
    type,
    delivery_person_id,
    order_id: order_id || null,
    items,
    status,
    created_at: now,
    updated_at: now,
    completed_at: null,
    history: [{ status, at: now }],
  };
  db.tasks.push(task);
  return task;
}

function setTaskStatus(task, status, itemStatus) {
  task.status = status;
  task.updated_at = nowIso();
  if (TASK_DONE.includes(status)) task.completed_at = task.updated_at;
  task.items.forEach((i) => (i.status = itemStatus));
  pushHistory(task, status);
}

module.exports = {
  TASK_DONE, isTaskActive, round2, nowIso, pushHistory,
  notify, notifyAdminsAndStaff,
  hasActiveWork, recalcDeliveryAvailability, getAvailableDeliveryPerson,
  availableCylinders, findCylinder, customerOf,
  linesText, itemsText, stockShortfalls, shortageMessage,
  rejectOrder, acceptOrder, refreshOrderStatus,
  createTask, setTaskStatus,
};
