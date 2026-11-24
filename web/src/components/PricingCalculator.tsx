/**
 * Green Coffee Pricing Calculator (web).
 *
 * The formulas live in src/logic/pricing.ts — this component is only the
 * form, the live results and the saved-quote history. It deliberately does
 * not round in the component: every number comes from calculatePricing().
 */
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type PricingCalculation,
  type User,
} from "../api";
import { formatDate, formatDateTime } from "../format";
import { showToast } from "./notifications/toastStore";
import { DeleteRowButton, RowActions } from "./RowActions";
import { IconCalculator, IconRefresh } from "./icons";
import {
  DEFAULT_PRICING_INPUTS,
  calculatePricing,
  formatPricingMoney,
  validatePricingInputs,
  type PricingInputs,
} from "../../../src/logic/pricing";

const GRADE_OPTIONS = [
  "Robusta Cherry",
  "Robusta Parchment",
  "Arabica Plantation",
  "Arabica Cherry",
  "Arabica Robusta Blend",
];

type FormState = Record<keyof PricingInputs, string>;
type Tab = "calculator" | "history";

function toForm(inputs: PricingInputs): FormState {
  const form = {} as FormState;
  for (const key of Object.keys(DEFAULT_PRICING_INPUTS) as Array<keyof PricingInputs>) {
    form[key] = String(inputs[key]);
  }
  return form;
}

function parseForm(form: FormState): PricingInputs {
  const inputs = {} as PricingInputs;
  for (const key of Object.keys(DEFAULT_PRICING_INPUTS) as Array<keyof PricingInputs>) {
    const raw = form[key].trim();
    inputs[key] = raw === "" ? Number.NaN : Number(raw);
  }
  return inputs;
}

