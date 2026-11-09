import { useCallback, useEffect, useState, type FormEvent } from "react";
import { listItems, type ItemRow } from "../db/items";
import LoadingMark from "../components/LoadingMark";
import {
  deletePurchase,
  listPurchases,
  PAYMENT_MODES,
  updatePurchase,
  type PurchaseListRow,
} from "../db/purchases";
import { useDb, useDbUrl } from "../lib/db-context";
import { can } from "../db/permissions";
import { rupeesToPaise } from "../logic/purchase";
import { formatQuantity, formatRupees, fromBase, type Unit } from "../logic/units";

type EditForm = {
  qty: string;
  price: string;
  date: string;
  supplier: string;
  paymentMode: string;
  note: string;
};

export default function Purchases() {
  const db = useDb();
  const url = useDbUrl();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [rows, setRows] = useState<PurchaseListRow[]>([]);
  const [itemId, setItemId] = useState<number | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PurchaseListRow | null>(null);
  const [edit, setEdit] = useState<EditForm>({
    qty: "",
    price: "",
    date: "",
    supplier: "",
    paymentMode: "Cash",
    note: "",
  });
  const [deleting, setDeleting] = useState<PurchaseListRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listItems(db);
        if (!cancelled) setItems(list);
      } catch {
        /* the item filter is optional — a failure here should not block the table */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(
        await listPurchases(db, {
          itemId: itemId === "" ? undefined : itemId,
          from: from || undefined,
          to: to || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [db, itemId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(row: PurchaseListRow) {
    setError(null);
    setEditing(row);
    setEdit({
      qty: String(fromBase(row.qtyBase, row.unit as Unit)),
      price: String(row.unitPricePaise / 100),
      date: row.date,
      supplier: row.supplier ?? "",
      paymentMode: row.paymentMode ?? "Cash",
      note: row.note ?? "",
    });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    setBusy(true);
    try {
      await updatePurchase(url, editing.id, {
        qty: Number(edit.qty),
        unitPricePaise: rupeesToPaise(edit.price),
        date: edit.date,
        supplierName: edit.supplier,
        paymentMode: edit.paymentMode as (typeof PAYMENT_MODES)[number],
        note: edit.note,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setError(null);
    setBusy(true);
    try {
      await deletePurchase(url, deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleting(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Purchases</h1>

      <div className="flex flex-wrap items-end gap-3 card p-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink" htmlFor="filter-item">
            Item
          </label>
          <select
            id="filter-item"
            className="input text-sm"
            value={itemId}
            onChange={(e) => setItemId(e.currentTarget.value === "" ? "" : Number(e.currentTarget.value))}
          >
            <option value="">All items</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink" htmlFor="filter-from">
            From
          </label>
          <input
            id="filter-from"
            type="date"
            className="input text-sm"
            value={from}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink" htmlFor="filter-to">
            To
          </label>
          <input
            id="filter-to"
            type="date"
            className="input text-sm"
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
        </div>

        <button
          type="button"
          className="input text-sm"
          onClick={() => void load()}
        >
          Apply
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}

      <div className="overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-ink">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit price</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2 text-right">Batch left</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={8}>
                  <LoadingMark />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={8}>
                  No purchases yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{row.date}</td>
                <td className="px-3 py-2 font-medium">{row.itemName}</td>
                <td className="px-3 py-2 text-right">
                  {formatQuantity(row.qtyBase, row.unit as Unit)}
                </td>
                <td className="px-3 py-2 text-right">{formatRupees(row.unitPricePaise)}</td>
                <td className="px-3 py-2 text-right">{formatRupees(row.totalPaise)}</td>
                <td className="px-3 py-2 text-ink">{row.supplier ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {formatQuantity(row.qtyRemaining, row.unit as Unit)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {can("purchases", "edit") && (
                    <button type="button" className="mr-2 text-sm underline" onClick={() => openEdit(row)}>
                      Edit
                    </button>
                  )}
                  {can("purchases", "delete") && (
                    <button type="button" className="text-sm text-error-ink underline" onClick={() => setDeleting(row)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-purchase-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <form
            className="w-full max-w-md space-y-3 rounded bg-surface p-5 shadow-lg"
            onSubmit={saveEdit}
          >
            <h2 id="edit-purchase-title" className="text-lg font-semibold">
              Edit purchase — {editing.itemName}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="label" htmlFor="edit-qty">
                  Quantity ({editing.unit})
                </label>
                <input
                  id="edit-qty"
                  type="number"
                  step="any"
                  className="input w-full"
                  value={edit.qty}
                  onChange={(e) => setEdit({ ...edit, qty: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="label" htmlFor="edit-price">
                  Unit price (₹ per {editing.unit})
                </label>
                <input
                  id="edit-price"
                  type="number"
                  step="any"
                  className="input w-full"
                  value={edit.price}
                  onChange={(e) => setEdit({ ...edit, price: e.currentTarget.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="label" htmlFor="edit-date">
                  Date
                </label>
                <input
                  id="edit-date"
                  type="date"
                  className="input w-full"
                  value={edit.date}
                  onChange={(e) => setEdit({ ...edit, date: e.currentTarget.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="label" htmlFor="edit-payment">
                  Payment mode
                </label>
                <select
                  id="edit-payment"
                  className="input w-full"
                  value={edit.paymentMode}
                  onChange={(e) => setEdit({ ...edit, paymentMode: e.currentTarget.value })}
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
              <label className="label" htmlFor="edit-supplier">
                Supplier (optional)
              </label>
              <input
                id="edit-supplier"
                className="input w-full"
                value={edit.supplier}
                onChange={(e) => setEdit({ ...edit, supplier: e.currentTarget.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="edit-note">
                Note (optional)
              </label>
              <input
                id="edit-note"
                className="input w-full"
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.currentTarget.value })}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy}
              >
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-purchase-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded bg-surface p-5 shadow-lg">
            <h2 id="delete-purchase-title" className="text-lg font-semibold">
              Delete this purchase?
            </h2>
            <p className="text-sm text-ink">
              {deleting.itemName} · {formatQuantity(deleting.qtyBase, deleting.unit as Unit)} on{" "}
              {deleting.date}. Later stock checks and usage for this item will be recalculated.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDeleting(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-error px-3 py-1 text-sm font-medium text-on-error disabled:opacity-50"
                onClick={confirmDelete}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
