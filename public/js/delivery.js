// ================= Delivery person dashboard =================
// They only ever see the jobs assigned to them. Each job is its own record, so finished
// jobs stay exactly as they were, no matter what later happens to the cylinders.

const TASK_LABEL = { delivery: "Delivery", pickup: "Pickup", refill: "Refill run" };

function taskCardHtml(t) {
  const cust = t.type !== "refill";
  const actionLabel = {
    "delivery|Assigned": ["task-start", "Pick up cylinders from store"],
    "delivery|In Transit": ["task-deliver", "Mark delivered"],
    "pickup|Assigned": ["task-collect", "Mark collected from customer"],
    "pickup|Collected": ["task-drop", "Dropped at store — mark returned"],
    "refill|Refilling": ["task-refill-back", "Brought back to store — mark delivered"],
  }[`${t.type}|${t.status}`];
  return `<div class="task-card type-${t.type}">
    <div class="task-head">
      <div><span class="task-kind">${TASK_LABEL[t.type]}</span> · <b class="mono">${t.id}</b>${t.order_id ? ` <span class="assigned-note">· order ${t.order_id}</span>` : ""}</div>
      <span class="tag ${statusTagClass(t.status)}">${t.status}</span>
    </div>
    ${cust ? `<div class="task-info">
      <div class="info-block"><small>${t.type === "delivery" ? "Deliver to" : "Collect from"}</small><div class="v"><b>${escapeHtml(t.customer_name || "—")}</b><br>${escapeHtml(t.customer_address || "")}</div></div>
      <div class="info-block"><small>Customer phone</small><div class="v mono">${escapeHtml(t.customer_phone || "—")}</div>
        ${t.customer_phone ? `<div class="contact-actions"><button class="btn btn-sm btn-secondary" data-act="copy" data-text="${escapeHtml(t.customer_phone)}">Copy number</button><a class="btn btn-sm btn-primary" href="tel:${escapeHtml(t.customer_phone)}">Call</a></div>` : ""}</div>
      ${t.type === "delivery" ? `<div class="balance-box"><small style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.05em;color:#A4581A;">Balance to collect on delivery</small>
        <div class="amt">${inr(t.balance_due)}</div>
        <div class="assigned-note">Total ${inr(t.total_amount)} · Paid ${inr(t.amount_paid)}</div></div>` : ""}
    </div>${t.type === "pickup" && t.status === "Collected" ? `<p class="section-note" style="margin:-0.4em 0 0.8em;">Collected from the customer. Now take the cylinders to the store, drop them, then mark them returned.</p>` : ""}` : `<p class="section-note">Take these cylinders for refilling and bring them back to the store.</p>`}
    <div class="table-wrap"><table>
      <thead><tr><th class="num">Cylinder</th><th>Batch</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>${t.items.map((i) => `<tr><td class="num">${escapeHtml(i.cylinder_id)}</td><td class="num">${escapeHtml(i.batch_number)}</td>
        <td>${escapeHtml(i.size)} ${escapeHtml(i.gas_type)}</td><td><span class="tag ${statusTagClass(i.status)}">${i.status}</span></td></tr>`).join("")}</tbody>
    </table></div>
    ${actionLabel ? `<div class="task-actions"><button class="btn btn-primary" data-act="${actionLabel[0]}" data-id="${t.id}">${actionLabel[1]}</button></div>` : ""}
  </div>`;
}