function NumberField({
  label,
  suffix,
  value,
  error,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="label flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {suffix && <span className="text-[10px] font-normal normal-case tracking-normal text-muted">{suffix}</span>}
      </label>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${label}-error` : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error && (
        <p id={`${label}-error`} role="alert" className="text-xs text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** "₹27.64" for the bar legend, "₹28" for the saved-history money. */
const whole = (value: number) => formatPricingMoney(value);

export default function PricingCalculator({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("calculator");
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULT_PRICING_INPUTS));
  const [grade, setGrade] = useState("Robusta Cherry");
  const [note, setNote] = useState("");
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [latestBusy, setLatestBusy] = useState(false);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);

  const [history, setHistory] = useState<PricingCalculation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [filterGrade, setFilterGrade] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const inputs = useMemo(() => parseForm(form), [form]);
  const errors = useMemo(() => validatePricingInputs(inputs), [inputs]);
  const errorCount = Object.keys(errors).length;
  const result = useMemo(() => {
    if (errorCount > 0) return null;
    try {
      return calculatePricing(inputs);
    } catch {
      return null;
    }
  }, [inputs, errorCount]);

  const isAdmin = user.role === "owner";

  // History: debounce the filters so typing a grade does not fire on every key.
  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setHistoryLoading(true);
      setHistoryError(null);
      api
        .pricingCalculations({
          grade: filterGrade.trim() || undefined,
          from: filterFrom || undefined,
          to: filterTo || undefined,
        })
        .then((res) => {
          if (!cancelled) setHistory(res.calculations);
        })
        .catch((err: unknown) => {
          if (!cancelled) setHistoryError(err instanceof Error ? err.message : "Could not load history");
        })
        .finally(() => {
          if (!cancelled) setHistoryLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, historyVersion, filterGrade, filterFrom, filterTo]);

  const gradeChoices = useMemo(() => {
    const saved = history.map((row) => row.grade);
    return [...new Set([...GRADE_OPTIONS, ...saved])].filter(Boolean);
  }, [history]);

  const setField = (key: keyof PricingInputs, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const fieldError = (key: keyof PricingInputs) => errors[key];

  async function useLatestPrice() {
    const chosen = grade.trim();
    if (!chosen) {
      setGradeError("Choose a coffee grade first");
      return;
    }
    setGradeError(null);
    setLatestBusy(true);
    setLatestMessage(null);
    try {
      const { latest } = await api.latestPricingPrice(chosen);
      if (!latest) {
        setLatestMessage(`No stock batch found for “${chosen}”.`);
        showToast(`No stock batch found for ${chosen}`, "warning");
        return;
      }
      setField("purchasePrice", String(latest.pricePerKg));
      setLatestMessage(
        `Using ${latest.itemName} @ ${formatPricingMoney(latest.pricePerKg, latest.pricePerKg % 1 === 0 ? 0 : 2)}/kg from ${formatDate(latest.purchaseDate)}.`,
      );
      showToast("Purchase price filled from the latest stock batch", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read the stock price";
      setLatestMessage(message);
      showToast(message, "error");
    } finally {
      setLatestBusy(false);
    }
  }

  async function saveCalculation() {
    if (!result) return;
    if (!grade.trim()) {
      setGradeError("Choose a coffee grade");
      return;
    }
    setGradeError(null);
    setSaving(true);
    try {
      const saved = await api.savePricingCalculation({
        grade: grade.trim(),
        note: note.trim() || undefined,
        inputs,
      });
      showToast(`Saved ${saved.calculation.grade} — ${formatPricingMoney(saved.calculation.results.regularPrice)}/kg regular`, "success");
      setHistoryVersion((version) => version + 1);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save the calculation", "error");
    } finally {
      setSaving(false);
    }
  }

  function openCalculation(row: PricingCalculation) {
    setForm(toForm(row.inputs));
    setGrade(row.grade);
    setNote(row.note ?? "");
    setGradeError(null);
    setLatestMessage(null);
    setTab("calculator");
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Loaded ${row.grade}`, "success");
  }

  async function removeCalculation(row: PricingCalculation) {
    if (!isAdmin) return;
    if (!window.confirm(`Delete the saved ${row.grade} quote from ${formatDateTime(row.createdAt)}?`)) return;
    try {
      await api.deletePricingCalculation(row.id);
      setHistory((rows) => rows.filter((entry) => entry.id !== row.id));
      showToast("Saved calculation deleted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete the calculation", "error");
    }
  }

  const resetFilters = () => {
    setFilterGrade("");
    setFilterFrom("");
    setFilterTo("");
  };

  const segments = result
    ? [
        { key: "purchase", label: "Purchase", value: result.breakdown.purchase, color: "var(--c-chart-1)" },
        { key: "transport", label: "Transport + handling", value: result.breakdown.transportHandling, color: "var(--c-chart-3)" },
        { key: "loss", label: "Loss + credit", value: result.breakdown.lossCredit, color: "var(--c-chart-5)" },
        { key: "profit", label: "Profit", value: result.breakdown.profit, color: "var(--c-chart-2)" },
      ]
    : [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight md:text-2xl">
            <IconCalculator size={22} /> Green Coffee Pricing
          </h1>
          <p className="text-sm text-muted">
            Work out the selling price per kg for each kind of buyer. Prices update as you type.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${tab === "calculator" ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            onClick={() => setTab("calculator")}
          >
            Calculator
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${tab === "history" ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            onClick={() => {
              setTab("history");
              setHistoryLoading(true);
            }}
          >
            History
          </button>
        </div>
      </div>

      <datalist id="pricing-grade-options">
        {gradeChoices.map((option) => <option key={option} value={option} />)}
      </datalist>

      {tab === "calculator" ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* ---------------- inputs ---------------- */}
            <div className="space-y-4">
              <div className="card space-y-3 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="label" htmlFor="pricing-grade">Coffee grade</label>
                    <input
                      id="pricing-grade"
                      className="input"
                      list="pricing-grade-options"
                      value={grade}
                      maxLength={80}
                      placeholder="e.g. Robusta Cherry"
                      onChange={(event) => {
                        setGrade(event.currentTarget.value);
                        setGradeError(null);
                      }}
                    />
                    {gradeError && <p role="alert" className="text-xs text-error-ink">{gradeError}</p>}
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="btn-mini w-full"
                      onClick={() => void useLatestPrice()}
                      disabled={latestBusy}
                    >
                      <IconRefresh size={14} /> {latestBusy ? "Checking stock…" : "Use latest purchase price"}
                    </button>
                  </div>
                </div>
                {latestMessage && <p className="text-xs text-muted">{latestMessage}</p>}
                <div className="space-y-1">
                  <label className="label" htmlFor="pricing-note">Note <span className="font-normal normal-case tracking-normal text-muted">(optional)</span></label>
                  <input
                    id="pricing-note"
                    className="input"
                    value={note}
                    maxLength={500}
                    placeholder="e.g. buyer collects, 30 days credit"
                    onChange={(event) => setNote(event.currentTarget.value)}
                  />
                </div>
              </div>

              <div className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold">Cost</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField label="Purchase price" suffix="₹ / kg" value={form.purchasePrice} error={fieldError("purchasePrice")} onChange={(value) => setField("purchasePrice", value)} />
                  <NumberField label="Transport" suffix="₹ / kg" value={form.transport} error={fieldError("transport")} onChange={(value) => setField("transport", value)} />
                  <NumberField label="Bags, handling, storage" suffix="₹ / kg" value={form.handling} error={fieldError("handling")} onChange={(value) => setField("handling", value)} />
                  <NumberField label="Weight loss" suffix="% moisture, sorting" value={form.weightLossPct} error={fieldError("weightLossPct")} onChange={(value) => setField("weightLossPct", value)} />
                  <NumberField label="Credit given to buyer" suffix="days" value={form.creditDays} error={fieldError("creditDays")} onChange={(value) => setField("creditDays", value)} />
                  <NumberField label="Yearly interest on our money" suffix="%" value={form.interestPct} error={fieldError("interestPct")} onChange={(value) => setField("interestPct", value)} />
                </div>
              </div>

              <div className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold">Margin by buyer</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField label="Bulk buyer margin" suffix="%" value={form.bulkMarginPct} error={fieldError("bulkMarginPct")} onChange={(value) => setField("bulkMarginPct", value)} />
                  <NumberField label="Bulk buyer quantity" suffix="kg / month" value={form.bulkKgPerMonth} error={fieldError("bulkKgPerMonth")} onChange={(value) => setField("bulkKgPerMonth", value)} />
                  <NumberField label="Regular buyer margin" suffix="%" value={form.regularMarginPct} error={fieldError("regularMarginPct")} onChange={(value) => setField("regularMarginPct", value)} />
                  <NumberField label="Regular buyer quantity" suffix="kg / month" value={form.regularKgPerMonth} error={fieldError("regularKgPerMonth")} onChange={(value) => setField("regularKgPerMonth", value)} />
                  <NumberField label="Small buyer margin" suffix="%" value={form.smallMarginPct} error={fieldError("smallMarginPct")} onChange={(value) => setField("smallMarginPct", value)} />
                  <NumberField label="Small buyer quantity" suffix="kg / month" value={form.smallKgPerMonth} error={fieldError("smallKgPerMonth")} onChange={(value) => setField("smallKgPerMonth", value)} />
                </div>
              </div>

              <div className="card space-y-3 p-4">
                <h2 className="text-sm font-semibold">Roaster ceiling</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberField label="Roaster's powder selling price" suffix="₹ / kg" value={form.powderPrice} error={fieldError("powderPrice")} onChange={(value) => setField("powderPrice", value)} />
                  <NumberField label="Powder yield from green beans" suffix="%" value={form.yieldPct} error={fieldError("yieldPct")} onChange={(value) => setField("yieldPct", value)} />
                  <NumberField label="Roasting, grinding, packing" suffix="₹ / kg" value={form.processingCost} error={fieldError("processingCost")} onChange={(value) => setField("processingCost", value)} />
                  <NumberField label="Roaster's profit" suffix="%" value={form.roasterProfitPct} error={fieldError("roasterProfitPct")} onChange={(value) => setField("roasterProfitPct", value)} />
                </div>
              </div>
            </div>

            {/* ---------------- results ---------------- */}
            <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
              {!result ? (
                <div className="card space-y-2 p-6">
                  <h2 className="text-lg font-semibold">Check the highlighted fields</h2>
                  <p className="text-sm text-muted">
                    {errorCount} {errorCount === 1 ? "field needs" : "fields need"} a valid number. Prices appear as soon as every field is valid.
                  </p>
                </div>
              ) : (
                <>
                  <div className="card space-y-4 p-4">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Regular buyer price</p>
                        <p className="font-display text-5xl font-semibold leading-none text-accent-ink">
                          {formatPricingMoney(result.regularPrice)}
                          <span className="ml-1 text-sm font-normal text-muted">/ kg</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Landed cost</p>
                          <p className="mt-0.5 font-semibold">{formatPricingMoney(result.landedCost, 1)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Roaster max</p>
                          <p className="mt-0.5 font-semibold">{formatPricingMoney(result.roasterMaxPrice)}</p>
                        </div>
                      </div>
                    </div>

                    <div
                      role="status"
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        result.status.level === "ok"
                          ? "border-secondary/40 bg-secondary-soft text-secondary-ink"
                          : "border-error/40 bg-error-soft text-error-ink"
                      }`}
                    >
                      {result.status.message}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="font-medium uppercase tracking-wider">How the regular price adds up</span>
                        <span>{formatPricingMoney(result.regularPrice)}</span>
                      </div>
                      <div className="flex h-9 w-full overflow-hidden rounded-lg border border-line bg-surface-2" aria-hidden="true">
                        {segments.map((segment) => (
                          <div
                            key={segment.key}
                            className="h-full"
                            style={{
                              width: `${result.breakdown.total > 0 ? (segment.value / result.breakdown.total) * 100 : 0}%`,
                              background: segment.color,
                            }}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                        {segments.map((segment) => (
                          <div key={segment.key} className="flex items-center gap-1.5">
                            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} />
                            <span className="min-w-0 truncate text-muted">{segment.label}</span>
                            <span className="ml-auto font-medium">{whole(segment.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[430px] text-sm" aria-label="Buyer prices">
                        <thead>
                          <tr>
                            <th className="px-2 py-2 text-left">Buyer</th>
                            <th className="px-2 py-2 text-right">Price / kg</th>
                            <th className="px-2 py-2 text-right">Profit / kg</th>
                            <th className="px-2 py-2 text-right">kg / month</th>
                            <th className="px-2 py-2 text-right">Monthly profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.tiers.map((tier) => (
                            <tr key={tier.key} className="border-t border-line">
                              <td className="px-2 py-2 font-medium">{tier.label}</td>
                              <td className="px-2 py-2 text-right">{formatPricingMoney(tier.sellingPrice)}</td>
                              <td className="px-2 py-2 text-right">{formatPricingMoney(tier.profitPerKg, 2)}</td>
                              <td className="px-2 py-2 text-right">{tier.kgPerMonth.toLocaleString("en-IN")}</td>
                              <td className="px-2 py-2 text-right">{formatPricingMoney(tier.monthlyProfit)}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                            <td className="px-2 py-2">Total</td>
                            <td className="px-2 py-2 text-right text-muted">—</td>
                            <td className="px-2 py-2 text-right text-muted">—</td>
                            <td className="px-2 py-2 text-right">
                              {result.tiers.reduce((sum, tier) => sum + tier.kgPerMonth, 0).toLocaleString("en-IN")}
                            </td>
                            <td className="px-2 py-2 text-right">{formatPricingMoney(result.totalMonthlyProfit)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <p className="text-[11px] text-muted">Prices are ex-GST — GST is not included in this calculation.</p>

                    <div className="border-t border-line pt-3">
                      <button
                        type="button"
                        className="btn btn-primary w-full"
                        onClick={() => void saveCalculation()}
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save calculation"}
                      </button>
                      <p className="mt-2 text-center text-[11px] text-muted">
                        Saves the grade, note, inputs and results with your name and time.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <details className="card p-4">
                <summary className="cursor-pointer text-sm font-medium">How this is calculated</summary>
                <div className="mt-3 space-y-2 text-xs text-muted">
                  <p><span className="font-mono text-ink">Weight loss</span> = purchase × loss% ÷ 100</p>
                  <p><span className="font-mono text-ink">Credit cost</span> = purchase × interest% ÷ 100 ÷ 365 × credit days</p>
                  <p><span className="font-mono text-ink">Landed cost</span> = purchase + transport + handling + weight loss + credit cost</p>
                  <p><span className="font-mono text-ink">Selling price</span> = CEIL(landed × (1 + margin% ÷ 100) ÷ 5) × 5 — always rounded UP to the next ₹5</p>
                  <p><span className="font-mono text-ink">Profit / kg</span> = selling price − landed cost</p>
                  <p><span className="font-mono text-ink">Monthly profit</span> = profit / kg × kg per month</p>
                  <p><span className="font-mono text-ink">Roaster revenue</span> = powder price × yield% ÷ 100</p>
                  <p><span className="font-mono text-ink">Roaster max price</span> = roaster revenue − processing cost − roaster revenue × roaster profit% ÷ 100</p>
                  <p className="pt-1 text-[11px]">GST is not included in any price on this page.</p>
                </div>
              </details>
            </div>
          </div>
        </>
      ) : (
        /* ---------------- history ---------------- */
        <div className="space-y-4">
          <div className="card p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <label className="label" htmlFor="pricing-filter-grade">Grade</label>
                <input
                  id="pricing-filter-grade"
                  className="input"
                  list="pricing-grade-options"
                  value={filterGrade}
                  placeholder="All grades"
                  onChange={(event) => setFilterGrade(event.currentTarget.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="label" htmlFor="pricing-filter-from">From date</label>
                <input
                  id="pricing-filter-from"
                  className="input"
                  type="date"
                  value={filterFrom}
                  onChange={(event) => setFilterFrom(event.currentTarget.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="label" htmlFor="pricing-filter-to">To date</label>
                <input
                  id="pricing-filter-to"
                  className="input"
                  type="date"
                  value={filterTo}
                  onChange={(event) => setFilterTo(event.currentTarget.value)}
                />
              </div>
              <div className="flex items-end">
                <button type="button" className="btn-mini w-full" onClick={resetFilters}>
                  Clear filters
                </button>
              </div>
            </div>
          </div>

          {historyError && (
            <p role="alert" className="rounded-xl border border-error/40 bg-error-soft px-3 py-2 text-sm text-error-ink">
              {historyError}
            </p>
          )}

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <h2 className="text-sm font-medium">
                Saved calculations {historyLoading ? "…" : `(${history.length})`}
              </h2>
            </div>
            {history.length === 0 ? (
              <div className="px-4 pb-6 pt-2 text-center text-sm text-muted">
                {historyLoading
                  ? "Loading saved calculations…"
                  : "No saved calculations match these filters yet. Save one from the Calculator tab."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left">Saved</th>
                      <th className="px-4 py-2 text-left">Grade</th>
                      <th className="px-4 py-2 text-right">Regular / kg</th>
                      <th className="px-4 py-2 text-right">Landed</th>
                      <th className="px-4 py-2 text-right">Monthly profit</th>
                      <th className="px-4 py-2 text-left">By</th>
                      <th className="px-4 py-2 text-left">Note</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id} className="border-t border-line">
                        <td className="whitespace-nowrap px-4 py-2">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-2 font-medium">{row.grade}</td>
                        <td className="px-4 py-2 text-right">{formatPricingMoney(row.results.regularPrice)}</td>
                        <td className="px-4 py-2 text-right">{formatPricingMoney(row.results.landedCost, 1)}</td>
                        <td className="px-4 py-2 text-right">{formatPricingMoney(row.results.totalMonthlyProfit)}</td>
                        <td className="whitespace-nowrap px-4 py-2">{row.createdByName}</td>
                        <td className="max-w-[220px] truncate px-4 py-2 text-muted" title={row.note ?? ""}>{row.note ?? "—"}</td>
                        <td className="px-4 py-2">
                          <RowActions>
                            <button type="button" className="btn-mini" onClick={() => openCalculation(row)}>
                              Open
                            </button>
                            {isAdmin && (
                              <DeleteRowButton
                                label="Delete saved calculation"
                                onClick={() => void removeCalculation(row)}
                              />
                            )}
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-muted">Delete is available to the owner (admin) only.</p>
        </div>
      )}
    </section>
  );
}
