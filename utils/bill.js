const { round2, customerOf } = require("./workflow");

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""); }
function threeDigits(n) {
  let s = "";
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " "; }
  if (n) s += twoDigits(n);
  return s;
}

// Indian numbering: thousand, lakh, crore.
function amountInWords(amount) {
  const rupees = Math.floor(amount + 1e-9);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";
  const parts = [];
  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1e3);
  const rest = rupees % 1e3;
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  let words = "Rupees " + (parts.join(" ") || "Zero");
  if (paise) words += " and " + twoDigits(paise) + " Paise";
  return words + " Only";
}

function buildBill(db, order) {
  const s = db.settings;
  const { customer, user } = customerOf(db, order);

  const groups = {};
  for (const it of order.items) {
    const key = `${it.gas_type}|${it.size}`;
    if (!groups[key]) groups[key] = { gas_type: it.gas_type, size: it.size, rate: it.unit_price, qty: 0 };
    groups[key].qty += 1;
  }
  const lines = Object.values(groups).map((g, i) => ({
    sn: i + 1,
    description: `${g.gas_type} gas cylinder - ${g.size} (filled)`,
    qty: g.qty,
    rate: g.rate,
    amount: round2(g.qty * g.rate),
  }));
  const subtotal = round2(lines.reduce((n, l) => n + l.amount, 0));
  const adjustment = round2(order.total_amount - subtotal);
  if (Math.abs(adjustment) > 0.005) {
    lines.push({ sn: lines.length + 1, description: "Adjustment (as approved by admin)", qty: "", rate: "", amount: adjustment });
  }
  const total = round2(order.total_amount);
  const paid = round2(order.amount_paid);
  const pending = round2(total - paid);

  return {
    invoice_no: "INV-" + order.id.replace("ORD-", ""),
    order_id: order.id,
    date: order.delivered_at || order.created_at,
    business: {
      name: s.business_name,
      address: s.business_address || "",
      phone: s.business_phone || "",
      gstin: s.business_gstin || "",
    },
    customer: {
      id: customer ? customer.id : "",
      name: user ? user.full_name : "",
      address: user ? user.address || "" : "",
      phone: user ? user.phone || "" : "",
      type: customer ? customer.customer_type : "",
    },
    lines,
    total, paid, pending,
    amount_in_words: amountInWords(total),
    payment_status: pending <= 0.005 ? "PAID" : paid > 0 ? "PARTIALLY PAID" : "PENDING",
    bill_adjusted: !!order.bill_adjusted,
  };
}

const money = (n) => "Rs. " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderBillPdf(doc, b) {
  const L = 40, R = 555;
  const dateStr = new Date(b.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  // Header
  doc.fillColor("#17222B").font("Helvetica-Bold").fontSize(20).text(b.business.name, L, 40, { width: 320 });
  let y = doc.y + 2;
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  if (b.business.address) { doc.text(b.business.address, L, y, { width: 320 }); y = doc.y; }
  if (b.business.phone) { doc.text("Phone: " + b.business.phone, L, y, { width: 320 }); y = doc.y; }
  if (b.business.gstin) { doc.text("GSTIN: " + b.business.gstin, L, y, { width: 320 }); y = doc.y; }

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#17222B").text("BILL / INVOICE", 360, 40, { width: 195, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  doc.text("Invoice No: " + b.invoice_no, 360, 64, { width: 195, align: "right" });
  doc.text("Date: " + dateStr, 360, 77, { width: 195, align: "right" });
  doc.text("Order ID: " + b.order_id, 360, 90, { width: 195, align: "right" });

  y = Math.max(y, 112) + 8;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor("#17222B").stroke();

  // Bill to
  y += 12;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#777777").text("BILL TO", L, y);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text(b.customer.name || "-", L, y + 12, { width: 330 });
  let by = doc.y + 1;
  doc.font("Helvetica").fontSize(9).fillColor("#444444");
  if (b.customer.address) { doc.text(b.customer.address, L, by, { width: 330 }); by = doc.y; }
  if (b.customer.phone) { doc.text("Phone: " + b.customer.phone, L, by, { width: 330 }); by = doc.y; }
  doc.text("Customer ID: " + b.customer.id + (b.customer.type ? "  |  " + b.customer.type : ""), L, by, { width: 330 });
  by = doc.y;

  doc.font("Helvetica-Bold").fontSize(8).fillColor("#777777").text("PAYMENT STATUS", 380, y, { width: 175, align: "right" });
  const statusColor = b.payment_status === "PAID" ? "#3F7D4F" : b.payment_status === "PENDING" ? "#B33A3A" : "#D9782B";
  doc.font("Helvetica-Bold").fontSize(13).fillColor(statusColor).text(b.payment_status, 380, y + 12, { width: 175, align: "right" });

  // Table
  y = Math.max(by, y + 40) + 16;
  doc.rect(L, y, R - L, 22).fill("#EEF0EC");
  doc.fillColor("#17222B").font("Helvetica-Bold").fontSize(9);
  doc.text("S.No", L + 6, y + 7, { width: 30 });
  doc.text("Description", L + 40, y + 7, { width: 240 });
  doc.text("Qty", 330, y + 7, { width: 50, align: "right" });
  doc.text("Rate", 385, y + 7, { width: 80, align: "right" });
  doc.text("Amount", 470, y + 7, { width: 80, align: "right" });
  y += 22;
  doc.font("Helvetica").fontSize(10).fillColor("#111111");
  for (const l of b.lines) {
    doc.text(String(l.sn), L + 6, y + 8, { width: 30 });
    doc.text(l.description, L + 40, y + 8, { width: 240 });
    doc.text(String(l.qty), 330, y + 8, { width: 50, align: "right" });
    doc.text(l.rate === "" ? "" : money(l.rate), 385, y + 8, { width: 80, align: "right" });
    doc.text(money(l.amount), 470, y + 8, { width: 80, align: "right" });
    y += 28;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor("#D7DAD2").stroke();
  }

  // Totals
  y += 12;
  const row = (label, value, bold, color) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor(color || "#111111");
    doc.text(label, 330, y, { width: 130, align: "right" });
    doc.text(value, 465, y, { width: 90, align: "right" });
    y += bold ? 20 : 17;
  };
  row("Total Bill Amount", money(b.total), true);
  row("Total Amount Paid", money(b.paid), false, "#3F7D4F");
  doc.moveTo(330, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor("#999999").stroke();
  y += 3;
  row("Pending Amount", money(b.pending), true, b.pending > 0.005 ? "#B33A3A" : "#3F7D4F");

  y += 8;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#777777").text("AMOUNT IN WORDS", L, y);
  doc.font("Helvetica").fontSize(10).fillColor("#111111").text(b.amount_in_words, L, y + 12, { width: 300 });

  // Footer
  const fy = 730;
  doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.5).strokeColor("#D7DAD2").stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#777777")
    .text("Empty cylinders remain the property of " + b.business.name + " and must be returned after use.", L, fy + 8, { width: 300 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111")
    .text("For " + b.business.name, 360, fy + 8, { width: 195, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor("#777777")
    .text("Authorised Signatory", 360, fy + 34, { width: 195, align: "right" });
}

module.exports = { buildBill, renderBillPdf, amountInWords };
