// Shared helpers used across all pages.

// Login is kept per browser TAB (sessionStorage), so you can be signed in as a customer in one tab and as
// a delivery person in another without the tabs overwriting each other.
const Auth = {
  getToken() { return sessionStorage.getItem("vle_token"); },
  setToken(t) { sessionStorage.setItem("vle_token", t); },
  getUser() { try { return JSON.parse(sessionStorage.getItem("vle_user")); } catch { return null; } },
  setUser(u) { sessionStorage.setItem("vle_user", JSON.stringify(u)); },
  getCustomer() { try { return JSON.parse(sessionStorage.getItem("vle_customer")); } catch { return null; } },
  setCustomer(c) { sessionStorage.setItem("vle_customer", JSON.stringify(c || null)); },
  clear() {
    sessionStorage.removeItem("vle_token");
    sessionStorage.removeItem("vle_user");
    sessionStorage.removeItem("vle_customer");
  },
  requireLogin() {
    if (!this.getToken()) { window.location.href = "/auth.html"; return false; }
    return true;
  },
};

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = Auth.getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  let payload = body;
  if (body && !isForm) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    if (res.status === 401) { Auth.clear(); window.location.href = "/auth.html"; }
    throw new Error(message);
  }
  return data;
}

async function apiBlob(path) {
  const headers = {};
  const token = Auth.getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch("/api" + path, { headers });
  if (!res.ok) {
    let msg = "Download failed.";
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.blob();
}

function toast(message, kind = "ok") {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = "toast " + (kind === "error" ? "error" : kind === "ok" ? "ok" : "");
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function inr(n) {
  return "Rs. " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

const TAG_CLASS = {
  "In Stock": "tag-stock", "Available": "tag-stock", "Delivered": "tag-stock", "Dropped": "tag-stock", "Dropped at Store": "tag-stock",
  "In Use": "tag-use",
  "In Transit": "tag-transit", "On the Way": "tag-transit", "Collected": "tag-transit", "Returning to Store": "tag-transit",
  "Refilling": "tag-refilling", "Ready to Collect": "tag-refilling",
  "Ready to Refill": "tag-ready",
  "Empty - Ready to Be Collected": "tag-empty",
  "Requested": "tag-requested",
  "Rejected": "tag-rejected",
  "Order Placed": "tag-placed", "Delivery Assigned": "tag-placed",
  "Returned": "tag-returned",
};
function statusTagClass(status) { return TAG_CLASS[status] || "tag-placed"; }

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
  }
  toast("Copied " + text);
}
