import { useCallback, useEffect, useState, type FormEvent } from "react";
import LoadingMark from "../components/LoadingMark";
import {
  createExpense,
  deleteExpense,
  EXPENSE_CATEGORIES,
  EXPENSE_TYPES,
  getExpenseBill,
  listExpenses,
  listExpenseCategories,
  parseExpenseInput,
  updateExpense,
  type ExpenseRow,
} from "../db/expenses";
import { PAYMENT_MODES } from "../db/purchases";
import { useDb } from "../lib/db-context";
import { can } from "../db/permissions";
import { rupeesToPaise } from "../logic/purchase";
import { formatRupees } from "../logic/units";

type BillFile = { filename: string; mime: string; sizeBytes: number; dataBase64: string };

type FormState = {
  id: number | null;
  expenseType: string;
  category: string;
  amount: string;
  date: string;
  paymentMode: string;
  paidTo: string;
  note: string;
  bill: BillFile | null;
  billName: string;
};

const MAX_BILL_BYTES = 4 * 1024 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonth(): string {
  return todayLocal().slice(0, 7);
}

function emptyForm(): FormState {
  return {
    id: null,
    expenseType: "general",
    category: "",
    amount: "",
    date: todayLocal(),
    paymentMode: "Cash",
    paidTo: "",
    note: "",
    bill: null,
    billName: "",
  };
}

