// ================= Staff/Admin overview =================
const DETAIL_ROWS = [
  { key: "available", label: "Available in stock", color: "var(--success)" },
  { key: "reserved", label: "Reserved for orders", color: "#8DBB98" },
  { key: "In Transit", label: "In Transit", color: "var(--transit)" },
  { key: "In Use", label: "In Use (with customers)", color: "var(--oxygen)" },
  { key: "Empty - Ready to Be Collected", label: "Empty - Ready to Be Collected", color: "var(--danger)" },
  { key: "Returning to Store", label: "Returning to Store (with delivery person)", color: "#9A82C8" },
  { key: "Ready to Refill", label: "Ready to Refill", color: "#4A6FA5" },
  { key: "Refilling", label: "Refilling", color: "var(--amber)" },
];

function typeCardHtml(g) {
  const val = (k) => (k === "available" || k === "reserved" ? g[k] : g.by_status[k] || 0);
  const pct = (n) => (g.total ? (n / g.total) * 100 : 0);
  const outNum = g.out;
  return `
  <div class="type-card">
    <div class="type-head">
      <div><div class="type-gas">${escapeHtml(g.gas_type)}</div><div class="type-sub">${escapeHtml(g.size)} · ${inr(g.price)}</div></div>
      <div class="type-total"><span data-count="${g.total}">${g.total}</span><small>total</small></div>
    </div>
    <div class="stackbar" data-widths="${[g.available, g.reserved, outNum, g.ready_to_refill, g.refilling].map((n) => pct(n)).join(",")}">
      <span class="seg-available"></span><span class="seg-reserved"></span><span class="seg-out"></span><span class="seg-ready"></span><span class="seg-refilling"></span>
    </div>
    <div class="type-nums">
      <div><b data-count="${g.available}">${g.available}</b><span>Available</span></div>
      <div><b data-count="${g.reserved}">${g.reserved}</b><span>Reserved</span></div>
      <div><b data-count="${outNum}">${outNum}</b><span>Out</span></div>
      <div><b data-count="${g.ready_to_refill}">${g.ready_to_refill}</b><span>To refill</span></div>
    </div>
    <button class="btn view-details" data-act="toggle-details" aria-expanded="false">View details <span class="chev">▾</span></button>
    <div class="details-wrap"><div class="details-inner"><div class="details-list">
      ${DETAIL_ROWS.map((r) => `<div class="detail-row">
        <span class="dl"><span class="dot" style="background:${r.color}"></span>${r.label}</span><span class="dn">${val(r.key)}</span>
        <div class="bar"><i style="background:${r.color}" data-w="${pct(val(r.key))}"></i></div></div>`).join("")}
    </div></div></div>
  </div>`;
}

ACTIONS["toggle-details"] = (btn) => {
  const card = btn.closest(".type-card");
  const open = card.classList.toggle("open");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.firstChild.textContent = open ? "Hide details " : "View details ";
  card.querySelectorAll(".bar i").forEach((i) => { i.style.width = open ? i.dataset.w + "%" : "0"; });
};

function fillStackbars(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll(".stackbar").forEach((bar) => {
      const w = bar.dataset.widths.split(",");
      bar.querySelectorAll("span").forEach((s, i) => { s.style.width = (w[i] || 0) + "%"; });
    });
  }));
}

