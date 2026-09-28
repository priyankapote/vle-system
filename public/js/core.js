Auth.requireLogin();

let ME = null;          // { user, customer }
let SETTINGS = null;    // business settings
let TYPES = [];         // cylinder types + prices
const ACTIONS = {};     // handlers for buttons with data-act="..." (filled in by the other files)
const CACHE = {};       // last-loaded lists, used by edit buttons

const NAV = {
  admin: [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Orders" },
    { key: "cylinders", label: "Cylinders" },
    { key: "customers", label: "Customers" },
    { key: "users", label: "Staff & Delivery" },
    { key: "settings", label: "Settings" },
    { key: "profile", label: "My profile" },
  ],
  member: [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Orders" },
    { key: "cylinders", label: "Cylinders" },
    { key: "customers", label: "Customers" },
    { key: "profile", label: "My profile" },
  ],
  customer: [
    { key: "overview", label: "My orders" },
    { key: "place-order", label: "Place an order" },
    { key: "profile", label: "My profile" },
  ],
  delivery: [
    { key: "overview", label: "My deliveries" },
    { key: "profile", label: "My profile" },
  ],
};

const CUSTOMER_TYPES = [
  "Hospital", "Welding and Metal Fabrication", "Chemical Plants",
  "Mountaineering", "Scuba Diving", "Marine Operations",
];
// Physical cylinder statuses (what admin/staff track)
const CYL_STATUSES = ["In Stock", "In Transit", "In Use", "Empty - Ready to Be Collected", "Returning to Store", "Ready to Refill", "Refilling"];
let CURRENT_ROUTE = "overview";
const isStaffRole = (r) => r === "admin" || r === "member";

async function loadRefData() {
  [SETTINGS, TYPES] = await Promise.all([api("/settings"), api("/types")]);
}

function renderSidebar() {
  const role = ME.user.profile_type;
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML =
    `<button class="notif-btn" id="notif-btn">🔔 Notifications <span class="notif-badge" id="notif-badge" style="display:none;">0</span></button>` +
    `<div class="nav-group">${NAV[role].map((n) => `<button class="nav-item" data-key="${n.key}">${n.label}</button>`).join("")}</div>`;
  nav.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => { window.location.hash = "#" + btn.dataset.key; });
  });
  document.getElementById("notif-btn").addEventListener("click", openNotifModal);
  document.getElementById("who-name").textContent = ME.user.full_name;
  document.getElementById("who-role").textContent = (role === "member" ? "STAFF" : role).toUpperCase();
}

function markActiveNav(key) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.key === key));
}

function route() {
  const key = (window.location.hash || "#overview").slice(1);
  const role = ME.user.profile_type;
  const allowed = NAV[role].map((n) => n.key);
  const target = allowed.includes(key) ? key : "overview";
  markActiveNav(target);
  CURRENT_ROUTE = target;
  const renderers = {
    overview: renderOverview,
    orders: renderOrders,
    cylinders: renderCylinders,
    customers: renderCustomers,
    users: renderUsers,
    settings: renderSettings,
    profile: renderProfile,
    "place-order": renderPlaceOrder,
  };
  Promise.resolve(renderers[target]()).catch((err) => {
    console.error(err);
    main().innerHTML = pageHead("Something went wrong", escapeHtml(err.message || "Please try again."));
  });
}

const main = () => document.getElementById("main");
function pageHead(title, sub, actionHtml) {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${actionHtml || ""}</div>`;
}
function emptyState(title, sub) {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub || "")}</p></div>`;
}

// ---------- Modals ----------
function openModal(html, opts = {}) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal ${opts.wide ? "modal-wide" : ""}">${html}</div></div>`;
  document.getElementById("modal-backdrop").addEventListener("mousedown", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
}
function closeModal() { document.getElementById("modal-root").innerHTML = ""; }

// ---------- Delegated button actions ----------
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const fn = ACTIONS[btn.dataset.act];
  if (!fn || btn.dataset.busy) return;
  btn.dataset.busy = "1";
  try { await fn(btn); }
  catch (err) { toast(err.message, "error"); }
  finally { delete btn.dataset.busy; }
});

ACTIONS.copy = (btn) => copyText(btn.dataset.text);
ACTIONS.go = (btn) => { window.location.hash = "#" + btn.dataset.to; };

