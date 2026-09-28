// ================= Rows: one per cylinder, split into active vs history =================
// History is frozen: a cylinder that has been Returned (and any Rejected order) never changes again.
function splitRows(orders) {
  const active = [], history = [];
  for (const o of orders) {
    if (o.status === "Requested") active.push({ order: o, item: null });
    else if (o.status === "Rejected") history.push({ order: o, item: null });
    else if (!o.items.length) active.push({ order: o, item: null });
    else for (const item of o.items) (item.status === "Returned" ? history : active).push({ order: o, item });
  }
  return { active, history };
}
const linesText = (o) => (o.lines || []).map((l) => `${l.quantity} × ${l.size} ${l.gas_type}`).join(", ");
const rowStatus = (r) => (r.item ? r.item.status : r.order.status);

function contactCard(c, label) {
  const avatar = c.photo
    ? `<img class="avatar" src="${escapeHtml(c.photo)}" alt="" />`
    : `<div class="avatar">${escapeHtml(initials(c.name))}</div>`;
  return `<div class="contact-card">${avatar}<div>
      ${label ? `<span class="contact-role">${label}</span>` : ""}
      <b>${escapeHtml(c.name)}</b>
      <span class="mono">${escapeHtml(c.phone || "No number")}</span>
      ${c.phone ? `<div class="contact-actions">
        <button class="btn btn-sm btn-secondary" data-act="copy" data-text="${escapeHtml(c.phone)}">Copy number</button>
        <a class="btn btn-sm btn-primary" href="tel:${escapeHtml(c.phone)}">Call</a></div>` : ""}
    </div></div>`;
}

function amountCell(o) {
  if (!o.total_amount) return "—";
  if (o.status === "Requested") return `${inr(o.total_amount)}<div class="assigned-note">Deposit ${inr(o.deposit_amount)}</div>`;
  if (o.status === "Rejected") return `<span class="assigned-note">${inr(o.total_amount)}</span>`;
  return `${inr(o.total_amount)}<div class="assigned-note">Paid ${inr(o.amount_paid)}${o.pending_amount > 0 ? ` · Due ${inr(o.pending_amount)}` : " · Settled"}</div>`;
}

