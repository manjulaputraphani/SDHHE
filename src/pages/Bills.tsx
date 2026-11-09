import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import LoadingMark from "../components/LoadingMark";
import {
  cancelSaleBill,
  getSaleBill,
  listSaleBills,
  recordBillPayment,
  type SaleBillDetail,
  type SaleBillRow,
} from "../db/billing";
import { getEmailSettings, getShopDetails, type ShopDetails } from "../db/settings";
import { logActivity } from "../db/activity";
import { getSecret, SECRET_KEYS } from "../lib/secrets";
import { billEmailSubject, sendEmail } from "../lib/email";
import { billWhatsAppText, buildWhatsAppLink } from "../lib/whatsapp";
import { deleteBillPdf, purgeBillBin, saveBillPdf } from "../lib/billPdf";
import { useDb, useDbUrl } from "../lib/db-context";
import { printBill, buildBillHtml } from "../lib/printBill";
import { formatRupees } from "../logic/units";

export default function Bills() {
  const db = useDb();
  const url = useDbUrl();

  const [rows, setRows] = useState<SaleBillRow[]>([]);
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "issued" | "cancelled">("all");
  const [detail, setDetail] = useState<SaleBillDetail | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleBillRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<string | null>(null);
  const [waPdf, setWaPdf] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [bills, shopRow] = await Promise.all([listSaleBills(db, 100), getShopDetails(db)]);
    setRows(bills);
    setShop(shopRow);
  }, [db]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [load]);

  // Bill PDFs left in the bin from yesterday are no longer needed.
  useEffect(() => {
    void purgeBillBin();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === "cancelled" && !row.cancelled) return false;
      if (status === "issued" && row.cancelled) return false;
      if (!needle) return true;
      return (
        row.billNo.toLowerCase().includes(needle) ||
        (row.customerName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, search, status]);

  async function view(row: SaleBillRow) {
    setError(null);
    setSuccess(null);
    try {
      setDetail(await getSaleBill(db, row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Record a payment against a bill that still has credit. */
  async function collectPayment(row: SaleBillRow) {
    setError(null);
    setSuccess(null);
    const due = row.totalPaise - row.paidPaise;
    const input = window.prompt(
      `Amount received for ${row.billNo} (credit due ${formatRupees(due)})`,
      (due / 100).toFixed(2),
    );
    if (input === null) return;
    const amountPaise = Math.round(Number(input) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      setError("Enter a valid amount");
      return;
    }
    try {
      const result = await recordBillPayment(db, row.id, amountPaise);
      setSuccess(
        result.creditPaise > 0
          ? `Payment recorded — ${formatRupees(result.creditPaise)} credit still due`
          : "Payment recorded — bill fully paid",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function emailBill() {
    if (!detail || !shop) return;
    setError(null);
    setEmailStatus(null);
    if (!detail.customerEmail) {
      setError("Add the customer's email in GST Billing first (it is saved with the customer)");
      return;
    }
    setEmailBusy(true);
    try {
      const cfg = await getEmailSettings(db);
      const password = await getSecret(SECRET_KEYS.SMTP_PASSWORD);
      if (!cfg.fromEmail.trim() || !password) {
        setError("Set up email in Settings → Email (sender address + Gmail app password)");
        return;
      }
      let attachmentPath: string | undefined;
      try {
        attachmentPath = await saveBillPdf(detail, shop);
      } catch {
        // PDF failed — still email the HTML invoice instead of blocking the bill.
      }
      await sendEmail({
        host: cfg.host,
        port: Number(cfg.port) || 465,
        username: cfg.fromEmail,
        password,
        fromEmail: cfg.fromEmail,
        fromName: cfg.fromName,
        to: detail.customerEmail,
        subject: billEmailSubject(detail.billNo, shop.name),
        html: buildBillHtml(detail, shop),
        attachmentPath,
      });
      await logActivity(db, {
        event: "bill.email",
        summary: `Bill ${detail.billNo} emailed to ${detail.customerEmail}`,
        entity: "sale",
        entityId: detail.id,
      });
      setEmailStatus(`Emailed PDF to ${detail.customerEmail}`);
      if (attachmentPath) await deleteBillPdf(attachmentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailBusy(false);
    }
  }

  /** Open WhatsApp with the customer's chat and the bill summary pre-filled. */
  async function whatsappBill() {
    if (!detail || !shop) return;
    setError(null);
    setWaStatus(null);
    setWaPdf(null);
    const link = buildWhatsAppLink(detail.customerPhone, billWhatsAppText(detail, shop.name));
    if (!link) {
      setError("Add the customer's phone in GST Billing first (it is saved with the customer)");
      return;
    }
    try {
      let pdfPath: string | null = null;
      try {
        pdfPath = await saveBillPdf(detail, shop);
      } catch {
        // No PDF — the text summary still shares fine.
      }
      await openUrl(link);
      if (pdfPath) await revealItemInDir(pdfPath);
      await logActivity(db, {
        event: "bill.whatsapp",
        summary: `Bill ${detail.billNo} shared on WhatsApp to ${detail.customerPhone}`,
        entity: "sale",
        entityId: detail.id,
      });
      setWaPdf(pdfPath);
      setWaStatus(
        pdfPath
          ? "WhatsApp opened — attach the PDF shown in Finder, then press Send"
          : "WhatsApp opened — press Send",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Drop the WhatsApp PDF once it has been sent. */
  async function cleanupWaPdf() {
    if (!waPdf) return;
    try {
      await deleteBillPdf(waPdf);
      setWaPdf(null);
      setWaStatus("PDF deleted from the bin");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await cancelSaleBill(url, cancelTarget.id);
      setSuccess(`${cancelTarget.billNo} cancelled — stock restored`);
      setCancelTarget(null);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Bills</h1>

      <div className="flex max-w-3xl flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1 space-y-1">
          <label className="label" htmlFor="bills-search">
            Search bill no / customer
          </label>
          <input
            id="bills-search"
            className="input w-full"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="label" htmlFor="bills-status">
            Status
          </label>
          <select
            id="bills-status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value as typeof status)}
          >
            <option value="all">All bills</option>
            <option value="issued">Issued</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
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

      <div className="overflow-x-auto card" data-testid="bills-table">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2">Bill no</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Status</th>
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
            {!loading && filtered.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-muted" colSpan={8}>
                  No bills yet — create one in GST Billing.
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-2 font-medium">{row.billNo}</td>
                <td className="px-3 py-2">{row.saleDate}</td>
                <td className="px-3 py-2">{row.customerName ?? "Walk-in"}</td>
                <td className="px-3 py-2 text-right">{formatRupees(row.totalPaise)}</td>
                <td className="px-3 py-2 text-right">{formatRupees(row.paidPaise)}</td>
                <td className="px-3 py-2">{row.paymentMode}</td>
                <td className="px-3 py-2">
                  {row.cancelled ? (
                    <span className="badge badge-bad">Cancelled</span>
                  ) : row.paidPaise < row.totalPaise ? (
                    <span className="badge badge-warn" title="Credit still due">
                      Credit {formatRupees(row.totalPaise - row.paidPaise)}
                    </span>
                  ) : (
                    <span className="badge badge-ok">Paid</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    className="mr-3 text-sm underline"
                    onClick={() => void view(row)}
                  >
                    View
                  </button>
                  {!row.cancelled && row.paidPaise < row.totalPaise && (
                    <button
                      type="button"
                      className="mr-3 text-sm underline"
                      onClick={() => void collectPayment(row)}
                    >
                      Record payment
                    </button>
                  )}
                  {!row.cancelled && (
                    <button
                      type="button"
                      className="text-sm text-error-ink underline"
                      onClick={() => setCancelTarget(row)}
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <section data-testid="bills-detail" className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Bill preview</h2>
            <div className="flex items-center gap-2">
              {detail.cancelled ? (
                <span className="badge badge-bad">Cancelled</span>
              ) : (
                <span className="badge badge-ok">Issued</span>
              )}
              <button
                type="button"
                className="text-sm text-ink underline"
                onClick={() => setDetail(null)}
              >
                Close
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            <iframe
              title={`Bill ${detail.billNo}`}
              data-testid="bill-preview-iframe"
              className="h-[1080px] w-full"
              srcDoc={shop ? buildBillHtml(detail, shop) : ""}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost"
              data-testid="bills-email"
              onClick={() => void emailBill()}
              disabled={emailBusy}
            >
              {emailBusy ? "Sending…" : "Email bill"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              data-testid="bills-whatsapp"
              onClick={() => void whatsappBill()}
            >
              WhatsApp bill
            </button>
            <button
              type="button"
              className="btn-primary"
              data-testid="bills-print"
              onClick={() => shop && printBill(detail, shop)}
            >
              Print / Save PDF
            </button>
            {!detail.cancelled && (
              <button
                type="button"
                className="btn-ghost text-error-ink hover:bg-error-soft"
                data-testid="bills-cancel"
                onClick={() => {
                  const row = rows.find((r) => r.id === detail.id) ?? null;
                  if (row) setCancelTarget(row);
                }}
              >
                Cancel bill
              </button>
            )}
            {(emailStatus || waStatus) && (
              <span className="self-center text-sm text-success-ink">
                {emailStatus ?? waStatus}
                {waPdf && !emailStatus && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    data-testid="bills-delete-pdf"
                    onClick={() => void cleanupWaPdf()}
                  >
                    Delete PDF
                  </button>
                )}
              </span>
            )}
          </div>
        </section>
      )}

      {cancelTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-bill-title"
          data-testid="bills-cancel-modal"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <div className="w-full max-w-sm space-y-4 card p-5">
            <h2 id="cancel-bill-title" className="text-lg font-semibold">
              Cancel {cancelTarget.billNo}?
            </h2>
            <p className="text-sm text-ink">
              The bill stays visible as cancelled, and the sold quantity is put back into its
              original stock batches.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setCancelTarget(null)}
                disabled={busy}
              >
                Keep bill
              </button>
              <button
                type="button"
                className="rounded-xl bg-error px-4 py-2 text-sm font-medium text-on-error disabled:opacity-50"
                data-testid="bills-confirm-cancel"
                onClick={() => void confirmCancel()}
                disabled={busy}
              >
                Yes, cancel bill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
