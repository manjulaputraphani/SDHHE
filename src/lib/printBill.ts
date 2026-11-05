import type { SaleBillDetail } from "../db/billing";
import type { ShopDetails } from "../db/settings";
import { splitGst } from "../logic/gst";
import { paiseToWords } from "../logic/moneyWords";
import { formatQuantity, formatRupees, type Unit } from "../logic/units";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** "SRI DURGA HARI HARA ENTERPRISES" → "SDHHE" (used as the watermark). */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (words || "ST").slice(0, 6);
}

/** GST rate display from basis points: 500 → "2.5", 1200 → "6". */
function rateText(rateBp: number): string {
  if (rateBp <= 0) return "0";
  return String(Number((rateBp / 200).toFixed(2)));
}

/** "2026-05-14" → "14 May 2026". */
function billDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Full SDHHE-style GST invoice as printable HTML (pure — easy to test). */
export function buildBillHtml(bill: SaleBillDetail, shop: ShopDetails): string {
  const { cgstPaise, sgstPaise } = splitGst(bill.gstPaise);
  const taxablePaise = bill.subtotalPaise - bill.discountPaise;
  const mark = shop.shortName?.trim() || initials(shop.name || "Stock Tracker");

  const rows = bill.lines
    .map((line, index) => {
      const lineGst = Math.round((line.lineTotalPaise * (bill.gstRateBp || 0)) / 10_000);
      const lineSplit = splitGst(lineGst);
      return `<tr>
        <td class="c">${index + 1}</td>
        <td>${escapeHtml(line.itemName)}</td>
        <td class="c">${escapeHtml(line.hsnCode ?? "—")}</td>
        <td class="c">${escapeHtml(line.unit.toUpperCase())}</td>
        <td class="r">${formatQuantity(line.qtyBase, line.unit as Unit)}</td>
        <td class="r">${formatRupees(line.unitPricePaise)}</td>
        <td class="c tax">${rateText(bill.gstRateBp)}%<br/><b>${formatRupees(lineSplit.cgstPaise)}</b></td>
        <td class="c tax">${rateText(bill.gstRateBp)}%<br/><b>${formatRupees(lineSplit.sgstPaise)}</b></td>
        <td class="r">${formatRupees(line.lineTotalPaise)}</td>
      </tr>`;
    })
    .join("");

  const totalQty = bill.lines.reduce((sum, line) => sum + line.qtyBase, 0);
  const units = new Set(bill.lines.map((line) => line.unit));
  const totalQtyText =
    units.size === 1 && bill.lines[0]
      ? formatQuantity(totalQty, bill.lines[0].unit as Unit)
      : `${bill.lines.length} items`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.billNo)}</title><style>
    @page{size:A4;margin:10mm}
    *{box-sizing:border-box}
    body{font-family:-apple-system,"Segoe UI",Arial,sans-serif;color:#111;margin:0;font-size:11px;line-height:1.35}
    .page{position:relative;max-width:780px;margin:0 auto;padding:14px 16px;overflow:hidden}
    .watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
    .watermark span{font-size:120px;font-weight:800;letter-spacing:.12em;color:#111;opacity:.045;transform:rotate(-30deg)}
    header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:10px}
    .brand{display:flex;gap:12px;align-items:flex-start}
    .logo{width:54px;height:54px;border:1.5px solid #333;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;letter-spacing:.06em;flex:0 0 auto}
    h1{font-size:17px;margin:0 0 3px;letter-spacing:.02em}
    .muted{color:#444;margin:1px 0}
    .invbox{border:1px solid #333;padding:8px 10px;min-width:215px}
    .invbox div{display:flex;justify-content:space-between;gap:12px;padding:1px 0}
    .invbox b{font-weight:700}
    .title{margin:12px 0 8px;text-align:center;font-size:15px;font-weight:800;letter-spacing:.22em;border-top:1px solid #999;border-bottom:1px solid #999;padding:4px 0}
    .parties{display:flex;gap:16px;margin-bottom:8px}
    .party{flex:1;border:1px solid #999;padding:7px 9px;min-height:86px}
    .party h3{margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#555}
    table{width:100%;border-collapse:collapse;margin-top:2px}
    th,td{border:1px solid #777;padding:5px 6px;vertical-align:top}
    thead th{background:#e9e9e9;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
    .r{text-align:right}
    .c{text-align:center}
    td.tax{font-size:10px;line-height:1.3}
    tfoot td{background:#f3f3f3;font-weight:700}
    .words{border:1px solid #999;padding:6px 9px;margin-top:8px}
    .bottom{display:flex;gap:16px;margin-top:10px}
    .bank{flex:1.2;border:1px solid #999;padding:7px 9px}
    .bank h3,.terms h3{margin:0 0 3px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#555}
    .bank p{margin:1px 0}
    .sums{flex:1}
    .sums div{display:flex;justify-content:space-between;padding:3px 2px;border-bottom:1px solid #ddd}
    .sums .grand{border-top:2px solid #333;border-bottom:none;font-weight:800;font-size:13px;margin-top:3px;padding-top:5px}
    .terms{margin-top:10px;border:1px solid #999;padding:7px 9px}
    .terms ol{margin:2px 0 0 16px;padding:0}
    footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px}
    .sign{text-align:center;min-width:190px}
    .sigline{margin-top:26px;border-top:1px solid #333;padding-top:3px;font-weight:600}
    .cancelled{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
    .cancelled span{border:5px solid #b91c1c;color:#b91c1c;font-size:54px;font-weight:900;letter-spacing:.2em;padding:10px 26px;transform:rotate(-24deg);opacity:.35}
    .pagefoot{margin-top:10px;display:flex;justify-content:space-between;color:#555;font-size:10px;border-top:1px solid #ccc;padding-top:4px}
    /* Narrow screens (the in-app preview on a phone) — stack the invoice blocks. */
    @media (max-width:600px){
      .page{padding:10px}
      header{flex-direction:column;gap:8px}
      .invbox{min-width:0;width:100%}
      .parties{flex-direction:column;gap:8px}
      .bottom{flex-direction:column;gap:8px}
      footer{flex-direction:column;align-items:stretch;gap:10px}
      .sign{min-width:0;width:100%}
      .watermark span{font-size:72px}
      .pagefoot{flex-direction:column;gap:2px}
    }
  </style></head><body>
  <div class="page">
    <div class="watermark"><span>${escapeHtml(mark)}</span></div>
    ${bill.cancelled ? '<div class="cancelled"><span>CANCELLED</span></div>' : ""}

    <header>
      <div class="brand">
        <div class="logo">${escapeHtml(mark)}</div>
        <div>
          <h1>${escapeHtml(shop.name || "My Shop")}</h1>
          <p class="muted">GSTIN: <b>${escapeHtml(shop.gstin || "NA")}</b></p>
          <p class="muted">${escapeHtml(shop.address || "")}</p>
          <p class="muted">${
            shop.phone ? `Phone: ${escapeHtml(shop.phone)}` : ""
          }${shop.email ? ` · Email: ${escapeHtml(shop.email)}` : ""}</p>
        </div>
      </div>
      <div class="invbox">
        <div><span>Invoice No:</span><b>${escapeHtml(bill.billNo)}</b></div>
        <div><span>Invoice Date:</span><b>${billDate(bill.saleDate)}</b></div>
        <div><span>Payment:</span><b>${escapeHtml(bill.paymentMode)}</b></div>
      </div>
    </header>

    <div class="title">TAX INVOICE</div>

    <div class="parties">
      <div class="party">
        <h3>Billed To</h3>
        <b>${escapeHtml(bill.customerName || "Walk-in customer")}</b>
        <p class="muted">GSTIN/UIN: ${escapeHtml(bill.customerGstin || "NA")}</p>
        <p class="muted">${escapeHtml(bill.customerAddress || "")}</p>
        <p class="muted">${bill.customerPhone ? `Mobile: ${escapeHtml(bill.customerPhone)}` : ""}</p>
      </div>
      <div class="party">
        <h3>Invoice Details</h3>
        <p class="muted">Bill No: <b>${escapeHtml(bill.billNo)}</b></p>
        <p class="muted">Date: ${billDate(bill.saleDate)}</p>
        <p class="muted">Payment mode: ${escapeHtml(bill.paymentMode)}</p>
        <p class="muted">Paid: ${formatRupees(bill.paidPaise)} · Balance: ${formatRupees(
          bill.totalPaise - bill.paidPaise,
        )}</p>
      </div>
    </div>

    <table>
      <thead><tr>
        <th class="c">S.No</th><th>Item name</th><th class="c">HSN code</th><th class="c">Unit</th>
        <th class="r">Qty</th><th class="r">Rate</th><th class="c">CGST</th><th class="c">SGST</th><th class="r">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="4">Total</td>
        <td class="r">${totalQtyText}</td>
        <td class="r">${formatRupees(taxablePaise)}</td>
        <td class="c">${formatRupees(cgstPaise)}</td>
        <td class="c">${formatRupees(sgstPaise)}</td>
        <td class="r">${formatRupees(bill.totalPaise)}</td>
      </tr></tfoot>
    </table>

    <div class="words">Amount in words: <b>${escapeHtml(paiseToWords(bill.totalPaise))}</b></div>

    <div class="bottom">
      <div class="bank">
        <h3>Bank Details</h3>
        <p>Bank Name: <b>${escapeHtml(shop.bankName || "—")}</b></p>
        <p>Account Number: <b>${escapeHtml(shop.bankAccount || "—")}</b></p>
        <p>IFSC Code: <b>${escapeHtml(shop.bankIfsc || "—")}</b></p>
        <p>Branch: <b>${escapeHtml(shop.bankBranch || "—")}</b></p>
      </div>
      <div class="sums">
        <div><span>Taxable Amount</span><span>${formatRupees(taxablePaise)}</span></div>
        ${bill.discountPaise > 0 ? `<div><span>Discount</span><span>−${formatRupees(bill.discountPaise)}</span></div>` : ""}
        <div><span>Total Tax Amount</span><span>${formatRupees(bill.gstPaise)}</span></div>
        <div class="grand"><span>Invoice Amount</span><span>${formatRupees(bill.totalPaise)}</span></div>
      </div>
    </div>

    <div class="terms">
      <h3>Terms and Conditions</h3>
      <ol>
        <li>Goods once sold will not be taken back.</li>
        <li>Interest @ 18% p.a. will be charged if payment is not made within the stipulated time.</li>
        <li>The above amount includes GST as applicable.</li>
      </ol>
    </div>

    <footer>
      <div>
        <p class="muted"><b>Thank you for your business!</b></p>
        <p class="muted">${escapeHtml(mark)} · GST Invoice</p>
      </div>
      <div class="sign">
        <p class="muted">For, <b>${escapeHtml(shop.name || "My Shop")}</b></p>
        <div class="sigline">Authorised Signatory</div>
      </div>
    </footer>
    <div class="pagefoot"><span>${escapeHtml(mark)} INVOICE</span><span>Page 1 of 1</span></div>
  </div>
  </body></html>`;
}

/** Print the GST bill through a hidden iframe (also offers "Save as PDF"). */
export function printBill(bill: SaleBillDetail, shop: ShopDetails): void {
  const html = buildBillHtml(bill, shop);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  const fire = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // printing must never crash the screen
    }
  };
  setTimeout(fire, 300);
  setTimeout(() => frame.remove(), 2000);
}
