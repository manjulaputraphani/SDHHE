import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { listItems, type ItemRow } from "../db/items";
import {
  addPurchase,
  getLastPurchase,
  listSuppliers,
  parsePurchaseInput,
  PAYMENT_MODES,
} from "../db/purchases";
import { useDb } from "../lib/db-context";
import { computeTotalPaise, formatPriceChange, rupeesToPaise } from "../logic/purchase";
import { formatRupees, type Unit } from "../logic/units";

function todayLocal(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export default function AddPurchase() {
  const db = useDb();
  const [searchParams] = useSearchParams();
  const preselect = searchParams.get("item");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [itemId, setItemId] = useState<number | "">("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [expenses, setExpenses] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [supplier, setSupplier] = useState("");
  const [paymentMode, setPaymentMode] = useState<string>("Cash");
  const [note, setNote] = useState("");
  const [last, setLast] = useState<{ unitPricePaise: number; date: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, names] = await Promise.all([listItems(db), listSuppliers(db)]);
        if (cancelled) return;
        setItems(rows);
        setSuppliers(names);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const selected = items.find((i) => i.id === itemId) ?? null;
  const unit: Unit = (selected?.unit as Unit) ?? "kg";

  // Preview must never throw while the user is still typing (e.g. "-" or "-1").
  const totalPaise = useMemo(() => {
    const q = Number(qty) || 0;
    const p = rupeesToPaise(price);
    if (q <= 0 || p <= 0) return 0;
    return computeTotalPaise(q, p, unit);
  }, [qty, price, unit]);

  const loadLastPrice = useCallback(
    async (id: number) => {
      try {
        const previous = await getLastPurchase(db, id);
        setLast(previous);
        if (previous) setPrice((previous.unitPricePaise / 100).toString());
      } catch {
        setLast(null);
      }
    },
    [db],
  );

  // Deep link from the dashboard's low-stock list: /purchases/new?item=3
  useEffect(() => {
    if (!preselect || items.length === 0) return;
    const id = Number(preselect);
    if (!items.some((item) => item.id === id)) return;
    setItemId(id);
    void loadLastPrice(id);
  }, [items, preselect, loadLastPrice]);

  async function onSelectItem(value: string) {
    setError(null);
    setSuccess(null);
    if (value === "") {
      setItemId("");
      setLast(null);
      return;
    }
    const id = Number(value);
    setItemId(id);
    await loadLastPrice(id);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const pricePaise = rupeesToPaise(price);
      const input = parsePurchaseInput({
        itemId: itemId === "" ? undefined : itemId,
        supplierName: supplier,
        qty: Number(qty),
        unitPricePaise: pricePaise,
        expensesPaise: expenses.trim() ? rupeesToPaise(expenses) : 0,
        date: date || todayLocal(),
        paymentMode: paymentMode as (typeof PAYMENT_MODES)[number],
        note,
      });
      await addPurchase(db, input);

      const change = formatPriceChange(pricePaise, last?.unitPricePaise ?? 0);
      setSuccess(
        `Saved ${formatRupees(totalPaise)}${change ? ` — ${change}` : ""}`,
      );

      setQty("");
      setPrice("");
      setExpenses("");
      setNote("");
      setSupplier("");
      if (itemId !== "") await loadLastPrice(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Add Purchase</h1>

      <form className="max-w-xl space-y-4 card p-4" onSubmit={save}>
        <div className="space-y-1">
          <label className="label" htmlFor="purchase-item">
            Item
          </label>
          <select
            id="purchase-item"
            className="input w-full"
            value={itemId}
            onChange={(e) => void onSelectItem(e.currentTarget.value)}
          >
            <option value="">Choose an item…</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="label" htmlFor="purchase-qty">
              Quantity ({unit})
            </label>
            <input
              id="purchase-qty"
              type="number"
              step="any"
              className="input w-full"
              value={qty}
              onChange={(e) => setQty(e.currentTarget.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="label" htmlFor="purchase-price">
              Unit price (₹ per {unit})
            </label>
            <input
              id="purchase-price"
              type="number"
              step="any"
              className="input w-full"
              value={price}
              onChange={(e) => setPrice(e.currentTarget.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="label" htmlFor="purchase-expenses">
              Transport / loading (₹)
            </label>
            <input
              id="purchase-expenses"
              type="number"
              step="any"
              className="input w-full"
              value={expenses}
              onChange={(e) => setExpenses(e.currentTarget.value)}
            />
          </div>
        </div>

        {last && (
          <p className="text-sm text-muted">
            Last price: {formatRupees(last.unitPricePaise)} ({last.date})
          </p>
        )}

        <div className="flex items-center justify-between rounded bg-surface-2 px-3 py-2">
          <span className="text-sm text-ink">Total</span>
          <span className="text-lg font-semibold" aria-live="polite">
            {formatRupees(totalPaise)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="label" htmlFor="purchase-date">
              Date
            </label>
            <input
              id="purchase-date"
              type="date"
              className="input w-full"
              value={date}
              onChange={(e) => setDate(e.currentTarget.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="label" htmlFor="purchase-payment">
              Payment mode
            </label>
            <select
              id="purchase-payment"
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
        </div>

        <div className="space-y-1">
          <label className="label" htmlFor="purchase-supplier">
            Supplier (optional)
          </label>
          <input
            id="purchase-supplier"
            list="supplier-names"
            className="input w-full"
            value={supplier}
            onChange={(e) => setSupplier(e.currentTarget.value)}
          />
          <datalist id="supplier-names">
            {suppliers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1">
          <label className="label" htmlFor="purchase-note">
            Note (optional)
          </label>
          <input
            id="purchase-note"
            className="input w-full"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
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

        <button
          type="submit"
          className="w-full btn-primary"
          disabled={saving}
        >
          Save purchase
        </button>
      </form>
    </div>
  );
}
