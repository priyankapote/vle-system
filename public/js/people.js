// ================= Customers =================
async function renderCustomers() {
  const role = ME.user.profile_type;
  main().innerHTML = `
    ${pageHead("Customers", "Everyone who orders cylinders from us.", `<button class="btn btn-primary" id="add-cust-btn">Add customer</button>`)}
    <div class="filter-bar">
      <div class="filter-field"><label for="cuf-type">Customer type</label><select id="cuf-type"><option value="">All types</option>${CUSTOMER_TYPES.map((t) => `<option>${t}</option>`).join("")}</select></div>
      <div class="filter-field"><label for="cuf-search">Search name</label><input id="cuf-search" type="text" placeholder="Name…" /></div>
      <button class="btn btn-sm btn-ghost" id="cuf-clear">Clear</button>
    </div>
    <div class="panel" id="cust-panel">Loading…</div>`;
  document.getElementById("add-cust-btn").addEventListener("click", () => openCustomerModal());
  CACHE.customers = await api("/customers");
  const refresh = () => {
    const type = document.getElementById("cuf-type").value;
    const q = document.getElementById("cuf-search").value.trim().toLowerCase();
    let list = CACHE.customers;
    if (type) list = list.filter((c) => c.customer_type === type);
    if (q) list = list.filter((c) => (c.full_name || "").toLowerCase().includes(q));
    renderCustomerTable(list, role === "admin");
  };
  document.getElementById("cuf-type").addEventListener("change", refresh);
  document.getElementById("cuf-search").addEventListener("input", refresh);
  document.getElementById("cuf-clear").addEventListener("click", () => {
    document.getElementById("cuf-type").value = ""; document.getElementById("cuf-search").value = ""; refresh();
  });
  refresh();
}

