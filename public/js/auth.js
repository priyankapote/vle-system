const ROLE_LABEL = { customer: "Customer", member: "Staff", delivery: "Delivery", admin: "Admin" };
const roleTabs = document.querySelectorAll("#role-tabs .tab");
const viewTabs = document.querySelectorAll("#view-tabs .subtab");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const bannerEl = document.getElementById("banner");
const roleField = document.getElementById("role-in-business-field");
const customerField = document.getElementById("customer-type-field");
const customerTypeSelect = document.getElementById("su-customer-type");
const inviteField = document.getElementById("invite-code-field");

let state = { role: "customer", view: "login" };

function banner(msg, kind) {
  bannerEl.innerHTML = msg ? `<div class="banner banner-${kind}">${escapeHtml(msg)}</div>` : "";
}

function applyState() {
  roleTabs.forEach((t) => t.classList.toggle("active", t.dataset.role === state.role));
  viewTabs.forEach((t) => t.classList.toggle("active", t.dataset.view === state.view));
  loginForm.classList.toggle("active", state.view === "login");
  signupForm.classList.toggle("active", state.view === "signup");
  banner("");

  const isCustomer = state.role === "customer";
  customerField.style.display = isCustomer ? "" : "none";
  customerTypeSelect.required = isCustomer;
  roleField.style.display = isCustomer ? "none" : "";
  inviteField.style.display = isCustomer ? "none" : "";
  document.getElementById("su-invite").required = !isCustomer;

  const url = new URL(window.location);
  url.searchParams.set("tab", state.role);
  url.searchParams.set("view", state.view);
  window.history.replaceState({}, "", url);
}

roleTabs.forEach((t) => t.addEventListener("click", () => { state.role = t.dataset.role; applyState(); }));
viewTabs.forEach((t) => t.addEventListener("click", () => { state.view = t.dataset.view; applyState(); }));

// Preselect from query string, e.g. auth.html?tab=customer&view=signup
const params = new URLSearchParams(window.location.search);
if (ROLE_LABEL[params.get("tab")]) state.role = params.get("tab");
if (["login", "signup"].includes(params.get("view"))) state.view = params.get("view");
applyState();

function landingPageFor(profile_type) {
  return "/dashboard.html";
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  banner("");
  const identifier = document.getElementById("login-identifier").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    const data = await api("/auth/login", { method: "POST", body: { identifier, password, profile_type: state.role } });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    window.location.href = landingPageFor(data.user.profile_type);
  } catch (err) {
    banner(err.message, "error");
  }
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  banner("");
  const fd = new FormData(signupForm);
  fd.set("profile_type", state.role);
  if (state.role !== "customer") fd.delete("customer_type");
  else fd.delete("role_in_business");

  const photoInput = document.getElementById("su-photo");
  if (!photoInput.files.length) fd.delete("photo");

  try {
    const data = await api("/auth/signup", { method: "POST", body: fd, isForm: true });
    Auth.setToken(data.token);
    Auth.setUser(data.user);
    Auth.setCustomer(data.customer);
    window.location.href = landingPageFor(data.user.profile_type);
  } catch (err) {
    banner(err.message, "error");
  }
});