export default function Expenses() {
  const db = useDb();
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, used] = await Promise.all([
        listExpenses(db, { month, category: categoryFilter || undefined }),
        listExpenseCategories(db),
      ]);
      setRows(list);
      setCategories(used);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [db, month, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPaise = rows.reduce((sum, row) => sum + row.amountPaise, 0);

  async function downloadBill(expenseId: number) {
    setError(null);
    try {
      const bill = await getExpenseBill(db, expenseId);
      if (!bill) return;
      const link = document.createElement("a");
      link.href = `data:${bill.mime};base64,${bill.dataBase64}`;
      link.download = bill.filename;
      link.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function attachBill(file: File | undefined) {
    if (!file || !form) return;
    if (file.size > MAX_BILL_BYTES) {
      setError("Bill file must be 4 MB or smaller");
      return;
    }
    try {
      const bill: BillFile = {
        filename: file.name,
        mime: file.type || "application/octet-stream",
        sizeBytes: file.size,
        dataBase64: toBase64(await file.arrayBuffer()),
      };
      setForm({ ...form, bill, billName: file.name });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setBusy(true);
    try {
      const input = parseExpenseInput({
        expenseType: form.expenseType as (typeof EXPENSE_TYPES)[number],
        category: form.category,
        amountPaise: rupeesToPaise(form.amount),
        date: form.date,
        paymentMode: form.paymentMode as (typeof PAYMENT_MODES)[number],
        paidTo: form.paidTo,
        note: form.note,
        bill: form.bill ?? undefined,
      });
      if (form.id === null) {
        await createExpense(db, input);
      } else {
        await updateExpense(db, form.id, input);
      }
      setForm(null);
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
    try {
      await deleteExpense(db, deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleting(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const suggestions = [...new Set([...EXPENSE_CATEGORIES, ...categories])];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="page-title">Expenses</h1>
        {can("expenses", "create") && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setError(null);
              setForm(emptyForm());
            }}
          >
            Add expense
          </button>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3 card p-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink" htmlFor="expense-month">
            Month
          </label>
          <input
            id="expense-month"
            type="month"
            className="input text-sm"
            value={month}
            onChange={(e) => setMonth(e.currentTarget.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-ink" htmlFor="expense-category-filter">
            Category
          </label>
          <select
            id="expense-category-filter"
            className="input text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.currentTarget.value)}
          >
            <option value="">All categories</option>
            {suggestions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && !form && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}

      <div className="overflow-x-auto card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-ink">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Paid to</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2">Note</th>
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
                  No expenses this month.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{row.date}</td>
                <td className="px-3 py-2 font-medium">{row.category}</td>
                <td className="px-3 py-2 text-ink">{row.paidTo ?? "—"}</td>
                <td className="px-3 py-2 text-right">{formatRupees(row.amountPaise)}</td>
                <td className="px-3 py-2 text-ink">{row.paymentMode ?? "—"}</td>
                <td className="px-3 py-2">
                  {row.billId && can("expenses", "export") ? (
                    <button
                      type="button"
                      className="text-sm underline"
                      onClick={() => void downloadBill(row.id)}
                      title={row.billFilename ?? "Bill"}
                    >
                      Save bill
                    </button>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink">{row.note ?? "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {can("expenses", "edit") && (
                    <button
                      type="button"
                      className="mr-2 text-sm underline"
                      onClick={() => {
                        setError(null);
                        setForm({
                          id: row.id,
                          expenseType: row.expenseType ?? "general",
                          category: row.category,
                          amount: String(row.amountPaise / 100),
                          date: row.date,
                          paymentMode: row.paymentMode ?? "Cash",
                          paidTo: row.paidTo ?? "",
                          note: row.note ?? "",
                          bill: null,
                          billName: row.billFilename ?? "",
                        });
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {can("expenses", "delete") && (
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
          <tfoot className="border-t border-line bg-surface-2">
            <tr>
              <td className="px-3 py-2 font-medium" colSpan={3}>
                Month total
              </td>
              <td className="px-3 py-2 text-right font-semibold">{formatRupees(totalPaise)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>

      {form && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-form-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <form className="w-full max-w-md space-y-3 card p-5" onSubmit={save}>
            <h2 id="expense-form-title" className="text-lg font-semibold">
              {form.id === null ? "Add expense" : "Edit expense"}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="label" htmlFor="expense-type">
                  Type
                </label>
                <select
                  id="expense-type"
                  className="input w-full"
                  value={form.expenseType}
                  onChange={(e) => setForm({ ...form, expenseType: e.currentTarget.value })}
                >
                  <option value="general">General (rent, salary…)</option>
                  <option value="purchase">Purchase (transport, loading)</option>
                  <option value="sale">Sale (delivery, packing)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="label" htmlFor="expense-category">
                  Category
                </label>
                <input
                  id="expense-category"
                  list="expense-category-options"
                  className="input w-full"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.currentTarget.value })}
                />
                <datalist id="expense-category-options">
                  {suggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <label className="label" htmlFor="expense-amount">
                  Amount (₹)
                </label>
                <input
                  id="expense-amount"
                  type="number"
                  step="any"
                  className="input w-full"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.currentTarget.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="label" htmlFor="expense-date">
                  Date
                </label>
                <input
                  id="expense-date"
                  type="date"
                  className="input w-full"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.currentTarget.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="label" htmlFor="expense-payment">
                  Payment mode
                </label>
                <select
                  id="expense-payment"
                  className="input w-full"
                  value={form.paymentMode}
                  onChange={(e) => setForm({ ...form, paymentMode: e.currentTarget.value })}
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
              <label className="label" htmlFor="expense-paid-to">
                Paid to (vendor)
              </label>
              <input
                id="expense-paid-to"
                className="input w-full"
                placeholder="Who was paid?"
                value={form.paidTo}
                onChange={(e) => setForm({ ...form, paidTo: e.currentTarget.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="expense-bill">
                Bill photo / invoice (max 4 MB)
              </label>
              <input
                id="expense-bill"
                type="file"
                accept="image/*,application/pdf"
                className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => void attachBill(e.currentTarget.files?.[0])}
              />
              {form.billName && <p className="text-xs text-muted">Attached: {form.billName}</p>}
            </div>

            <div className="space-y-1">
              <label className="label" htmlFor="expense-note">
                Note (optional)
              </label>
              <input
                id="expense-note"
                className="input w-full"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.currentTarget.value })}
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
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={busy}
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
          aria-labelledby="delete-expense-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded bg-surface p-5 shadow-lg">
            <h2 id="delete-expense-title" className="text-lg font-semibold">
              Delete this expense?
            </h2>
            <p className="text-sm text-ink">
              {deleting.category} · {formatRupees(deleting.amountPaise)} on {deleting.date}
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