// ---------- Choose a delivery person (shared by every assignment) ----------
async function openAssignModal({ title, note, path, success }) {
  const personnel = await api("/users/delivery-personnel");
  const eligible = personnel.filter((p) => p.delivery_status === "Available");
  openModal(`
    <h2>${title}</h2>
    ${note ? `<p>${note}</p>` : ""}
    ${eligible.length ? `
      <div class="field">
        <label for="dp-select">Delivery person</label>
        <select id="dp-select">${eligible.map((p) => `<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join("")}</select>
        <div class="field-hint">Only people currently marked Available are listed.</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-confirm">Assign</button>
      </div>` : emptyState("No delivery person available", "Everyone is off duty or already on a job.") +
      `<div class="modal-actions"><button class="btn btn-secondary" id="modal-cancel">Close</button></div>`}
  `);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  const confirmBtn = document.getElementById("modal-confirm");
  if (confirmBtn) confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      await api(path, { method: "PUT", body: { delivery_person_id: document.getElementById("dp-select").value } });
      toast(success || "Delivery person assigned.");
      closeModal();
      route();
    } catch (e) { toast(e.message, "error"); confirmBtn.disabled = false; }
  });
}

// ---------- Notifications ----------
async function refreshNotifBadge() {
  try {
    const list = await api("/notifications");
    const unread = list.filter((n) => !n.read).length;
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    if (unread > 0) { badge.style.display = ""; badge.textContent = unread > 99 ? "99+" : unread; }
    else badge.style.display = "none";
  } catch (e) { /* silent */ }
}

async function openNotifModal() {
  const role = ME.user.profile_type;
  const list = await api("/notifications");
  // Order requests can be approved/rejected right from the notification while still pending.
  const pending = new Set();
  if (isStaffRole(role)) {
    (await api("/orders")).filter((o) => o.status === "Requested").forEach((o) => pending.add(o.id));
  }
  const items = list.length
    ? list.map((n) => `
        <div class="notif-item ${n.read ? "" : "unread"}" data-id="${n.id}">
          ${escapeHtml(n.message)}
          <span class="notif-time">${fmtDate(n.created_at)}</span>
          ${n.kind === "order_request" && pending.has(n.order_id) ? `
            <div class="notif-actions">
              <button class="btn btn-sm btn-primary" data-act="accept" data-id="${n.order_id}">Accept</button>
              <button class="btn btn-sm btn-secondary" data-act="reject" data-id="${n.order_id}">Reject</button>
            </div>` : ""}
        </div>`).join("")
    : emptyState("No notifications yet", "You'll see updates here as orders and deliveries move.");
  openModal(`
    <h2>Notifications</h2>
    <div style="max-height:55vh;overflow-y:auto;">${items}</div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Close</button>
      ${list.some((n) => !n.read) ? `<button class="btn btn-primary" id="mark-all-read">Mark all read</button>` : ""}
    </div>`);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.querySelectorAll(".notif-item.unread").forEach((el) => {
    el.addEventListener("click", async () => {
      try { await api(`/notifications/${el.dataset.id}/read`, { method: "PUT" }); el.classList.remove("unread"); refreshNotifBadge(); }
      catch (e) { /* ignore */ }
    });
  });
  const markAll = document.getElementById("mark-all-read");
  if (markAll) markAll.addEventListener("click", async () => {
    try { await api("/notifications/read-all", { method: "PUT" }); toast("All caught up."); closeModal(); refreshNotifBadge(); }
    catch (e) { toast(e.message, "error"); }
  });
}

// ---------- Overview dispatcher ----------
function renderOverview() {
  const role = ME.user.profile_type;
  if (role === "customer") return renderCustomerOverview();
  if (role === "delivery") return renderDeliveryOverview();
  return renderStaffOverview();
}

// Count numbers up from 0 for a bit of life.
function animateCounts(root) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    if (target === 0) return;
    const start = performance.now(), dur = 600;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    el.textContent = "0";
    requestAnimationFrame(tick);
  });
}

// ---------- Live updates ----------
// Every few seconds, check whether new notifications arrived (new assignment, order accepted, ...).
// If so, show it and reload the overview page so the new information appears by itself.
let lastNotifId;
function setBadge(unread) {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  if (unread > 0) { badge.style.display = ""; badge.textContent = unread > 99 ? "99+" : unread; }
  else badge.style.display = "none";
}
function canLiveRefresh() {
  if (CURRENT_ROUTE !== "overview") return false;
  if (document.getElementById("modal-root").innerHTML.trim()) return false;
  const a = document.activeElement;
  return !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && main().contains(a));
}
async function liveTick() {
  if (document.hidden) return;
  try {
    const s = await api("/notifications/summary");
    setBadge(s.unread);
    if (lastNotifId === undefined) { lastNotifId = s.latest_id; return; }
    if (s.latest_id && s.latest_id !== lastNotifId) {
      lastNotifId = s.latest_id;
      const list = await api("/notifications");
      if (list[0] && !list[0].read) toast("🔔 " + list[0].message, "info");
      if (canLiveRefresh()) {
        const m = main();
        m.classList.add("live-refresh");
        route();
        setTimeout(() => m.classList.remove("live-refresh"), 1200);
      }
    }
  } catch (e) { /* ignore — try again next tick */ }
}
function startLiveUpdates() {
  liveTick();
  setInterval(liveTick, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) liveTick(); });
}
