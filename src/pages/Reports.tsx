import { useCallback, useEffect, useState } from "react";
import { useDb } from "../lib/db-context";
import { dealProfits, finYearOptions, finYearReport, type DealProfit, type FinYearReport } from "../db/reports";
import { formatQuantity, formatRupees, type Unit } from "../logic/units";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

export default function Reports() {
  const db = useDb();
  const [finYears, setFinYears] = useState<string[]>([]);
  const [finYear, setFinYear] = useState("");
  const [report, setReport] = useState<FinYearReport | null>(null);
  const [deals, setDeals] = useState<DealProfit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const years = await finYearOptions(db);
        if (cancelled) return;
        setFinYears(years);
        setFinYear((current) => (current && years.includes(current) ? current : years[0] ?? ""));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const load = useCallback(async () => {
    if (!finYear) return;
    setLoading(true);
    setError(null);
    try {
      const [reportData, dealData] = await Promise.all([
        finYearReport(db, finYear),
        dealProfits(db, finYear),
      ]);
      setReport(reportData);
      setDeals(dealData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [db, finYear]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Profit &amp; turnover</h1>
          <p className="text-sm text-muted">
            {report ? `Financial year ${report.finYear} · ${report.startDate} to ${report.endDate}` : "Pick a financial year."}
          </p>
        </div>
        <select className="input w-44" value={finYear} onChange={(e) => setFinYear(e.currentTarget.value)}>
          {finYears.map((year) => (
            <option key={year} value={year}>
              FY {year}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{error}</p>}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Turnover" value={formatRupees(report.turnoverPaise)} hint={`${report.salesCount} deals`} />
            <Stat
              label="Total purchases"
              value={formatRupees(report.totalPurchasesPaise)}
              hint={`stock ${formatRupees(report.purchaseValuePaise)} + ${formatRupees(report.purchaseExpensesPaise)}`}
            />
            <Stat label="Gross profit" value={formatRupees(report.grossProfitPaise)} hint={`after COGS ${formatRupees(report.cogsPaise)}`} />
            <Stat
              label="Net profit"
              value={formatRupees(report.netProfitPaise)}
              hint={`sales ${formatRupees(report.saleExpensesPaise)} · general ${formatRupees(report.generalExpensesPaise)}`}
            />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2">Deal</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-right">Sale value</th>
                  <th className="px-3 py-2 text-right">COGS</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Sale exp.</th>
                  <th className="px-3 py-2 text-right">Net profit</th>
                  <th className="px-3 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {deals.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-muted" colSpan={9}>
                      No deals in this financial year.
                    </td>
                  </tr>
                )}
                {deals.map((deal) => (
                  <tr key={deal.saleId}>
                    <td className="px-3 py-2 font-medium">{deal.billNo}</td>
                    <td className="px-3 py-2">{deal.date}</td>
                    <td className="px-3 py-2">{deal.customerName ?? "Walk-in"}</td>
                    <td className="px-3 py-2 text-right">{formatRupees(deal.saleValuePaise)}</td>
                    <td className="px-3 py-2 text-right">{formatRupees(deal.cogsPaise)}</td>
                    <td className="px-3 py-2 text-right">{formatRupees(deal.grossProfitPaise)}</td>
                    <td className="px-3 py-2 text-right">{formatRupees(deal.saleExpensesPaise)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatRupees(deal.netProfitPaise)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`badge ${deal.profitPercent >= 0 ? "badge-ok" : "badge-bad"}`}>
                        {deal.profitPercent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card overflow-x-auto">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-medium">Closing stock</h2>
              <span className="text-sm text-muted">{formatRupees(report.closingStockValuePaise)}</span>
            </div>
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Quantity</th>
                  <th className="px-3 py-2 text-right">Avg cost</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {report.closingStock
                  .filter((row) => row.qtyBase > 0)
                  .map((row) => (
                    <tr key={row.itemId}>
                      <td className="px-3 py-2 font-medium">{row.name}</td>
                      <td className="px-3 py-2 text-right">{formatQuantity(row.qtyBase, row.unit as Unit)}</td>
                      <td className="px-3 py-2 text-right">{formatRupees(row.avgCostPaise)}</td>
                      <td className="px-3 py-2 text-right">{formatRupees(row.valuePaise)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {loading && !report && <p className="text-sm text-muted">Loading…</p>}
    </div>
  );
}
