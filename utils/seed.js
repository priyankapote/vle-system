// Optional demo data for hosting on a free plan where the data resets now and then.
// Turned on with SEED_DEMO=true (and DEMO_PASSWORD=<something strong>). It only runs
// when the database has no users, so it never overwrites real data.

const bcrypt = require("bcryptjs");
const { read, transact, nextSeq } = require("../db");
const { uid, customerId, cylinderId } = require("./id");

function seedDemoIfNeeded() {
  if (String(process.env.SEED_DEMO).toLowerCase() !== "true") return;
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 6) {
    console.log("SEED_DEMO is on but DEMO_PASSWORD is missing or shorter than 6 characters — demo data NOT created.");
    return;
  }
  if (read().users.length > 0) return;

  const hash = bcrypt.hashSync(password, 10);
  transact((db) => {
    const now = new Date().toISOString();
    const mk = (full_name, phone, profile_type, extra = {}) => {
      const u = {
        id: uid(), full_name, nickname: null, photo: null, phone, email: null,
        address: extra.address || null, role_in_business: extra.role || null, profile_type,
        password_hash: hash, delivery_status: profile_type === "delivery" ? "Available" : null,
        created_at: now, updated_at: now,
      };
      db.users.push(u);
      return u;
    };
    mk("Demo Admin", "9000000001", "admin", { role: "Owner" });
    mk("Demo Staff", "9000000002", "member", { role: "Manager" });
    mk("Demo Delivery", "9000000003", "delivery", { role: "Delivery" });
    const cu = mk("Demo Hospital", "9000000004", "customer", { address: "12 MG Road" });
    db.customers.push({ id: customerId(nextSeq(db, "customer")), user_id: cu.id, customer_type: "Hospital", created_at: now, updated_at: now });

    const stock = [["Oxygen", "Small", 4], ["Oxygen", "Jumbo", 3], ["CO2", "Small", 3], ["CO2", "Jumbo", 3]];
    for (const [gas_type, size, n] of stock) {
      for (let i = 1; i <= n; i++) {
        db.cylinders.push({
          id: cylinderId(nextSeq(db, "cylinder")),
          batch_number: `DEMO-${gas_type === "Oxygen" ? "OX" : "CO2"}-${size[0]}${i}`,
          reference_number: null, gas_type, size, status: "In Stock", order_id: null, delivery_assigned_to: null,
          created_at: now, updated_at: now,
        });
      }
    }
  });
  console.log("Demo data created. Log in with phone 9000000001 (admin), 9000000002 (staff), 9000000003 (delivery) or 9000000004 (customer) and your DEMO_PASSWORD.");
}

module.exports = { seedDemoIfNeeded };
