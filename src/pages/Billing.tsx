import { useEffect, useMemo, useState } from "react";
import {
  createCustomer,
  createSaleBill,
  findCustomerByGstin,
  getSaleBill,
  type SaleBillDetail,
} from "../db/billing";
import { listCustomers } from "../db/customers";
import { can } from "../db/permissions";
import { listItems, type ItemRow } from "../db/items";
import { PAYMENT_MODES } from "../db/purchases";
import { getShopDetails, type ShopDetails } from "../db/settings";
import { useDb, useDbUrl } from "../lib/db-context";
import { validateGstin, type GstinCheck } from "../logic/gstin";
import { openUrl } from "@tauri-apps/plugin-opener";
import { printBill } from "../lib/printBill";
import { gstFromRate } from "../logic/gst";
import { rupeesToPaise } from "../logic/purchase";
import { baseFactor, formatQuantity, formatRupees, toBase, type Unit } from "../logic/units";

type Line = {
  itemId: number;
  name: string;
  unit: Unit;
  qtyBase: number;
  unitPricePaise: number;
  hsnCode: string | null;
  lineTotalPaise: number;
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Billing() {
  const db = useDb();
  const url = useDbUrl();

  const [items, setItems] = useState<ItemRow[]>([]);
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [date, setDate] = useState(todayLocal);
  const [customers, setCustomers] = useState<Awaited<ReturnType<typeof listCustomers>>>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerGstin, setCustomerGstin] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [gstinStatus, setGstinStatus] = useState<GstinCheck | null>(null);
  const [gstinNote, setGstinNote] = useState<string | null>(null);
  const [draftItemId, setDraftItemId] = useState<number | "">("");
  const [draftQty, setDraftQty] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [draftHsn, setDraftHsn] = useState("");
  const [draftMargin, setDraftMargin] = useState("6");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const [saleExpenses, setSaleExpenses] = useState("");
  const [gstRateBp, setGstRateBp] = useState("500");
  const [paymentMode, setPaymentMode] = useState<string>("Cash");
  const [paid, setPaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bill, setBill] = useState<SaleBillDetail | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [itemRows, shopRow, customerRows] = await Promise.all([
          listItems(db),
          getShopDetails(db),
          listCustomers(db),
        ]);
        setItems(itemRows);
        setShop(shopRow);
        setCustomers(customerRows);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [db]);

  const draftItem = items.find((i) => i.id === draftItemId) ?? null;
  const draftUnit: Unit = (draftItem?.unit as Unit) ?? "kg";
  const draftSuggestedPaise = Math.round(
    (draftItem?.avgCostPaise ?? 0) * (100 + (Number(draftMargin) || 0)) / 100,
  );

  const totals = useMemo(() => {
    const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
    const discountPaise = rupeesToPaise(discount || "0");
    const taxablePaise = Math.max(0, subtotalPaise - discountPaise);
    const gstPaise = gstFromRate(taxablePaise, Number(gstRateBp) || 0);
    return { subtotalPaise, discountPaise, taxablePaise, gstPaise, totalPaise: taxablePaise + gstPaise };
  }, [discount, gstRateBp, lines]);

  async function onGstinChange(value: string) {
    setCustomerGstin(value);
    setGstinNote(null);
    const raw = value.trim().toUpperCase();
    if (raw.length !== 15) {
      setGstinStatus(null);
      return;
    }
    const check = validateGstin(raw);
    setGstinStatus(check);
    if (!check.valid) return;
    try {
      const saved = await findCustomerByGstin(db, check.normalized);
      if (saved) {
        setCustomerName(saved.name);
        setCustomerPhone(saved.phone ?? "");
        setCustomerAddress(saved.address ?? "");
        setCustomerEmail(saved.email ?? "");
        setGstinNote("Loaded saved customer details — edit if needed");
      }
    } catch {
      // Lookup is a convenience; never block billing on it.
    }
  }

  const GST_PORTAL = "https://services.gst.gov.in/services/searchtp";

  async function openGstPortal() {
    try {
      await openUrl(GST_PORTAL);
    } catch {
      try {
        window.open(GST_PORTAL, "_blank", "noopener");
      } catch {
        // opening the browser must never crash the form
      }
    }
  }

  function addLine() {
    setError(null);
    setSuccess(null);
    if (!draftItem) {
      setError("Choose an item");
      return;
    }
    const qtyBase = toBase(Number(draftQty) || 0, draftUnit);
    if (qtyBase <= 0) {
      setError("Enter a quantity");
      return;
    }
    const unitPricePaise = rupeesToPaise(draftPrice || "0");
    const factor = baseFactor(draftUnit);
    const lineTotalPaise = Math.round((qtyBase * unitPricePaise) / factor);
    setLines((prev) => [
      ...prev,
      {
        itemId: draftItem.id,
        name: draftItem.name,
        unit: draftUnit,
        qtyBase,
        unitPricePaise,
        hsnCode: draftHsn.trim() || draftItem.hsnCode || null,
        lineTotalPaise,
      },
    ]);
    setDraftQty("");
    setDraftPrice("");
    setDraftHsn("");
  }

  async function save() {
    setError(null);
    setSuccess(null);
    if (lines.length === 0) {
      setError("Add at least one item");
      return;
    }
    if (paymentMode === "Credit" && !customerName.trim()) {
      setError("Choose a customer for a credit sale");
      return;
    }
    setSaving(true);
    try {
      let customerId: number | undefined;
      if (customerName.trim()) {
        const customer = await createCustomer(db, {
          name: customerName,
          phone: customerPhone,
          address: customerAddress,
          gstin: customerGstin,
          email: customerEmail,
        });
        customerId = customer.id;
      }
      const created = await createSaleBill(url, {
        customerId,
        date,
        paymentMode,
        paidPaise: paid.trim() ? rupeesToPaise(paid) : undefined,
        discountPaise: totals.discountPaise,
        saleExpensesPaise: saleExpenses.trim() ? rupeesToPaise(saleExpenses) : 0,
        gstPaise: totals.gstPaise,
        gstRateBp: Number(gstRateBp) || 0,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          qtyBase: line.qtyBase,
          unitPricePaise: line.unitPricePaise,
          hsnCode: line.hsnCode ?? undefined,
        })),
      });
      setSuccess(`Saved ${created.billNo} — ${formatRupees(created.totalPaise)}`);
      const detail = await getSaleBill(db, created.saleId);
      setBill(detail);
      setLines([]);
      setDiscount("");
      setSaleExpenses("");
      setPaid("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setCustomerGstin("");
      setCustomerEmail("");
      setGstinStatus(null);
      setGstinNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-4">
      <h1 className="page-title">GST Billing</h1>

      {shop && !shop.name && (
        <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent-ink ring-1 ring-accent/30">
          Add your shop name and GSTIN in Settings → Shop details so they print on the bill.
        </p>
      )}

      <form
        data-testid="billing-form"
        className="max-w-3xl space-y-4 card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="label" htmlFor="bill-date">
              Date
            </label>
            <input
              id="bill-date"
              type="date"
              className="input w-full"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-customer">
              Customer (optional)
            </label>
            <input
              id="bill-customer"
              className="input w-full"
              placeholder="Name"
              list="bill-customer-options"
              value={customerName}
              onChange={(e) => setCustomerName(e.currentTarget.value)}
            />
            {/* Saved clients — pick one and the details fill in. */}
            <datalist id="bill-customer-options">
              {customers.map((customer) => (
                <option key={customer.id} value={customer.name}>
                  {customer.phone ?? ""}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-phone">
              Phone
            </label>
            <input
              id="bill-phone"
              className="input w-full"
              placeholder="10 digits"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <label className="label" htmlFor="bill-address">
              Billing address
            </label>
            <input
              id="bill-address"
              className="input w-full"
              placeholder="Street, city, state, PIN"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-gstin">
              Customer GSTIN
            </label>
            <input
              id="bill-gstin"
              className="input w-full uppercase"
              value={customerGstin}
              onChange={(e) => void onGstinChange(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="label" htmlFor="bill-email">
              Customer email (for the bill)
            </label>
            <input
              id="bill-email"
              type="email"
              className="input w-full"
              placeholder="buyer@example.com"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-ghost" data-testid="gst-portal" onClick={() => void openGstPortal()}>
            Search GSTIN on portal
          </button>
          {gstinNote && <span className="text-sm text-success-ink">{gstinNote}</span>}
          {gstinStatus && !gstinStatus.valid && (
            <span className="text-sm text-accent-ink">{gstinStatus.reason}</span>
          )}
        </div>
        <p className="text-xs text-muted">
          The GST portal has no public API. Open it, enter the GSTIN + captcha, then copy the legal
          name and address here — saved customers auto-fill next time.
        </p>

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <div className="space-y-1">
            <label className="label" htmlFor="bill-item">
              Item
            </label>
            <select
              id="bill-item"
              className="input w-full"
              value={draftItemId}
              onChange={(e) => {
                const id = e.currentTarget.value === "" ? "" : Number(e.currentTarget.value);
                const picked = items.find((item) => item.id === id);
                setDraftItemId(id);
                setDraftHsn(picked?.hsnCode ?? "");
              }}
            >
              <option value="">Choose an item…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-qty">
              Qty ({draftUnit})
            </label>
            <input
              id="bill-qty"
              type="number"
              step="any"
              className="input w-full"
              value={draftQty}
              onChange={(e) => setDraftQty(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLine();
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-price">
              Rate (₹ per {draftUnit})
            </label>
            <input
              id="bill-price"
              type="number"
              step="any"
              className="input w-full"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLine();
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-hsn">
              HSN
            </label>
            <input
              id="bill-hsn"
              className="input w-full"
              value={draftHsn}
              onChange={(e) => setDraftHsn(e.currentTarget.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-ghost"
              data-testid="billing-add-line"
              onClick={addLine}
            >
              Add
            </button>
          </div>
        </div>

        {draftItem && draftItem.avgCostPaise > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
            <span>
              Avg cost: <b className="text-ink">{formatRupees(draftItem.avgCostPaise)}</b> / {draftUnit}
            </span>
            <label className="flex items-center gap-1">
              Margin
              <input
                className="input h-7 w-16 px-2 text-xs"
                type="number"
                value={draftMargin}
                onChange={(e) => setDraftMargin(e.currentTarget.value)}
              />
              %
            </label>
            <span>
              Suggested: <b className="text-ink">{formatRupees(draftSuggestedPaise)}</b> / {draftUnit}
            </span>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setDraftPrice(String(draftSuggestedPaise / 100))}
            >
              Use suggested
            </button>
          </div>
        )}

        {lines.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1">Qty</th>
                <th className="py-1">Rate</th>
                <th className="py-1 text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.itemId}-${index}`} className="border-t border-line">
                  <td className="py-1.5">{line.name}</td>
                  <td className="py-1.5">{formatQuantity(line.qtyBase, line.unit)}</td>
                  <td className="py-1.5">{formatRupees(line.unitPricePaise)}</td>
                  <td className="py-1.5 text-right">{formatRupees(line.lineTotalPaise)}</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      className="text-sm text-error-ink underline"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <label className="label" htmlFor="bill-discount">
              Discount (₹)
            </label>
            <input
              id="bill-discount"
              type="number"
              step="any"
              className="input w-full"
              value={discount}
              onChange={(e) => setDiscount(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-sale-expenses">
              Delivery / packing (₹)
            </label>
            <input
              id="bill-sale-expenses"
              type="number"
              step="any"
              className="input w-full"
              value={saleExpenses}
              onChange={(e) => setSaleExpenses(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-gst">
              GST %
            </label>
            <select
              id="bill-gst"
              className="input w-full"
              value={gstRateBp}
              onChange={(e) => setGstRateBp(e.currentTarget.value)}
            >
              <option value="0">0%</option>
              <option value="500">5%</option>
              <option value="1200">12%</option>
              <option value="1800">18%</option>
              <option value="2800">28%</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-payment">
              Payment
            </label>
            <select
              id="bill-payment"
              className="input w-full"
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.currentTarget.value)}
            >
              {PAYMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="bill-paid">
              Paid (₹)
            </label>
            <input
              id="bill-paid"
              type="number"
              step="any"
              className="input w-full"
              placeholder="full"
              value={paid}
              onChange={(e) => setPaid(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
          Subtotal {formatRupees(totals.subtotalPaise)} · GST {formatRupees(totals.gstPaise)} ·{" "}
          <span className="font-semibold">Total {formatRupees(totals.totalPaise)}</span>
        </div>

        {error && (
          <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
            {error}
          </p>
        )}
        {success && !error && (
          <p role="status" className="rounded bg-success-soft px-3 py-2 text-sm text-success-ink">
            {success}
          </p>
        )}

        {can("billing", "create") && (
          <button type="submit" className="btn-primary" data-testid="billing-save" disabled={saving}>
            Save bill (F2)
          </button>
        )}
      </form>

      {bill && (
        <section data-testid="bill-preview" className="max-w-3xl space-y-3 card p-4">
          <h2 className="text-lg font-semibold tracking-tight">Bill {bill.billNo}</h2>
          <ul className="space-y-0.5 text-sm text-ink">
            {bill.lines.map((line) => (
              <li key={`${line.itemName}-${line.qtyBase}`}>
                {line.itemName} · {formatQuantity(line.qtyBase, line.unit as Unit)} ·{" "}
                {formatRupees(line.lineTotalPaise)}
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Subtotal {formatRupees(bill.subtotalPaise)} · GST {formatRupees(bill.gstPaise)} · Total{" "}
            {formatRupees(bill.totalPaise)} · Paid {formatRupees(bill.paidPaise)}
          </p>
          <button
            type="button"
            className="btn-primary"
            data-testid="bill-print"
            onClick={() => shop && printBill(bill, shop)}
          >
            Print / Save PDF
          </button>
        </section>
      )}
    </div>
  );
}