function ordersTable(rows, role, opts = {}) {
  const history = !!opts.history;
  const seenAssign = new Set(), seenPickup = new Set(), seenBill = new Set();
  const showCustomer = role !== "customer";
  const trs = rows.map(({ order: o, item: it }) => {
    let actions = "";
    if (!history) {
      if (!it && o.status === "Requested" && isStaffRole(role)) {
        actions += `<button class="btn btn-sm btn-primary" data-act="accept" data-id="${o.id}">Accept</button>
                    <button class="btn btn-sm btn-secondary" data-act="reject" data-id="${o.id}">Reject</button>`;
      }
      if (it && it.status === "Order Placed" && isStaffRole(role) && !seenAssign.has(o.id)) {
        actions += `<button class="btn btn-sm btn-primary" data-act="assign-delivery" data-id="${o.id}">Assign delivery</button>`;
        seenAssign.add(o.id);
      }
      if (it && it.status === "In Use" && (role === "customer" || role === "admin")) {
        actions += `<button class="btn btn-sm btn-secondary" data-act="mark-empty" data-order="${o.id}" data-cyl="${it.cylinder_id}">Mark empty</button>`;
      }
      if (it && it.status === "Empty - Ready to Be Collected") {
        if (isStaffRole(role) && !it.pickup_task_id && !seenPickup.has(o.id)) {
          actions += `<button class="btn btn-sm btn-primary" data-act="assign-pickup" data-id="${o.id}">Assign pickup</button>`;
          seenPickup.add(o.id);
        } else if (it.pickup_task_id) {
          actions += `<span class="assigned-note">Pickup arranged</span>`;
        }
      }
    }
    const firstOfOrder = !seenBill.has(o.id);
    if (firstOfOrder) seenBill.add(o.id);
    const billable = o.status !== "Requested" && o.status !== "Rejected";
    if (firstOfOrder && billable && (role !== "delivery")) {
      actions += ` <button class="btn btn-sm btn-ghost" data-act="bill" data-id="${o.id}">Bill</button>`;
    }

    const status = it ? it.status : o.status;
    const statusExtra = it && it.status === "Collected" && role !== "customer"
      ? `<span class="note-inline">Returning to store — not finished until dropped</span>`
      : o.status === "Rejected" ? `<span class="note-inline">Reason: ${escapeHtml(o.rejection_reason || "—")}</span>` : "";
    const cyl = it
      ? `${escapeHtml(it.cylinder_id)} <span class="assigned-note">(${escapeHtml(it.batch_number)})</span>`
      : `<span class="assigned-note">${o.status === "Requested" ? "— awaiting approval —" : "—"}</span>`;
    const type = it ? `${escapeHtml(it.size)} ${escapeHtml(it.gas_type)}` : escapeHtml(linesText(o));

    let delivery = "—";
    if (it) {
      if (it.delivery_contact) delivery = contactCard(it.delivery_contact, "Delivery person");
      else if (it.pickup_contact) delivery = contactCard(it.pickup_contact, "Pickup person");
      else if (role !== "customer") {
        const n = (it.status === "Empty - Ready to Be Collected" || it.status === "Collected") ? it.pickup_person_name : it.delivery_person_name;
        if (n) delivery = escapeHtml(n);
      }
    }
    const closed = it ? (it.returned_at || o.completed_at) : o.completed_at;

    return `<tr>
      <td class="num">${o.id}</td>
      ${showCustomer ? `<td>${escapeHtml(o.customer_name || "—")}</td>` : ""}
      <td class="num">${cyl}</td>
      <td>${type}</td>
      <td><span class="tag ${statusTagClass(status)}">${escapeHtml(status)}</span>${statusExtra}</td>
      ${history ? `<td>${fmtDay(o.created_at)}</td><td>${fmtDay(closed)}</td>` : `<td>${delivery}</td><td>${fmtDay(o.created_at)}</td>`}
      <td>${firstOfOrder ? amountCell(o) : ""}</td>
      <td class="row-actions">${actions}</td>
    </tr>`;
  }).join("");

  return `<div class="table-wrap"><table>
    <thead><tr><th class="num">Order</th>${showCustomer ? "<th>Customer</th>" : ""}<th class="num">Cylinder</th><th>Type</th><th>Status</th>
    ${history ? "<th>Placed</th><th>Closed</th>" : "<th>Delivery</th><th>Placed</th>"}<th>Amount</th><th></th></tr></thead>
    <tbody>${trs}</tbody></table></div>`;
}

// ================= Actions =================
ACTIONS.accept = async (btn) => {
  const r = await api(`/orders/${btn.dataset.id}/accept`, { method: "PUT" });
  if (r.accepted) toast("Order accepted — cylinders reserved.");
  else toast("Order rejected automatically: not enough cylinders in stock.", "error");
  closeModal(); refreshNotifBadge(); route();
};

ACTIONS.reject = (btn) => {
  const id = btn.dataset.id;
  openModal(`
    <h2>Reject order ${escapeHtml(id)}</h2>
    <p>The customer will be told the reason.</p>
    <div class="field">
      <label for="reject-reason">Reason for rejection</label>
      <textarea id="reject-reason" class="reject-reason" maxlength="300" placeholder="e.g. Deposit amount is incorrect"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-danger" id="reject-confirm" disabled>Confirm rejection</button>
    </div>`);
  const ta = document.getElementById("reject-reason");
  const confirmBtn = document.getElementById("reject-confirm");
  ta.focus();
  ta.addEventListener("input", () => { confirmBtn.disabled = !ta.value.trim(); });
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      await api(`/orders/${id}/reject`, { method: "PUT", body: { reason: ta.value.trim() } });
      toast("Order rejected.");
      closeModal(); refreshNotifBadge(); route();
    } catch (e) { toast(e.message, "error"); confirmBtn.disabled = false; }
  });
};

ACTIONS["assign-delivery"] = (btn) => openAssignModal({
  title: "Assign delivery person",
  note: "They will pick the reserved cylinders up from the store and deliver them.",
  path: `/orders/${btn.dataset.id}/assign-delivery`,
  success: "Delivery assigned.",
});
ACTIONS["assign-pickup"] = (btn) => openAssignModal({
  title: "Assign delivery person to collect",
  note: "They will collect the empty cylinders from the customer.",
  path: `/orders/${btn.dataset.id}/assign-pickup`,
  success: "Pickup assigned.",
});

