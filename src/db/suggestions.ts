import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { aiSuggestions } from "./schema";
import type { RuleItem, RuleStats, Suggestion } from "../logic/rules";
import { monthRange } from "./expenses";
import type { Unit } from "../logic/units";

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (result as T[]);
}

function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, number - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Everything buildSuggestions() needs, in one query (+ one for spend). */
export async function loadRuleStats(db: Db, month: string): Promise<RuleStats> {
  const { start, end } = monthRange(month);
  const prev = monthRange(previousMonth(month));

  const itemRows = rowsOf<{
    id: number;
    name: string;
    unit: string;
    min_stock_base: number;
    stock: number;
    used: number;
    wasted: number;
    bought: number;
    latest: number | null;
    previous: number | null;
  }>(
    await db.execute(sql`
      with stock as (
        select item_id, sum(qty_remaining)::int as stock from batches group by item_id
      ), used as (
        select item_id,
               sum(case when type in ('STOCK_CHECK', 'USAGE') then -qty_change else 0 end)::int as used,
               sum(case when type = 'WASTAGE' then -qty_change else 0 end)::int as wasted
        from stock_movements
        where movement_date >= current_date - 30
        group by item_id
      ), bought as (
        select item_id, sum(qty_base)::int as bought
        from purchases
        where purchase_date >= current_date - 30 and source = 'purchase'
        group by item_id
      ), prices as (
        select item_id,
               (array_agg(unit_price_paise order by purchase_date desc, id desc))[1] as latest,
               (array_agg(unit_price_paise order by purchase_date desc, id desc))[2] as previous
        from purchases
        where source = 'purchase'
        group by item_id
      )
      select i.id, i.name, i.unit, i.min_stock_base,
             coalesce(s.stock, 0) as stock,
             coalesce(u.used, 0) as used,
             coalesce(u.wasted, 0) as wasted,
             coalesce(b.bought, 0) as bought,
             p.latest, p.previous
      from items i
      left join stock s on s.item_id = i.id
      left join used u on u.item_id = i.id
      left join bought b on b.item_id = i.id
      left join prices p on p.item_id = i.id
      order by i.name
    `),
  );

  const items: RuleItem[] = itemRows.map((row) => ({
    itemId: Number(row.id),
    itemName: row.name,
    unit: row.unit as Unit,
    stockLeft: Number(row.stock),
    minStock: Number(row.min_stock_base),
    qtyUsed30d: Number(row.used),
    qtyBought30d: Number(row.bought),
    wastage30d: Number(row.wasted),
    latestPricePaise: row.latest === null ? null : Number(row.latest),
    previousPricePaise: row.previous === null ? null : Number(row.previous),
  }));

  const [spend] = rowsOf<{ current: number; previous: number }>(
    await db.execute(sql`
      select
        coalesce(sum(case when d >= ${start}::date and d < ${end}::date then amt else 0 end), 0)::int as current,
        coalesce(sum(case when d >= ${prev.start}::date and d < ${prev.end}::date then amt else 0 end), 0)::int as previous
      from (
        select purchase_date as d, total_paise as amt from purchases where source = 'purchase'
        union all
        select expense_date as d, amount_paise as amt from expenses
      ) t
    `),
  );

  return {
    items,
    monthSpendPaise: Number(spend?.current ?? 0),
    previousMonthSpendPaise: Number(spend?.previous ?? 0),
  };
}

export function suggestionKey(suggestion: { type: string; itemId: number | null }): string {
  return `${suggestion.type}:${suggestion.itemId ?? "all"}`;
}

/** Suggestions the user has already dismissed (kept forever so they stay hidden). */
export async function dismissedKeys(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ type: aiSuggestions.type, itemId: aiSuggestions.itemId })
    .from(aiSuggestions)
    .where(eq(aiSuggestions.dismissed, true));
  return new Set(rows.map((r) => suggestionKey({ type: r.type, itemId: r.itemId })));
}

export async function dismissSuggestion(db: Db, suggestion: Suggestion): Promise<void> {
  await db.insert(aiSuggestions).values({
    type: suggestion.type,
    itemId: suggestion.itemId,
    message: suggestion.message,
    priority: suggestion.priority,
    dismissed: true,
  });
}

export type StoredSuggestion = {
  id: number;
  type: string;
  itemId: number | null;
  message: string;
  priority: number;
  createdAt: Date;
};

/** Cached AI results (dismissed = false), newest first. */
export async function listStoredSuggestions(db: Db): Promise<StoredSuggestion[]> {
  return db
    .select({
      id: aiSuggestions.id,
      type: aiSuggestions.type,
      itemId: aiSuggestions.itemId,
      message: aiSuggestions.message,
      priority: aiSuggestions.priority,
      createdAt: aiSuggestions.createdAt,
    })
    .from(aiSuggestions)
    .where(eq(aiSuggestions.dismissed, false))
    .orderBy(desc(aiSuggestions.createdAt), aiSuggestions.priority);
}

export async function replaceStoredSuggestions(
  db: Db,
  rows: { type: string; itemId: number | null; message: string; priority: number }[],
): Promise<void> {
  await db.delete(aiSuggestions).where(eq(aiSuggestions.dismissed, false));
  if (rows.length > 0) {
    await db.insert(aiSuggestions).values(rows);
  }
}
