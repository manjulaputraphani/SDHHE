import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDb } from "../lib/db-context";
import { listBatches, listBatchTakes } from "../db/analytics";
import { baseFactor, type Unit } from "../logic/units";
import { buildBatchRows, rupees, type BatchRow } from "../logic/analytics";
import { Trend } from "../components/Trend";

export default function Analysis() {
  const db = useDb();
  const [item, setItem] = useState<number | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rows, setRows] = useState<{ itemId: number; itemName: string; unit: string; batchRows: BatchRow[] }[]>([]);

  useEffect(() => {
    Promise.all([listBatches(db, item === "all" ? undefined : item), listBatchTakes(db, item === "all" ? undefined : item, from || undefined, to || undefined)])
      .then(([batches, takes]) => {
        const byItem = new Map<number, { itemName: string; unit: string; batches: typeof batches; takes: typeof takes }>();
        for (const batch of batches) {
          const entry = byItem.get(batch.itemId) ?? { itemName: batch.itemName, unit: batch.unit, batches: [], takes: [] };
          entry.batches.push(batch);
          byItem.set(batch.itemId, entry);
        }
        const batchIds = new Set(batches.map((b) => b.batchId));
        for (const take of takes) {
          const entry = [...byItem.values()].find((e) => e.batches.some((b) => b.batchId === take.batchId));
          if (entry && batchIds.has(take.batchId)) entry.takes.push(take);
        }
        setRows(
          [...byItem.entries()].map(([itemId, entry]) => ({
            itemId,
            itemName: entry.itemName,
            unit: entry.unit,
            batchRows: buildBatchRows(
              entry.batches.map((b) => ({
                id: b.batchId,
                purchaseDate: b.purchaseDate,
                buyUnitPaise: b.buyUnitPaise,
                qtyOriginalBase: b.qtyOriginalBase,
                qtyRemainingBase: b.qtyRemainingBase,
              })),
              entry.takes,
              baseFactor(entry.unit as Unit),
            ),
          })),
        );
      })
      .catch(() => setRows([]));
  }, [db, item, from, to]);

  const items = useMemo(() => {
    const seen = new Map<number, string>();
    // rows are per item already loaded; use a separate all-batches fetch on first render
    return seen;
  }, [rows]);

  const [itemOptions, setItemOptions] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    listBatches(db).then((all) => {
      const map = new Map<number, string>();
      for (const b of all) map.set(b.itemId, b.itemName);
      setItemOptions([...map.entries()].map(([id, name]) => ({ id, name })));
    });
  }, [db]);

  void items;

  return (
    <div className="space-y-4">
      <h1 className="page-title">Detailed analysis</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="label" htmlFor="analysis-item">Item</label>
          <select id="analysis-item" className="input" value={String(item)} onChange={(e) => setItem(e.currentTarget.value === "all" ? "all" : Number(e.currentTarget.value))}>
            <option value="all">All items</option>
            {itemOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="label" htmlFor="analysis-from">From</label>
          <input id="analysis-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        </div>
        <div className="space-y-1">
          <label className="label" htmlFor="analysis-to">To</label>
          <input id="analysis-to" type="date" className="input" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        </div>
      </div>

      {rows.map(({ itemId, itemName, unit, batchRows }) => {
        const factor = 1000;
        const totals = {
          bought: batchRows.reduce((s, r) => s + r.qtyOriginalBase, 0),
          sold: batchRows.reduce((s, r) => s + r.qtySoldBase, 0),
          profit: batchRows.reduce((s, r) => s + r.profitPaise, 0),
          remaining: batchRows.reduce((s, r) => s + r.qtyRemainingBase, 0),
          value: batchRows.reduce((s, r) => s + r.remainingValuePaise, 0),
        };
        const trend = batchRows.map((r) => ({ day: r.purchaseDate.slice(5), price: r.buyUnitPaise / 100 }));
        return (
          <section key={itemId} className="card p-4 space-y-3" data-testid={`analysis-${itemId}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{itemName}</h2>
              <p className="text-xs text-muted">
                bought {totals.bought / factor} {unit} · sold {totals.sold / factor} {unit} · remaining {totals.remaining / factor} {unit} ({rupees(totals.value)}) · profit <span className="text-success-ink">{rupees(totals.profit)}</span>
              </p>
            </div>
            {batchRows.length > 1 && (
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Line type="monotone" dataKey="price" name="Buy price ₹" stroke="#C8963E" dot />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid={`analysis-table-${itemId}`}>
                <thead>
                  <tr>
                    <th className="px-2 py-1">Batch date</th>
                    <th className="px-2 py-1 text-right">Qty bought</th>
                    <th className="px-2 py-1 text-right">Buy ₹</th>
                    <th className="px-2 py-1">▲▼ vs prev</th>
                    <th className="px-2 py-1 text-right">Qty sold</th>
                    <th className="px-2 py-1 text-right">Avg sell ₹</th>
                    <th className="px-2 py-1">▲▼ sell vs buy</th>
                    <th className="px-2 py-1 text-right">Profit</th>
                    <th className="px-2 py-1 text-right">Remaining</th>
                    <th className="px-2 py-1 text-right">Value</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row) => (
                    <>
                      <tr key={row.batchId} className="cursor-pointer border-t border-line" onClick={() => setExpanded(expanded === row.batchId ? null : row.batchId)}>
                        <td className="px-2 py-1">{row.purchaseDate}</td>
                        <td className="px-2 py-1 text-right">{row.qtyOriginalBase / 1000} {unit}</td>
                        <td className="px-2 py-1 text-right">{(row.buyUnitPaise / 100).toFixed(2)}</td>
                        <td className="px-2 py-1"><Trend ind={row.priceChange} /></td>
                        <td className="px-2 py-1 text-right">{row.qtySoldBase / 1000} {unit}</td>
                        <td className="px-2 py-1 text-right">{(row.avgSellUnitPaise / 100).toFixed(2)}</td>
                        <td className="px-2 py-1"><Trend ind={row.sellVsBuy} /></td>
                        <td className="px-2 py-1 text-right text-success-ink">{rupees(row.profitPaise)}</td>
                        <td className="px-2 py-1 text-right">{row.qtyRemainingBase / 1000} {unit}</td>
                        <td className="px-2 py-1 text-right">{rupees(row.remainingValuePaise)}</td>
                        <td className="px-2 py-1">
                          <span className={row.status === "open" ? "badge badge-ok" : "badge"}>{row.status === "open" ? "Open" : "Sold out"}</span>
                        </td>
                      </tr>
                      {expanded === row.batchId && (
                        <tr key={`${row.batchId}-sales`} className="border-t border-line bg-surface-alt">
                          <td className="px-2 py-1" colSpan={11}>
                            {row.takes.length === 0 ? (
                              <p className="text-xs text-muted">No sales from this batch in the selected range.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr><th className="px-2 py-1 text-left">Sale date</th><th className="px-2 py-1 text-right">Qty</th><th className="px-2 py-1 text-right">Sell ₹/unit</th><th className="px-2 py-1 text-right">Profit</th></tr>
                                </thead>
                                <tbody>
                                  {row.takes.map((take, i) => (
                                    <tr key={i}>
                                      <td className="px-2 py-1">{take.saleDate}</td>
                                      <td className="px-2 py-1 text-right">{take.qtyTakenBase / 1000} {unit}</td>
                                      <td className="px-2 py-1 text-right">{(take.sellUnitPaise / 100).toFixed(2)}</td>
                                      <td className="px-2 py-1 text-right text-success-ink">
                                        {rupees(Math.round(((take.sellUnitPaise - row.buyUnitPaise) * take.qtyTakenBase) / 1000))}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-medium">
                    <td className="px-2 py-1">Item totals</td>
                    <td className="px-2 py-1 text-right">{totals.bought / 1000} {unit}</td>
                    <td colSpan={3} />
                    <td className="px-2 py-1 text-right text-success-ink">{rupees(totals.profit)}</td>
                    <td colSpan={2} />
                    <td className="px-2 py-1 text-right">{totals.remaining / 1000} {unit}</td>
                    <td className="px-2 py-1 text-right">{rupees(totals.value)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-muted">No batches match the filter.</p>}
    </div>
  );
}