async function renderStaffOverview() {
  const role = ME.user.profile_type;
  const [summary, orders] = await Promise.all([api("/cylinders/summary"), api("/orders"), loadRefData()]);
  const sum = (k) => summary.reduce((n, g) => n + g[k], 0);
  const { active } = splitRows(orders);
  const requests = active.filter((r) => !r.item && r.order.status === "Requested");
  const awaiting = active.filter((r) => r.item && r.item.status === "Order Placed");
  const inProgress = active.filter((r) => r.item && r.item.status !== "Order Placed");
  const awaitingOrders = new Set(awaiting.map((r) => r.order.id)).size;

  main().innerHTML = `
    ${pageHead("Overview", "Live snapshot of stock, requests and open orders.")}
    <div class="stat-row">
      <div class="stat"><div class="n" data-count="${sum("available")}">${sum("available")}</div><div class="l">Available in stock</div></div>
      <div class="stat"><div class="n" data-count="${sum("reserved")}">${sum("reserved")}</div><div class="l">Reserved for accepted orders</div></div>
      <div class="stat"><div class="n" data-count="${sum("out")}">${sum("out")}</div><div class="l">Out — in transit, in use with customers, being collected, or on the way back to the store</div></div>
      <div class="stat clickable hl" data-act="go" data-to="cylinders"><div class="n" data-count="${sum("ready_to_refill")}">${sum("ready_to_refill")}</div><div class="l">Ready to refill (empties back in store)</div></div>
      <div class="stat"><div class="n" data-count="${sum("refilling")}">${sum("refilling")}</div><div class="l">Refilling (with a delivery person)</div></div>
      <div class="stat"><div class="n" data-count="${awaitingOrders}">${awaitingOrders}</div><div class="l">Orders awaiting delivery assignment</div></div>
      <div class="stat ${requests.length ? "hl" : ""}"><div class="n" data-count="${requests.length}">${requests.length}</div><div class="l">Order requests to approve</div></div>
    </div>
    ${requests.length ? `<div class="panel" style="border-left:4px solid var(--amber);">
      <h2>Order requests awaiting approval</h2>
      <p class="section-note">Check the deposit, then accept or reject. If there aren't enough cylinders, accepting rejects the order automatically.</p>
      ${ordersTable(requests, role)}</div>` : ""}
    <h2 style="margin-bottom:0.8em;">Cylinder stock by type</h2>
    <div class="type-grid" id="type-grid">${summary.map(typeCardHtml).join("")}</div>
    <div class="panel">
      <h2>Orders awaiting assignment</h2>
      <p class="section-note">Accepted orders with cylinders reserved, waiting for a delivery person.</p>
      ${awaiting.length ? ordersTable(awaiting, role) : emptyState("Nothing pending", "Every accepted order has a delivery person.")}
    </div>
    <div class="panel">
      <h2>Orders in progress</h2>
      <p class="section-note">Delivery assigned, on the way, in use, or waiting to be collected. Finished cylinders move to order history.</p>
      ${inProgress.length ? ordersTable(inProgress, role) : emptyState("Nothing in progress", "No cylinders are out on an order right now.")}
    </div>`;
  animateCounts(main());
  fillStackbars(main());
}

// ================= Cylinders page =================
async function renderCylinders() {
  const role = ME.user.profile_type;
  await loadRefData();
  main().innerHTML = `
    ${pageHead("Cylinders", "Batch number, reference number and current status of every cylinder.", `<button class="btn btn-primary" id="add-cyl-btn">Add cylinder</button>`)}
    <div id="refill-area"></div>
    <div class="filter-bar">
      <div class="filter-field"><label for="cf-type">Cylinder type</label><select id="cf-type"><option value="">All types</option>${TYPES.map((t) => `<option value="${t.gas_type}|${t.size}">${escapeHtml(t.gas_type)} · ${escapeHtml(t.size)}</option>`).join("")}</select></div>
      <div class="filter-field"><label for="cf-status">Status</label><select id="cf-status"><option value="">All</option>${CYL_STATUSES.map((s) => `<option>${s}</option>`).join("")}</select></div>
      <button class="btn btn-sm btn-ghost" id="cf-clear">Clear</button>
    </div>
    <div class="panel" id="cyl-panel">Loading…</div>
    <div class="panel"><h2>Refill runs</h2><p class="section-note">Every time cylinders were sent for refilling. Finished runs stay as they were.</p><div id="refill-runs">Loading…</div></div>`;
  document.getElementById("add-cyl-btn").addEventListener("click", () => openCylinderModal());

  async function refresh() {
    const params = new URLSearchParams();
    const type = document.getElementById("cf-type").value;
    if (type) { const [g, s] = type.split("|"); params.set("gas_type", g); params.set("size", s); }
    const status = document.getElementById("cf-status").value; if (status) params.set("status", status);
    const cylinders = await api("/cylinders?" + params.toString());
    CACHE.cylinders = cylinders;
    renderCylinderTable(cylinders, role === "admin");
  }
  ["cf-type", "cf-status"].forEach((id) => document.getElementById(id).addEventListener("change", refresh));
  document.getElementById("cf-clear").addEventListener("click", () => {
    document.querySelectorAll(".filter-bar select").forEach((el) => (el.value = ""));
    refresh();
  });
  await Promise.all([refresh(), renderRefillPanel(), renderRefillRuns()]);
}