function renderCustomerTable(customers, canManage) {
  const rows = customers.map((c) => `<tr>
    <td class="num">${c.id}</td><td>${escapeHtml(c.full_name)}</td><td>${escapeHtml(c.customer_type)}</td>
    <td>${escapeHtml(c.phone || c.email || "—")}</td><td>${escapeHtml(c.address || "—")}</td>
    <td class="row-actions">${canManage ? `<button class="btn btn-sm btn-secondary" data-act="edit-cust" data-id="${c.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-act="del-cust" data-id="${c.id}">Delete</button>` : ""}</td></tr>`).join("");
  document.getElementById("cust-panel").innerHTML = customers.length
    ? `<div class="table-wrap"><table><thead><tr><th class="num">ID</th><th>Name</th><th>Type</th><th>Contact</th><th>Address</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState("No customers match", "Adjust the filters, or add a walk-in customer.");
}
ACTIONS["edit-cust"] = (btn) => openCustomerModal(CACHE.customers.find((c) => c.id === btn.dataset.id));
ACTIONS["del-cust"] = async (btn) => {
  if (!confirm("Delete this customer record?")) return;
  await api(`/customers/${btn.dataset.id}`, { method: "DELETE" });
  toast("Customer deleted."); renderCustomers();
};

function openCustomerModal(existing) {
  const isEdit = !!existing;
  openModal(`
    <h2>${isEdit ? "Edit customer" : "Add customer"}</h2>
    <div class="field"><label for="cu-name">Full name</label><input id="cu-name" value="${escapeHtml(existing?.full_name || "")}" /></div>
    <div class="field-row">
      <div class="field"><label for="cu-phone">Phone</label><input id="cu-phone" value="${escapeHtml(existing?.phone || "")}" /></div>
      <div class="field"><label for="cu-email">Email</label><input id="cu-email" value="${escapeHtml(existing?.email || "")}" /></div>
    </div>
    <div class="field"><label for="cu-address">Address</label><input id="cu-address" value="${escapeHtml(existing?.address || "")}" /></div>
    <div class="field"><label for="cu-type">Customer type</label><select id="cu-type">${CUSTOMER_TYPES.map((t) => `<option ${existing?.customer_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm">${isEdit ? "Save changes" : "Add customer"}</button>
    </div>`);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-confirm").addEventListener("click", async () => {
    const body = {
      full_name: document.getElementById("cu-name").value.trim(),
      phone: document.getElementById("cu-phone").value.trim(),
      email: document.getElementById("cu-email").value.trim(),
      address: document.getElementById("cu-address").value.trim(),
      customer_type: document.getElementById("cu-type").value,
    };
    try {
      if (isEdit) await api(`/customers/${existing.id}`, { method: "PUT", body });
      else await api("/customers", { method: "POST", body });
      toast(isEdit ? "Customer updated." : "Customer added.");
      closeModal(); renderCustomers();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ================= Staff & delivery accounts (admin) =================
async function renderUsers() {
  main().innerHTML = `
    ${pageHead("Staff & delivery", "Admin, staff and delivery accounts. New accounts are created by signing up with an invite code.")}
    <div class="filter-bar">
      <div class="filter-field"><label for="uf-type">Type</label><select id="uf-type"><option value="">All</option><option value="admin">Admin</option><option value="member">Staff</option><option value="delivery">Delivery</option></select></div>
      <button class="btn btn-sm btn-ghost" id="uf-clear">Clear</button>
    </div>
    <div class="panel" id="users-panel">Loading…</div>`;
  CACHE.users = (await api("/users")).filter((u) => u.profile_type !== "customer");
  const refresh = () => {
    const type = document.getElementById("uf-type").value;
    renderUsersTable(type ? CACHE.users.filter((u) => u.profile_type === type) : CACHE.users);
  };
  document.getElementById("uf-type").addEventListener("change", refresh);
  document.getElementById("uf-clear").addEventListener("click", () => { document.getElementById("uf-type").value = ""; refresh(); });
  refresh();
}

function renderUsersTable(staff) {
  const rows = staff.map((u) => `<tr>
    <td>${escapeHtml(u.full_name)}</td><td class="mono">${u.profile_type === "member" ? "staff" : u.profile_type}</td>
    <td>${escapeHtml(u.role_in_business || "—")}</td><td>${escapeHtml(u.phone || u.email || "—")}</td>
    <td>${u.profile_type === "delivery" ? `<span class="tag ${u.delivery_status === "Available" ? "tag-stock" : u.delivery_status === "On Delivery" ? "tag-transit" : "tag-returned"}">${u.delivery_status}</span>` : "—"}</td>
    <td class="row-actions"><button class="btn btn-sm btn-secondary" data-act="edit-user" data-id="${u.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-act="del-user" data-id="${u.id}">Delete</button></td></tr>`).join("");
  document.getElementById("users-panel").innerHTML = staff.length
    ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Role</th><th>Contact</th><th>Availability</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState("No accounts match", "");
}
ACTIONS["del-user"] = async (btn) => {
  if (!confirm("Delete this account? This cannot be undone.")) return;
  await api(`/users/${btn.dataset.id}`, { method: "DELETE" });
  toast("Account deleted."); renderUsers();
};
ACTIONS["edit-user"] = (btn) => {
  const u = CACHE.users.find((x) => x.id === btn.dataset.id);
  openModal(`
    <h2>Edit account</h2>
    <div class="field"><label for="u-name">Full name</label><input id="u-name" value="${escapeHtml(u.full_name)}" /></div>
    <div class="field-row">
      <div class="field"><label for="u-phone">Phone</label><input id="u-phone" value="${escapeHtml(u.phone || "")}" /></div>
      <div class="field"><label for="u-email">Email</label><input id="u-email" value="${escapeHtml(u.email || "")}" /></div>
    </div>
    <div class="field"><label for="u-role">Role in business</label><input id="u-role" value="${escapeHtml(u.role_in_business || "")}" /></div>
    <div class="field"><label for="u-pw">Reset password <span style="font-weight:400;">(optional)</span></label><input id="u-pw" type="password" minlength="6" placeholder="Leave blank to keep current password" /></div>
    <div class="field-hint" style="margin-top:-0.6em;">Passwords are never shown — only reset here.</div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm">Save changes</button>
    </div>`);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-confirm").addEventListener("click", async () => {
    const body = {
      full_name: document.getElementById("u-name").value.trim(),
      phone: document.getElementById("u-phone").value.trim(),
      email: document.getElementById("u-email").value.trim(),
      role_in_business: document.getElementById("u-role").value.trim(),
    };
    const pw = document.getElementById("u-pw").value;
    if (pw) body.new_password = pw;
    try { await api(`/users/${u.id}`, { method: "PUT", body }); toast("Account updated."); closeModal(); renderUsers(); }
    catch (e) { toast(e.message, "error"); }
  });
};

// ================= Settings (admin only) =================
const SETTING_FIELDS = {
  business_name: { label: "Business name", type: "text", max: 80, show: (v) => escapeHtml(v), hint: "Shown on every dashboard, the login pages and bills." },
  min_deposit_percent: { label: "Minimum percentage payable as deposit before delivery", type: "number", min: 0, max: 100, step: "0.01", show: (v) => `${v}%`, hint: "Between 0% and 100% of an order's total." },
  business_address: { label: "Business address (for bills)", type: "text", max: 300, show: (v) => escapeHtml(v || "Not set") },
  business_phone: { label: "Business phone (for bills)", type: "text", max: 40, show: (v) => escapeHtml(v || "Not set") },
  business_gstin: { label: "GSTIN (for bills, optional)", type: "text", max: 40, show: (v) => escapeHtml(v || "Not set") },
};

function settingRow(key) {
  const f = SETTING_FIELDS[key];
  return `<div class="setting-row" data-key="${key}">
    <div><div class="setting-label">${f.label}</div><div class="setting-value">${f.show(SETTINGS[key])}</div></div>
    <button class="btn btn-secondary btn-sm" data-act="edit-setting" data-key="${key}">Edit</button></div>`;
}

ACTIONS["edit-setting"] = (btn) => {
  const key = btn.dataset.key, f = SETTING_FIELDS[key];
  const row = btn.closest(".setting-row");
  row.innerHTML = `<div>
      <div class="setting-label">${f.label}</div>
      <div class="inline-edit">
        <input id="se-input" type="${f.type}" value="${escapeHtml(SETTINGS[key])}" ${f.type === "number" ? `min="${f.min}" max="${f.max}" step="${f.step}"` : `maxlength="${f.max}"`} />
        <button class="btn btn-primary btn-sm" id="se-save">Save</button>
        <button class="btn btn-ghost btn-sm" id="se-cancel">Cancel</button>
      </div>
      ${f.hint ? `<div class="field-hint">${f.hint}</div>` : ""}</div>`;
  const input = document.getElementById("se-input");
  input.focus(); input.select();
  const save = async () => {
    try {
      SETTINGS = await api("/settings", { method: "PUT", body: { [key]: input.value } });
      if (key === "business_name") window.applyBrand(SETTINGS.business_name);
      toast("Saved.");
      renderSettings();
    } catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("se-save").addEventListener("click", save);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") renderSettings(); });
  document.getElementById("se-cancel").addEventListener("click", renderSettings);
};

async function renderSettings() {
  await loadRefData();
  main().innerHTML = `
    ${pageHead("Settings", "Only admins can change these.")}
    <div class="panel"><h2>Business</h2>
      ${settingRow("business_name")}${settingRow("business_address")}${settingRow("business_phone")}${settingRow("business_gstin")}</div>
    <div class="panel"><h2>Payments</h2>${settingRow("min_deposit_percent")}</div>
    <div class="panel"><h2>Cylinder types &amp; prices</h2>
      <p class="section-note">Every cylinder of a type has the same price. Staff can add cylinders of these types but can't change types or prices. Price changes apply to new orders only.</p>
      <div class="table-wrap"><table><thead><tr><th>Gas</th><th>Size</th><th class="num">Price (each)</th><th></th></tr></thead>
        <tbody>${TYPES.map((t) => `<tr><td>${escapeHtml(t.gas_type)}</td><td>${escapeHtml(t.size)}</td><td class="num">${inr(t.price)}</td>
          <td class="row-actions"><button class="btn btn-sm btn-secondary" data-act="edit-price" data-id="${t.id}">Edit price</button></td></tr>`).join("")}</tbody></table></div>
      <h3 style="margin:1.4em 0 0.6em;font-size:0.95rem;">Add a cylinder type</h3>
      <div class="field-row" style="align-items:flex-end;flex-wrap:wrap;">
        <div class="field"><label for="nt-gas">Gas</label><input id="nt-gas" placeholder="e.g. Nitrogen" /></div>
        <div class="field"><label for="nt-size">Size</label><input id="nt-size" placeholder="e.g. Small" /></div>
        <div class="field"><label for="nt-price">Price (Rs.)</label><input id="nt-price" type="number" min="1" step="0.01" /></div>
        <div class="field" style="flex:0;"><button class="btn btn-primary" id="nt-add">Add type</button></div>
      </div>
    </div>`;
  document.getElementById("nt-add").addEventListener("click", async () => {
    try {
      await api("/types", { method: "POST", body: {
        gas_type: document.getElementById("nt-gas").value, size: document.getElementById("nt-size").value,
        price: Number(document.getElementById("nt-price").value),
      }});
      toast("Cylinder type added."); renderSettings();
    } catch (e) { toast(e.message, "error"); }
  });
}

ACTIONS["edit-price"] = (btn) => {
  const t = TYPES.find((x) => x.id === btn.dataset.id);
  openModal(`
    <h2>Edit price — ${escapeHtml(t.gas_type)} · ${escapeHtml(t.size)}</h2>
    <div class="field"><label for="ep-price">Price per cylinder (Rs.)</label><input id="ep-price" type="number" min="1" step="0.01" value="${t.price}" /></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm">Save price</button>
    </div>`);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-confirm").addEventListener("click", async () => {
    try {
      await api(`/types/${t.id}`, { method: "PUT", body: { price: Number(document.getElementById("ep-price").value) } });
      toast("Price updated."); closeModal(); renderSettings();
    } catch (e) { toast(e.message, "error"); }
  });
};

// ================= Profile (everyone) =================
async function renderProfile() {
  const { user, customer } = await api("/auth/me");
  main().innerHTML = `
    ${pageHead("My profile", "Keep your contact details up to date.")}
    <div class="panel" style="max-width:480px;">
      ${user.photo ? `<img src="${escapeHtml(user.photo)}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin-bottom:1em;" />` : ""}
      <form id="profile-form">
        <div class="field"><label for="p-name">Full name</label><input id="p-name" value="${escapeHtml(user.full_name)}" /></div>
        <div class="field"><label for="p-nick">Nickname</label><input id="p-nick" value="${escapeHtml(user.nickname || "")}" /></div>
        <div class="field-row">
          <div class="field"><label for="p-phone">Phone</label><input id="p-phone" value="${escapeHtml(user.phone || "")}" /></div>
          <div class="field"><label for="p-email">Email</label><input id="p-email" value="${escapeHtml(user.email || "")}" /></div>
        </div>
        <div class="field"><label for="p-address">Address</label><input id="p-address" value="${escapeHtml(user.address || "")}" /></div>
        <div class="field"><label for="p-photo">Update photo</label><input id="p-photo" type="file" accept="image/*" /></div>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </form>
    </div>
    ${customer ? `<div class="panel" style="max-width:480px;">
      <h2>Customer details</h2>
      <div class="field"><label for="p-ctype">Industry / customer type</label>
        <select id="p-ctype">${CUSTOMER_TYPES.map((t) => `<option ${customer.customer_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <button class="btn btn-secondary" id="save-ctype-btn">Save</button>
      <div class="field-hint" style="margin-top:0.8em;">Your customer ID is <strong class="mono">${customer.id}</strong>.</div>
    </div>` : ""}`;

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData();
    ["name:full_name", "nick:nickname", "phone:phone", "email:email", "address:address"].forEach((p) => {
      const [id, field] = p.split(":"); fd.set(field, document.getElementById("p-" + id).value);
    });
    const photo = document.getElementById("p-photo");
    if (photo.files.length) fd.set("photo", photo.files[0]);
    try {
      const updated = await api("/users/me", { method: "PUT", body: fd, isForm: true });
      Auth.setUser(updated); ME.user = updated;
      toast("Profile updated."); renderSidebar(); renderProfile();
    } catch (e2) { toast(e2.message, "error"); }
  });
  const saveCtype = document.getElementById("save-ctype-btn");
  if (saveCtype) saveCtype.addEventListener("click", async () => {
    try { await api("/customers/me", { method: "PUT", body: { customer_type: document.getElementById("p-ctype").value } }); toast("Customer details updated."); }
    catch (e) { toast(e.message, "error"); }
  });
}