async function renderDeliveryOverview() {
  const [tasks, me] = await Promise.all([api("/tasks"), api("/auth/me")]);
  CACHE.tasks = tasks;
  const active = tasks.filter((t) => !["Delivered", "Dropped"].includes(t.status)).reverse();
  const done = tasks.filter((t) => ["Delivered", "Dropped"].includes(t.status));
  const status = me.user.delivery_status;
  const busy = status === "On Delivery";

  const historyRows = [];
  done.forEach((t) => t.items.forEach((i) => historyRows.push({ t, i })));

  main().innerHTML = `
    ${pageHead("My deliveries", "Jobs assigned to you.")}
    <div class="panel">
      <h2>Availability</h2>
      <div class="pill-select">
        ${busy ? `<span class="badge-auto">On Delivery — updates automatically when your job is done</span>` : ""}
        ${["Available", "Off Duty"].map((s) => `<button class="btn btn-sm ${status === s ? "btn-primary" : "btn-secondary"}" data-act="set-status" data-status="${s}" ${busy ? "disabled" : ""}>${s}</button>`).join("")}
      </div>
      <div class="field-hint" style="margin-top:0.7em;">${busy ? "You can't change this while you have an active job." : "You're Available by default. Choose Off Duty when you're not working."}</div>
    </div>
    <h2 style="margin:1.4em 0 0.8em;">Active jobs</h2>
    ${active.length ? active.map(taskCardHtml).join("") : `<div class="panel">${emptyState("No active jobs", "New deliveries, pickups and refill runs assigned to you will appear here.")}</div>`}
    <div class="panel">
      <h2>Delivery history</h2>
      <p class="section-note">Finished jobs. These never change.</p>
      ${historyRows.length ? `<div class="table-wrap"><table>
        <thead><tr><th class="num">Job</th><th>Kind</th><th>Customer</th><th class="num">Cylinder</th><th>Type</th><th>Status</th><th>Completed</th></tr></thead>
        <tbody>${historyRows.map(({ t, i }) => `<tr><td class="num">${t.id}</td><td>${TASK_LABEL[t.type]}</td><td>${escapeHtml(t.customer_name || "—")}</td>
          <td class="num">${escapeHtml(i.cylinder_id)}</td><td>${escapeHtml(i.size)} ${escapeHtml(i.gas_type)}</td>
          <td><span class="tag ${statusTagClass(i.status)}">${i.status}</span></td><td>${fmtDate(t.completed_at)}</td></tr>`).join("")}</tbody></table></div>`
        : emptyState("No history yet", "")}
    </div>`;
}

ACTIONS["set-status"] = async (btn) => {
  await api("/users/me/delivery-status", { method: "PUT", body: { delivery_status: btn.dataset.status } });
  toast("Availability updated.");
  route();
};

ACTIONS["task-start"] = async (btn) => {
  await api(`/tasks/${btn.dataset.id}/start`, { method: "PUT" });
  toast("Picked up — now In Transit.");
  route();
};

ACTIONS["task-collect"] = async (btn) => {
  if (!confirm("Confirm you have collected the empty cylinder(s) from the customer?")) return;
  await api(`/tasks/${btn.dataset.id}/collected`, { method: "PUT" });
  toast("Collected. Now drop them at the store and mark them returned.");
  route();
};

ACTIONS["task-drop"] = async (btn) => {
  if (!confirm("Confirm you have dropped the empty cylinder(s) at the store?")) return;
  await api(`/tasks/${btn.dataset.id}/dropped`, { method: "PUT" });
  toast("Dropped at store — job complete.");
  route();
};

ACTIONS["task-refill-back"] = async (btn) => {
  if (!confirm("Confirm the refilled cylinders are back in the store?")) return;
  await api(`/tasks/${btn.dataset.id}/delivered`, { method: "PUT" });
  toast("Delivered — cylinders are back in stock.");
  route();
};

// Delivering to a customer: the remaining bill must be paid, with proof, before handing over.
ACTIONS["task-deliver"] = (btn) => {
  const t = CACHE.tasks.find((x) => x.id === btn.dataset.id);
  const due = t.balance_due || 0;
  openModal(`
    <h2>Hand over to ${escapeHtml(t.customer_name || "customer")}</h2>
    ${due > 0.005 ? `
      <div class="balance-box"><div class="assigned-note">Collect the remaining payment first</div><div class="amt">${inr(due)}</div>
        <div class="assigned-note">Total ${inr(t.total_amount)} · Paid ${inr(t.amount_paid)}</div></div>
      <label class="check-row"><input type="checkbox" id="proof-check" /> I have seen proof of payment for ${inr(due)}</label>` :
      `<p>The bill is already fully paid. You can hand over the cylinders.</p>`}
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="deliver-confirm" ${due > 0.005 ? "disabled" : ""}>Mark delivered</button>
    </div>`);
  const chk = document.getElementById("proof-check");
  const confirmBtn = document.getElementById("deliver-confirm");
  if (chk) chk.addEventListener("change", () => { confirmBtn.disabled = !chk.checked; });
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    try {
      await api(`/tasks/${t.id}/delivered`, { method: "PUT", body: { payment_verified: true } });
      toast("Delivered. Payment recorded.");
      closeModal(); route();
    } catch (e) { toast(e.message, "error"); confirmBtn.disabled = false; }
  });
};