function renderCylinderTable(cylinders, canManage) {
  const rows = cylinders.map((c) => `<tr>
    <td class="num">${c.id}</td>
    <td class="num">${escapeHtml(c.batch_number)}</td>
    <td class="num">${escapeHtml(c.reference_number || "—")}</td>
    <td>${escapeHtml(c.gas_type)}</td>
    <td>${escapeHtml(c.size)}</td>
    <td><span class="tag ${statusTagClass(c.status)}">${c.status}</span>${c.status === "In Stock" && c.order_id ? `<span class="note-inline">Reserved for ${c.order_id}</span>` : ""}</td>
    <td class="row-actions">${canManage ? `<button class="btn btn-sm btn-secondary" data-act="edit-cyl" data-id="${c.id}">Edit</button>
      <button class="btn btn-sm btn-danger" data-act="del-cyl" data-id="${c.id}">Delete</button>` : ""}</td>
  </tr>`).join("");
  document.getElementById("cyl-panel").innerHTML = cylinders.length
    ? `<div class="table-wrap"><table><thead><tr><th class="num">ID</th><th class="num">Batch #</th><th class="num">Reference #</th><th>Gas</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyState("No cylinders match", "Adjust the filters, or add a new cylinder.");
}

ACTIONS["edit-cyl"] = (btn) => openCylinderModal(CACHE.cylinders.find((c) => c.id === btn.dataset.id));
ACTIONS["del-cyl"] = async (btn) => {
  if (!confirm("Remove this cylinder from the system?")) return;
  await api(`/cylinders/${btn.dataset.id}`, { method: "DELETE" });
  toast("Cylinder removed.");
  renderCylinders();
};

function openCylinderModal(existing) {
  const isEdit = !!existing;
  if (!TYPES.length) return toast("No cylinder types exist yet. An admin needs to add them in Settings.", "error");
  const cur = existing ? `${existing.gas_type}|${existing.size}` : "";
  openModal(`
    <h2>${isEdit ? "Edit cylinder" : "Add cylinder"}</h2>
    <div class="field"><label for="c-batch">Batch number</label><input id="c-batch" value="${escapeHtml(existing?.batch_number || "")}" /></div>
    <div class="field"><label for="c-ref">Reference number <span style="font-weight:400;">(optional, temporary)</span></label><input id="c-ref" value="${escapeHtml(existing?.reference_number || "")}" /></div>
    <div class="field"><label for="c-type">Cylinder type</label>
      <select id="c-type">${TYPES.map((t) => `<option value="${t.gas_type}|${t.size}" ${cur === `${t.gas_type}|${t.size}` ? "selected" : ""}>${escapeHtml(t.gas_type)} · ${escapeHtml(t.size)} — ${inr(t.price)}</option>`).join("")}</select>
      <div class="field-hint">Only an admin can add new types or change prices (Settings).</div></div>
    ${isEdit ? `<div class="field"><label for="c-status">Status</label><select id="c-status">
      ${CYL_STATUSES.map((s) => `<option ${existing.status === s ? "selected" : ""}>${s}</option>`).join("")}
    </select><div class="field-hint">Manual override — normally status changes automatically as jobs are completed.</div></div>` : ""}
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm">${isEdit ? "Save changes" : "Add cylinder"}</button>
    </div>`);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-confirm").addEventListener("click", async () => {
    const [gas_type, size] = document.getElementById("c-type").value.split("|");
    const body = {
      batch_number: document.getElementById("c-batch").value.trim(),
      reference_number: document.getElementById("c-ref").value.trim(),
      gas_type, size,
    };
    if (isEdit) body.status = document.getElementById("c-status").value;
    try {
      if (isEdit) await api(`/cylinders/${existing.id}`, { method: "PUT", body });
      else await api("/cylinders", { method: "POST", body });
      toast(isEdit ? "Cylinder updated." : "Cylinder added.");
      closeModal();
      renderCylinders();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ================= Refill: pick some or all "Ready to Refill" cylinders and send them out =================
async function renderRefillPanel() {
  const area = document.getElementById("refill-area");
  const ready = await api("/cylinders?status=" + encodeURIComponent("Ready to Refill"));
  if (!ready.length) { area.innerHTML = ""; return; }
  const personnel = await api("/users/delivery-personnel");
  const eligible = personnel.filter((p) => p.delivery_status === "Available");
  const groups = {};
  ready.forEach((c) => { const k = `${c.gas_type}|${c.size}`; (groups[k] = groups[k] || []).push(c.id); });

  area.innerHTML = `<div class="panel refill-panel">
    <div class="refill-head">
      <div><h2>Ready to refill <span class="count-pill">${ready.length}</span></h2>
        <p class="section-note" style="margin:0;">Empty cylinders that have been dropped at the store. Select all or some, then assign a delivery person to take them for refilling.</p></div>
      <div class="refill-tools">
        <button class="btn btn-sm btn-secondary" id="rf-all">Select all</button>
        ${Object.keys(groups).length > 1 ? Object.entries(groups).map(([k, ids]) => `<button class="btn btn-sm btn-secondary" data-group="${k}">${escapeHtml(k.replace("|", " · "))} (${ids.length})</button>`).join("") : ""}
        <button class="btn btn-sm btn-ghost" id="rf-none">Clear</button>
      </div>
    </div>
    <div class="chip-grid">
      ${ready.map((c) => `<label class="chip"><input type="checkbox" class="rf-check" value="${c.id}" data-group="${c.gas_type}|${c.size}" />
        <span class="chip-body"><span><b>${c.id}</b><small>${escapeHtml(c.gas_type)} · ${escapeHtml(c.size)} · ${escapeHtml(c.batch_number)}</small></span></span></label>`).join("")}
    </div>
    <div class="refill-bar">
      <div class="refill-count" id="rf-count">0 selected</div>
      <div class="field" style="margin:0;min-width:240px;">
        <label for="rf-dp">Delivery person</label>
        <select id="rf-dp">${eligible.length ? eligible.map((p) => `<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join("") : `<option value="">No one available</option>`}</select>
      </div>
      <button class="btn btn-primary" id="rf-send" disabled>Assign for refilling</button>
    </div>
  </div>`;

  const checks = () => Array.from(area.querySelectorAll(".rf-check"));
  const update = () => {
    const n = checks().filter((c) => c.checked).length;
    document.getElementById("rf-count").textContent = `${n} selected`;
    const btn = document.getElementById("rf-send");
    btn.disabled = n === 0 || !eligible.length;
    btn.textContent = n ? `Assign ${n} for refilling` : "Assign for refilling";
  };
  area.onchange = (e) => { if (e.target.classList.contains("rf-check")) update(); };
  document.getElementById("rf-all").addEventListener("click", () => { checks().forEach((c) => (c.checked = true)); update(); });
  document.getElementById("rf-none").addEventListener("click", () => { checks().forEach((c) => (c.checked = false)); update(); });
  area.querySelectorAll("button[data-group]").forEach((b) => b.addEventListener("click", () => {
    checks().forEach((c) => (c.checked = c.dataset.group === b.dataset.group));
    update();
  }));
  document.getElementById("rf-send").addEventListener("click", async (e) => {
    const ids = checks().filter((c) => c.checked).map((c) => c.value);
    e.target.disabled = true;
    try {
      await api("/tasks/refill", { method: "POST", body: { cylinder_ids: ids, delivery_person_id: document.getElementById("rf-dp").value } });
      toast(`${ids.length} cylinder(s) assigned for refilling.`);
      renderCylinders();
    } catch (err) { toast(err.message, "error"); update(); }
  });
}

async function renderRefillRuns() {
  const tasks = await api("/tasks?type=refill");
  document.getElementById("refill-runs").innerHTML = tasks.length ? `<div class="table-wrap"><table>
    <thead><tr><th class="num">Run</th><th>Delivery person</th><th>Cylinders</th><th>Status</th><th>Assigned</th><th>Completed</th></tr></thead>
    <tbody>${tasks.map((t) => `<tr>
      <td class="num">${t.id}</td><td>${escapeHtml(t.delivery_person_name || "—")}</td>
      <td>${t.items.length} <span class="assigned-note">(${t.items.map((i) => escapeHtml(i.cylinder_id)).join(", ")})</span></td>
      <td><span class="tag ${statusTagClass(t.status)}">${t.status}</span></td>
      <td>${fmtDate(t.created_at)}</td><td>${t.completed_at ? fmtDate(t.completed_at) : "—"}</td></tr>`).join("")}</tbody></table></div>`
    : emptyState("No refill runs yet", "Runs appear here once you send cylinders for refilling.");
}
