/**
 * Supplier dues / payable page.
 *
 * Lists all suppliers with their outstanding dues, lets you add suppliers,
 * and record payments against purchases (reducing the outstanding balance).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import LoadingMark from "../components/LoadingMark";
import {
  createSupplier,
  getSupplierDues,
  getTotalSupplierDues,
  listSupplierPayments,
  recordSupplierPayment,
  type SupplierWithDues,
} from "../db/suppliers";
import { listPurchases, type PurchaseListRow, PAYMENT_MODES } from "../db/purchases";
import { useDb } from "../lib/db-context";
import { formatRupees } from "../logic/units";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type AddSupplierForm = { name: string; phone: string };

type PaymentForm = {
  purchaseId: number | null;
  amount: string;
  paymentDate: string;
  paymentMode: string;
  note: string;
};

function emptyPaymentForm(): PaymentForm {
  return { purchaseId: null, amount: "", paymentDate: todayLocal(), paymentMode: "Cash", note: "" };
}

export default function Suppliers() {
  const db = useDb();
  const [dues, setDues] = useState<SupplierWithDues[]>([]);
  const [outstandingPurchases, setOutstandingPurchases] = useState<PurchaseListRow[]>([]);
  const [recentPayments, setRecentPayments] = useState<Awaited<ReturnType<typeof listSupplierPayments>>>([]);
  const [totalDues, setTotalDues] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<AddSupplierForm>({ name: "", phone: "" });
  const [payForm, setPayForm] = useState<PaymentForm>(emptyPaymentForm());
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [duesRows, total] = await Promise.all([getSupplierDues(db), getTotalSupplierDues(db)]);
      setDues(duesRows);
      setTotalDues(total);

      // Purchases with outstanding balance (total > paid) — eligible for payment.
      const allPurchases = await listPurchases(db);
      const outstanding = allPurchases.filter((p) => p.totalPaise > p.paidPaise);
      setOutstandingPurchases(outstanding);

      const payments = await listSupplierPayments(db);
      setRecentPayments(payments.slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddSupplier(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!addForm.name.trim()) {
      setError("Supplier name is required");
      return;
    }
    try {
      await createSupplier(db, { name: addForm.name.trim(), phone: addForm.phone.trim() || null });
      setAddForm({ name: "", phone: "" });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!payForm.purchaseId) {
      setError("Select a purchase");
      return;
    }
    const amount = parseInt(payForm.amount.replace(/,/g, ""), 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setPaying(true);
    try {
      await recordSupplierPayment(db, {
        purchaseId: payForm.purchaseId,
        amountPaise: amount,
        paymentDate: payForm.paymentDate,
        paymentMode: payForm.paymentMode,
        note: payForm.note.trim() || null,
      });
      setPayForm(emptyPaymentForm());
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  }

  if (loading) return <LoadingMark />;

  if (error) {
    return (
      <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3 sm:flex sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title">Supplier Dues</h1>
          <p className="text-sm text-muted">
            What you owe suppliers · total outstanding{" "}
            <span className={totalDues > 0 ? "font-medium text-error-ink" : "text-muted"}>
              {formatRupees(totalDues)}
            </span>
          </p>
        </div>
        <NavLink to="/purchases/new" className="btn-primary">
          Add Purchase
        </NavLink>
      </header>

      {/* Add supplier */}
      <section className="space-y-3 card p-4 sm:p-5">
        <div className="flex items-center justify-between space-y-2 sm:space-y-0 sm:flex-row">
          <div>
            <h2 className="text-sm font-medium">Add supplier</h2>
          </div>
        </div>
        <form onSubmit={handleAddSupplier} className="grid gap-3 sm:grid-cols-3 items-end">
          <div className="space-y-1 sm:col-span-2">
            <label className="label text-xs" htmlFor="supplier-name">Name</label>
            <input
              id="supplier-name"
              type="text"
              className="input"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.currentTarget.value })}
              placeholder="e.g. Sri Traders"
            />
          </div>
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="supplier-phone">Phone</label>
            <input
              id="supplier-phone"
              type="tel"
              className="input"
              value={addForm.phone}
              onChange={(e) => setAddForm({ ...addForm, phone: e.currentTarget.value })}
              placeholder="99999 99999"
            />
          </div>
          <button type="submit" className="btn-primary w-full sm:w-auto">
            Add
          </button>
        </form>
      </section>

      {/* Supplier dues table */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Supplier dues</h2>
        <div className="overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="pb-2 font-medium">Supplier</th>
                <th className="pb-2 font-medium text-right">Purchased</th>
                <th className="pb-2 font-medium text-right">Paid</th>
                <th className="pb-2 font-medium text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {dues.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-muted text-center">
                    No suppliers yet. Add your first supplier above.
                  </td>
                </tr>
              ) : (
                dues.map((d) => (
                  <tr key={d.id} className="border-b border-line/50">
                    <td className="px-3 py-2.5 font-medium">{d.name}</td>
                    <td className="px-3 py-2.5 text-right">{formatRupees(d.totalPurchasedPaise)}</td>
                    <td className="px-3 py-2.5 text-right">{formatRupees(d.totalPaidPaise)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {d.outstandingPaise > 0 ? (
                        <span className={`badge badge-bad`}>{formatRupees(d.outstandingPaise)}</span>
                      ) : (
                        <span className="badge badge-ok">Paid</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Record payment */}
      <section className="space-y-3 card p-4 sm:p-5">
        <div className="flex items-center justify-between space-y-2 sm:space-y-0 sm:flex-row">
          <div>
            <h2 className="text-sm font-medium">Record payment to supplier</h2>
            <p className="text-sm text-muted">
              Select a purchase with an outstanding balance and enter the amount paid.
            </p>
          </div>
        </div>
        <form onSubmit={handleRecordPayment} className="grid gap-3 sm:grid-cols-2 items-end">
          <div className="space-y-1 sm:col-span-2">
            <label className="label text-xs" htmlFor="payment-purchase">Purchase</label>
            <select
              id="payment-purchase"
              className="input"
              value={payForm.purchaseId ?? ""}
              onChange={(e) =>
                setPayForm({ ...payForm, purchaseId: Number(e.currentTarget.value) || null })
              }
            >
              <option value="">— select purchase —</option>
              {outstandingPurchases.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.itemName} · {p.date} · outstanding {formatRupees(p.totalPaise - p.paidPaise)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="payment-amount">Amount (₹)</label>
            <input
              id="payment-amount"
              type="text"
              inputMode="decimal"
              className="input"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.currentTarget.value })}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="payment-date">Date</label>
            <input
              id="payment-date"
              type="date"
              className="input"
              value={payForm.paymentDate}
              onChange={(e) => setPayForm({ ...payForm, paymentDate: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="payment-mode">Mode</label>
            <select
              id="payment-mode"
              className="input"
              value={payForm.paymentMode}
              onChange={(e) => setPayForm({ ...payForm, paymentMode: e.currentTarget.value })}
            >
              {PAYMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="label text-xs" htmlFor="payment-note">Note</label>
            <input
              id="payment-note"
              type="text"
              className="input"
              value={payForm.note}
              onChange={(e) => setPayForm({ ...payForm, note: e.currentTarget.value })}
              placeholder="e.g. UPI payment"
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full sm:w-auto"
            disabled={paying || !payForm.purchaseId}
          >
            {paying ? "Recording…" : "Record Payment"}
          </button>
        </form>
      </section>

      {/* Recent payments */}
      {recentPayments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Recent payments</h2>
          <div className="overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Purchase</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium">Mode</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p) => (
                  <tr key={p.id} className="border-b border-line/50">
                    <td className="px-3 py-2.5">{p.paymentDate}</td>
                    <td className="px-3 py-2.5 text-sm">
                      {p.itemName} · {p.purchaseDate}
                    </td>
                    <td className="px-3 py-2.5 text-right">{formatRupees(p.amountPaise)}</td>
                    <td className="px-3 py-2.5 text-muted">{p.paymentMode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