ACTIONS["mark-empty"] = async (btn) => {
  if (!confirm("Mark this cylinder as empty and ready to be collected?")) return;
  await api(`/orders/${btn.dataset.order}/cylinders/${btn.dataset.cyl}/mark-empty`, { method: "PUT" });
  toast("Marked empty — a pickup will be arranged.");
  route();
};

// ================= Bill =================
async function downloadBill(orderId, invoiceNo) {
  const blob = await apiBlob(`/orders/${orderId}/bill.pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `Bill-${invoiceNo}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function billHtml(b) {
  const cls = b.payment_status === "PAID" ? "status-paid" : b.payment_status === "PENDING" ? "status-pending" : "status-partial";
  return `<div class="bill-sheet">
    <div class="bill-top">
      <div><h3>${escapeHtml(b.business.name)}</h3>
        ${b.business.address ? `<p>${escapeHtml(b.business.address)}</p>` : ""}
        ${b.business.phone ? `<p>Phone: ${escapeHtml(b.business.phone)}</p>` : ""}
        ${b.business.gstin ? `<p>GSTIN: ${escapeHtml(b.business.gstin)}</p>` : ""}</div>
      <div class="bill-meta"><strong>BILL / INVOICE</strong>Invoice No: ${escapeHtml(b.invoice_no)}<br>Date: ${fmtDay(b.date)}<br>Order: ${escapeHtml(b.order_id)}</div>
    </div>
    <div class="bill-to">
      <div><small>BILL TO</small><b>${escapeHtml(b.customer.name)}</b>
        <p>${escapeHtml(b.customer.address)}</p><p>Phone: ${escapeHtml(b.customer.phone)}</p>
        <p>Customer ID: ${escapeHtml(b.customer.id)}${b.customer.type ? " · " + escapeHtml(b.customer.type) : ""}</p></div>
      <div style="text-align:right;"><small>PAYMENT STATUS</small><div class="bill-status ${cls}">${b.payment_status}</div></div>
    </div>
    <div class="table-wrap"><table class="bill-table">
      <thead><tr><th>S.No</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${b.lines.map((l) => `<tr><td>${l.sn}</td><td>${escapeHtml(l.description)}</td><td class="num">${l.qty}</td><td class="num">${l.rate === "" ? "" : inr(l.rate)}</td><td class="num">${inr(l.amount)}</td></tr>`).join("")}</tbody>
    </table></div>
    <div class="bill-totals">
      <div class="grand"><span>Total Bill Amount</span><span>${inr(b.total)}</span></div>
      <div class="paid"><span>Total Amount Paid</span><span>${inr(b.paid)}</span></div>
      <div class="grand" style="color:${b.pending > 0 ? "var(--danger)" : "var(--success)"};"><span>Pending Amount</span><span>${inr(b.pending)}</span></div>
    </div>
    <div class="bill-words"><b>Amount in words:</b> ${escapeHtml(b.amount_in_words)}</div>
  </div>`;
}

async function openBillModal(orderId) {
  const b = await api(`/orders/${orderId}/bill`);
  const isAdmin = ME.user.profile_type === "admin";
  openModal(`
    ${billHtml(b)}
    <div id="bill-edit-area"></div>
    <div class="modal-actions">
      ${isAdmin ? `<button class="btn btn-secondary" id="bill-edit-btn">Edit amounts</button>` : ""}
      <button class="btn btn-secondary" id="modal-cancel">Close</button>
      <button class="btn btn-primary" id="bill-download">Download PDF</button>
    </div>`, { wide: true });
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("bill-download").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await downloadBill(orderId, b.invoice_no); toast("Bill downloaded."); }
    catch (err) { toast(err.message, "error"); }
    e.target.disabled = false;
  });
  const editBtn = document.getElementById("bill-edit-btn");
  if (editBtn) editBtn.addEventListener("click", () => {
    document.getElementById("bill-edit-area").innerHTML = `
      <div class="bill-edit">
        <b>Edit bill amounts (admin only)</b>
        <div class="field-row" style="margin-top:0.7em;">
          <div class="field"><label for="be-total">Total bill amount (Rs.)</label><input id="be-total" type="number" step="0.01" min="0" value="${b.total}" /></div>
          <div class="field"><label for="be-paid">Total amount paid (Rs.)</label><input id="be-paid" type="number" step="0.01" min="0" value="${b.paid}" /></div>
        </div>
        <button class="btn btn-primary btn-sm" id="be-save">Save bill amounts</button>
      </div>`;
    editBtn.style.display = "none";
    document.getElementById("be-save").addEventListener("click", async () => {
      try {
        await api(`/orders/${orderId}/bill`, { method: "PUT", body: {
          total_amount: Number(document.getElementById("be-total").value),
          amount_paid: Number(document.getElementById("be-paid").value),
        }});
        toast("Bill updated.");
        openBillModal(orderId);
        route();
      } catch (err) { toast(err.message, "error"); }
    });
  });
}
ACTIONS.bill = (btn) => openBillModal(btn.dataset.id);

