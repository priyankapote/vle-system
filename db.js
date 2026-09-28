// Lightweight file-based data store (data/db.json). Writes are synchronous and atomic
// (temp file + rename). Fine for one small business's local server.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_TYPES = [
  { id: "TYP-0001", gas_type: "Oxygen", size: "Small", price: 1000 },
  { id: "TYP-0002", gas_type: "Oxygen", size: "Jumbo", price: 2000 },
  { id: "TYP-0003", gas_type: "CO2", size: "Small", price: 1500 },
  { id: "TYP-0004", gas_type: "CO2", size: "Jumbo", price: 3000 },
];

const DEFAULT_SETTINGS = {
  business_name: "Aditi Enterprises",
  min_deposit_percent: 25,
  business_address: "",
  business_phone: "",
  business_gstin: "",
};

const DB_VERSION = 4;
const clone = (o) => JSON.parse(JSON.stringify(o));

function emptyDb() {
  return {
    version: DB_VERSION,
    users: [],
    customers: [],
    cylinders: [],   // physical cylinders: {id, batch_number, reference_number, gas_type, size, status, order_id, delivery_assigned_to, ...}
    orders: [],      // {id, customer_id, gas_type, size, quantity, unit_price, total_amount, deposit_amount, amount_paid, status, items[], ...}
    tasks: [],       // delivery jobs: {id, type: delivery|pickup|refill, delivery_person_id, order_id, items[], status, ...}
    notifications: [],
    cylinder_types: clone(DEFAULT_TYPES),
    settings: clone(DEFAULT_SETTINGS),
    counters: { customer: 0, order: 0, cylinder: 0, task: 0, type: DEFAULT_TYPES.length },
  };
}

// Fill in anything added since the file was first created, and convert older records.
function migrate(db) {
  db.users = db.users || [];
  db.customers = db.customers || [];
  db.cylinders = db.cylinders || [];
  db.orders = db.orders || [];
  db.notifications = db.notifications || [];
  db.tasks = db.tasks || [];
  db.counters = Object.assign({ customer: 0, order: 0, cylinder: 0, task: 0, type: 0 }, db.counters || {});
  db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings || {});
  if (!db.cylinder_types) {
    db.cylinder_types = clone(DEFAULT_TYPES);
    db.counters.type = Math.max(db.counters.type, DEFAULT_TYPES.length);
  }
  // v4: a pickup job now has two steps (Collected from customer, then Dropped at store).
  // Before v4, "Collected" was the final step, so convert those finished jobs.
  if ((db.version || 0) < 4) {
    for (const t of db.tasks) {
      if (t.type === "pickup" && t.status === "Collected") {
        t.status = "Dropped";
        t.items.forEach((i) => (i.status = "Dropped at Store"));
      }
    }
  }
  db.version = DB_VERSION;
  for (const c of db.cylinders) {
    if (c.status === "Empty - Returned") c.status = "Ready to Refill";
    if (c.order_id === undefined) c.order_id = null;
  }
  for (const o of db.orders) {
    if (!o.lines) {
      const t = db.cylinder_types.find((x) => x.gas_type === o.gas_type && x.size === o.size);
      o.lines = [{
        type_id: t ? t.id : null, gas_type: o.gas_type, size: o.size, quantity: o.quantity,
        unit_price: o.unit_price || 0, line_total: o.total_amount || 0,
      }];
    }
    if (!o.items) {
      const map = { "In Transit": "On the Way", "In Use": "In Use", "Empty - Ready to Be Collected": "Empty - Ready to Be Collected" };
      o.items = (o.cylinder_ids || []).map((id) => {
        const c = db.cylinders.find((x) => x.id === id);
        return {
          cylinder_id: id,
          batch_number: c ? c.batch_number : "—",
          reference_number: c ? c.reference_number : null,
          gas_type: o.gas_type,
          size: o.size,
          unit_price: 0,
          status: (c && map[c.status]) || "Returned",
        };
      });
      o.unit_price = o.unit_price || 0;
      o.total_amount = o.total_amount || 0;
      o.deposit_amount = o.deposit_amount || 0;
      o.amount_paid = o.amount_paid || 0;
      if (o.items.length === 0 && o.status === "Order Placed") o.status = "Requested";
      else if (["On the Way", "In Use", "Empty - Ready to Be Collected"].includes(o.status)) o.status = "Order Placed";
      o.legacy = true;
    }
  }
  return db;
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2));
}

function read() {
  ensureDb();
  let db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch (e) {
    throw new Error("Database file is corrupted: " + e.message);
  }
  return migrate(db);
}

function write(dbObj) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(dbObj, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Runs fn(db) and persists the result. If fn throws, nothing is written.
function transact(fn) {
  const db = read();
  const result = fn(db);
  write(db);
  return result;
}

function nextSeq(db, key) {
  db.counters[key] = (db.counters[key] || 0) + 1;
  return db.counters[key];
}

module.exports = { read, write, transact, nextSeq };
