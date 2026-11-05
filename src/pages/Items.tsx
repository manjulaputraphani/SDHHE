import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createItem,
  deleteItem,
  listItems,
  parseItemInput,
  updateItem,
  type ItemRow,
} from "../db/items";
import { useDb } from "../lib/db-context";
import { can } from "../db/permissions";
import { baseFactor, formatQuantity, toBase, type Unit } from "../logic/units";

type FormState = {
  id: number | null;
  name: string;
  unit: Unit;
  category: string;
  hsnCode: string;
  minStock: string;
};

const EMPTY_FORM: FormState = { id: null, name: "", unit: "kg", category: "", hsnCode: "", minStock: "0" };

export default function Items() {
  const db = useDb();
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<ItemRow | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listItems(db));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setError(null);
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(row: ItemRow) {
    setError(null);
    setForm({
      id: row.id,
      name: row.name,
      unit: (row.unit as Unit) ?? "kg",
      category: row.category ?? "",
      hsnCode: row.hsnCode ?? "",
      minStock: String(row.minStockBase / baseFactor(row.unit as Unit)),
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaving(true);
    try {
      const input = parseItemInput({
        name: form.name,
        unit: form.unit,
        category: form.category,
        hsnCode: form.hsnCode.trim() || undefined,
        minStockBase: toBase(Number(form.minStock) || 0, form.unit),
      });
      if (form.id === null) {
        await createItem(db, input);
      } else {
        await updateItem(db, form.id, input);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setError(null);
    try {
      await deleteItem(db, deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleting(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="page-title">Items</h1>
        {can("items", "create") && (
          <button
            type="button"
            className="btn-primary"
            onClick={openAdd}
          >
            Add item
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}

      <div className="overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-ink">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">HSN</th>
              <th className="px-3 py-2 text-right">Stock left</th>
              <th className="px-3 py-2 text-right">Min stock</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={7}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={7}>
                  No items yet. Add your first item.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">{row.unit}</td>
                <td className="px-3 py-2 text-ink">{row.category ?? "—"}</td>
                <td className="px-3 py-2">{row.hsnCode ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {formatQuantity(row.stockLeftBase, row.unit as Unit)}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatQuantity(row.minStockBase, row.unit as Unit)}
                </td>
                <td className="px-3 py-2 text-right">
                  {can("items", "edit") && (
                    <button
                      type="button"
                      className="mr-2 text-sm underline"
                      onClick={() => openEdit(row)}
                    >
                      Edit
                    </button>
                  )}
                  {can("items", "delete") && (
                    <button
                      type="button"
                      className="text-sm text-error-ink underline"
                      onClick={() => setDeleting(row)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="item-form-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <form
            className="w-full max-w-sm space-y-4 rounded bg-surface p-5 shadow-lg"
            onSubmit={save}
          >
            <h2 id="item-form-title" className="text-lg font-semibold">
              {form.id === null ? "Add item" : "Edit item"}
            </h2>

            <div className="space-y-1">
              <label className="label" htmlFor="item-name">
                Name
              </label>
              <input
                id="item-name"
                className="input w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="item-unit">
                Unit
              </label>
              <select
                id="item-unit"
                className="input w-full"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.currentTarget.value as Unit })}
              >
                <option value="kg">kg</option>
                <option value="60 kg bag">60 kg bag</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="item-category">
                Category
              </label>
              <input
                id="item-category"
                className="input w-full"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.currentTarget.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="item-hsn">
                HSN code
              </label>
              <input
                id="item-hsn"
                className="input w-full"
                value={form.hsnCode}
                onChange={(e) => setForm({ ...form, hsnCode: e.currentTarget.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="item-min">
                Min stock ({form.unit})
              </label>
              <input
                id="item-min"
                type="number"
                min="0"
                step="any"
                className="input w-full"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.currentTarget.value })}
              />
            </div>

            {error && (
              <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setForm(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving}
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-item-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded bg-surface p-5 shadow-lg">
            <h2 id="delete-item-title" className="text-lg font-semibold">
              Delete {deleting.name}?
            </h2>
            <p className="text-sm text-ink">
              This cannot be undone. Items that already have purchases cannot be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-error px-3 py-1 text-sm font-medium text-on-error"
                onClick={confirmDelete}
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