// ================= Order form (one or more cylinder types + deposit) =================
function orderFormHtml(p, { customers } = {}) {
  if (!TYPES.length) return emptyState("No cylinder types yet", "Ask the admin to add cylinder types and prices.");
  return `
    ${customers ? `<div class="field"><label for="${p}-customer">Customer</label>
      <select id="${p}-customer">${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)} (${c.id})</option>`).join("")}</select></div>` : ""}
    <label>Cylinders</label>
    <div id="${p}-lines"></div>
    <button type="button" class="btn btn-sm btn-secondary" id="${p}-addline" style="margin:0.2em 0 1em;">+ Add another cylinder type</button>
    <div id="${p}-warn"></div>
    <div class="bill-box">
      <div class="row big"><span>Total amount</span><b id="${p}-total">—</b></div>
      <div class="row"><span>Minimum payable amount (<span id="${p}-pct">${SETTINGS.min_deposit_percent}</span>% of total)</span><b id="${p}-min">—</b></div>
    </div>
    <div class="field">
      <div class="label-row"><label for="${p}-dep">Total Deposit Made (Rs.)</label>
        <button type="button" class="btn btn-ghost btn-sm" id="${p}-usemin">Use minimum</button></div>
      <input id="${p}-dep" type="number" step="0.01" inputmode="decimal" />
      <div class="field-hint" id="${p}-hint"></div>
    </div>
    <button class="btn btn-primary btn-block" id="${p}-confirm" disabled>Confirm order</button>`;
}

function wireOrderForm(p, onSuccess) {
  const $ = (s) => document.getElementById(`${p}-${s}`);
  if (!$("lines")) return;
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const rows = () => Array.from($("lines").querySelectorAll(".ol-row"));
  const typeOf = (row) => TYPES.find((t) => t.id === row.querySelector(".ol-type").value);
  let touched = false; // becomes true once the person edits the deposit themselves

  function lineHtml(typeId) {
    return `<div class="ol-row">
      <select class="ol-type" aria-label="Cylinder type">${TYPES.map((t) => `<option value="${t.id}" ${t.id === typeId ? "selected" : ""}>${escapeHtml(t.gas_type)} · ${escapeHtml(t.size)} — ${inr(t.price)} each</option>`).join("")}</select>
      <input class="ol-qty" type="number" min="1" value="1" aria-label="Quantity" />
      <button type="button" class="btn btn-ghost btn-sm ol-remove" aria-label="Remove this line" title="Remove">✕</button>
      <div class="ol-sub"></div></div>`;
  }

  function calc() {
    const used = new Set(rows().map((r) => r.querySelector(".ol-type").value));
    let total = 0, allValid = rows().length > 0;
    const shorts = [];
    rows().forEach((row) => {
      const sel = row.querySelector(".ol-type");
      // A type can only be picked once — the other lines can't choose it.
      sel.querySelectorAll("option").forEach((o) => { o.disabled = o.value !== sel.value && used.has(o.value); });
      const t = typeOf(row);
      const q = parseInt(row.querySelector(".ol-qty").value, 10) || 0;
      const sub = row.querySelector(".ol-sub");
      if (!t || q < 1) { allValid = false; sub.textContent = "Enter a quantity of at least 1."; sub.classList.remove("ol-short"); return; }
      total += t.price * q;
      const short = q > t.available;
      if (short) shorts.push(`${t.gas_type} ${t.size} (requested ${q}, ${t.available > 0 ? "only " + t.available + " available" : "none available"})`);
      sub.textContent = `${inr(t.price * q)} · ${t.available} available now${short ? " — not enough in stock" : ""}`;
      sub.classList.toggle("ol-short", short);
    });
    $("lines").querySelectorAll(".ol-remove").forEach((b) => (b.style.visibility = rows().length > 1 ? "visible" : "hidden"));
    $("addline").style.display = used.size >= TYPES.length ? "none" : "";

    total = allValid ? round2(total) : 0;
    const min = round2((total * SETTINGS.min_deposit_percent) / 100);
    $("total").textContent = total ? inr(total) : "—";
    $("min").textContent = total ? inr(min) : "—";
    $("warn").innerHTML = shorts.length ? `<div class="warn-box">Not enough stock for: ${escapeHtml(shorts.join("; "))}. This order will be rejected automatically.</div>` : "";

    if (!touched) $("dep").value = total ? fmt(min) : ""; // autofill with the minimum
    const dep = parseFloat($("dep").value);
    let valid = false, hint = "";
    if (!total) hint = "Choose the cylinders you need.";
    else if (isNaN(dep)) hint = `Enter an amount between ${inr(min)} and ${inr(total)}.`;
    else if (dep < min - 0.005) hint = `Deposit must be at least ${inr(min)}.`;
    else if (dep > total + 0.005) hint = `Deposit cannot be more than the total ${inr(total)}.`;
    else { valid = true; hint = `Balance of ${inr(round2(total - dep))} is paid on delivery. You can change the deposit if you wish.`; }
    $("hint").textContent = hint;
    $("hint").style.color = valid ? "var(--success)" : "var(--steel-soft)";
    $("confirm").disabled = !valid;
  }

  function addLine() {
    const used = new Set(rows().map((r) => r.querySelector(".ol-type").value));
    const next = TYPES.find((t) => !used.has(t.id));
    if (!next) return;
    $("lines").insertAdjacentHTML("beforeend", lineHtml(next.id));
    calc();
  }

  $("lines").innerHTML = lineHtml(TYPES[0].id);
  $("lines").addEventListener("input", calc);
  $("lines").addEventListener("change", calc);
  $("lines").addEventListener("click", (e) => {
    const rm = e.target.closest(".ol-remove");
    if (rm && rows().length > 1) { rm.closest(".ol-row").remove(); calc(); }
  });
  $("addline").addEventListener("click", addLine);
  $("dep").addEventListener("input", () => { touched = true; calc(); });
  $("usemin").addEventListener("click", () => { touched = false; calc(); });
  calc();

  $("confirm").addEventListener("click", async () => {
    $("confirm").disabled = true;
    try {
      const body = {
        lines: rows().map((r) => ({ type_id: r.querySelector(".ol-type").value, quantity: parseInt(r.querySelector(".ol-qty").value, 10) })),
        deposit_amount: parseFloat($("dep").value),
      };
      if ($("customer")) body.customer_id = $("customer").value;
      onSuccess(await api("/orders", { method: "POST", body }));
    } catch (e) { toast(e.message, "error"); calc(); }
  });
}

async function renderPlaceOrder() {
  await loadRefData();
  main().innerHTML = `
    ${pageHead("Place an order", "Choose what you need — you can add more than one cylinder type — and pay a deposit. We'll confirm once it's approved.")}
    <div class="panel" style="max-width:560px;">${orderFormHtml("po")}</div>`;
  wireOrderForm("po", (order) => {
    if (order.status === "Rejected") toast(order.rejection_reason, "error");
    else toast("Order request sent. You'll be notified once it is approved.");
    window.location.hash = "#overview";
  });
}

async function openNewOrderModal() {
  await loadRefData();
  const customers = await api("/customers");
  if (!customers.length) return toast("Add a customer first.", "error");
  openModal(`<h2>New order for a customer</h2>
    <p>Orders placed by staff are approved straight away, if stock is available.</p>
    ${orderFormHtml("no", { customers })}`);
  wireOrderForm("no", () => { toast("Order placed."); closeModal(); route(); });
}

// ================= Customer: in process + history =================
async function renderCustomerOverview() {
  const orders = await api("/orders");
  const { active, history } = splitRows(orders);
  main().innerHTML = `
    ${pageHead("My orders", "Track your cylinders from order to pickup.", `<a class="btn btn-primary" href="#place-order">Place an order</a>`)}
    <div class="panel">
      <h2>In process</h2>
      <p class="section-note">From the moment you order until the empty cylinder is picked up.</p>
      ${active.length ? ordersTable(active, "customer") : emptyState("Nothing in process", "Place an order to get started.")}
    </div>
    <div class="panel">
      <h2>Order history</h2>
      <p class="section-note">Finished orders. These never change.</p>
      ${history.length ? ordersTable(history, "customer", { history: true }) : emptyState("No history yet", "Returned cylinders and rejected orders will appear here.")}
    </div>`;
}

// ================= Staff/Admin: Orders page with filters =================
const ROW_STATUSES = ["Requested", "Order Placed", "Delivery Assigned", "On the Way", "In Use", "Empty - Ready to Be Collected", "Collected", "Returned", "Rejected"];

function dateRangeFor(preset) {
  const now = new Date();
  const fmt = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  if (preset === "week") { const s = new Date(now); s.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return { from: fmt(s), to: fmt(now) }; }
  if (preset === "month") return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) };
  return { from: "", to: "" };
}

async function renderOrders() {
  const role = ME.user.profile_type;
  await loadRefData();
  const customers = await api("/customers");
  main().innerHTML = `
    ${pageHead("Orders", "Active orders and finished order history.", `<button class="btn btn-primary" id="new-order-btn">New order for a customer</button>`)}
    <div class="filter-bar">
      <div class="filter-field"><label for="f-customer">Customer</label><select id="f-customer"><option value="">All customers</option>${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`).join("")}</select></div>
      <div class="filter-field"><label for="f-type">Cylinder type</label><select id="f-type"><option value="">All types</option>${TYPES.map((t) => `<option value="${t.gas_type}|${t.size}">${escapeHtml(t.gas_type)} · ${escapeHtml(t.size)}</option>`).join("")}</select></div>
      <div class="filter-field"><label for="f-status">Status</label><select id="f-status"><option value="">All</option>${ROW_STATUSES.map((s) => `<option>${s}</option>`).join("")}</select></div>
      <div class="filter-field"><label for="f-from">From date</label><input id="f-from" type="date" /></div>
      <div class="filter-field"><label for="f-to">To date</label><input id="f-to" type="date" /></div>
      <div class="filter-quick">
        <button class="btn btn-sm btn-secondary" data-preset="week">This week</button>
        <button class="btn btn-sm btn-secondary" data-preset="month">This month</button>
        <button class="btn btn-sm btn-ghost" id="clear-filters">Clear</button>
      </div>
    </div>
    <div class="panel"><h2>Active orders</h2><div id="orders-active">Loading…</div></div>
    <div class="panel"><h2>Order history</h2><p class="section-note">Finished orders never change, even when the cylinders are reused.</p><div id="orders-history"></div></div>`;
  document.getElementById("new-order-btn").addEventListener("click", openNewOrderModal);

  async function refresh() {
    const params = new URLSearchParams();
    const cust = document.getElementById("f-customer").value; if (cust) params.set("customer_id", cust);
    const type = document.getElementById("f-type").value;
    if (type) { const [g, s] = type.split("|"); params.set("gas_type", g); params.set("size", s); }
    const from = document.getElementById("f-from").value; if (from) params.set("from", from);
    const to = document.getElementById("f-to").value; if (to) params.set("to", to);
    const status = document.getElementById("f-status").value;
    const orders = await api("/orders?" + params.toString());
    let { active, history } = splitRows(orders);
    const typeMatch = (r) => {
      if (!type) return true;
      const [g, sz] = type.split("|");
      return r.item ? r.item.gas_type === g && r.item.size === sz : (r.order.lines || []).some((l) => l.gas_type === g && l.size === sz);
    };
    active = active.filter(typeMatch); history = history.filter(typeMatch);
    if (status) { active = active.filter((r) => rowStatus(r) === status); history = history.filter((r) => rowStatus(r) === status); }
    document.getElementById("orders-active").innerHTML = active.length ? ordersTable(active, role) : emptyState("No active orders match", "");
    document.getElementById("orders-history").innerHTML = history.length ? ordersTable(history, role, { history: true }) : emptyState("No finished orders match", "");
  }
  ["f-customer", "f-type", "f-status", "f-from", "f-to"].forEach((id) => document.getElementById(id).addEventListener("change", refresh));
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const { from, to } = dateRangeFor(b.dataset.preset);
    document.getElementById("f-from").value = from;
    document.getElementById("f-to").value = to;
    refresh();
  }));
  document.getElementById("clear-filters").addEventListener("click", () => {
    document.querySelectorAll(".filter-bar select, .filter-bar input").forEach((el) => (el.value = ""));
    refresh();
  });
  refresh();
}
