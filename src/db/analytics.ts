/** Analytics queries — feed the pure functions in ../logic/analytics. */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { batches, expenses, investments, items, movementBatchLinks, saleBills, saleItems, sales, stockMovements } from "./schema";

export type AnalysisBatch = {
  itemId: number;
  itemName: string;
  unit: string;
  batchId: number;
  purchaseDate: string;
  buyUnitPaise: number;
  qtyOriginalBase: number;
  qtyRemainingBase: number;
};

export type AnalysisTake = {
  batchId: number;
  saleDate: string;
  qtyTakenBase: number;
  sellUnitPaise: number;
};

/** All batches (optionally one item), newest context for batch analysis. */
export function listBatches(db: Db, itemId?: number): Promise<AnalysisBatch[]> {
  return db
    .select({
      itemId: items.id,
      itemName: items.name,
      unit: items.unit,
      batchId: batches.id,
      purchaseDate: batches.purchaseDate,
      buyUnitPaise: batches.unitPricePaise,
      qtyOriginalBase: batches.qtyOriginal,
      qtyRemainingBase: batches.qtyRemaining,
    })
    .from(batches)
    .innerJoin(items, eq(batches.itemId, items.id))
    .where(itemId ? eq(batches.itemId, itemId) : undefined)
    .orderBy(asc(items.name), asc(batches.purchaseDate), asc(batches.id));
}

/** FIFO takes per batch with the selling price (billed lines or legacy sales). */
export function listBatchTakes(db: Db, itemId?: number, start?: string, end?: string): Promise<AnalysisTake[]> {
  return db
    .select({
      batchId: movementBatchLinks.batchId,
      qtyTakenBase: movementBatchLinks.qtyTaken,
      saleDate: stockMovements.movementDate,
      sellUnitPaise: sql<number>`coalesce(${sales.unitPricePaise}, ${saleItems.unitPricePaise})`,
    })
    .from(movementBatchLinks)
    .innerJoin(stockMovements, eq(movementBatchLinks.movementId, stockMovements.id))
    .leftJoin(sales, eq(sales.movementId, stockMovements.id))
    .leftJoin(saleItems, eq(saleItems.movementId, stockMovements.id))
    .where(
      and(
        eq(stockMovements.type, "SALE"),
        itemId ? eq(stockMovements.itemId, itemId) : undefined,
        start ? gte(stockMovements.movementDate, start) : undefined,
        end ? lte(stockMovements.movementDate, end) : undefined,
      ),
    )
    .orderBy(asc(stockMovements.movementDate));
}

export type PeriodSales = {
  netSalesPaise: number;
  cogsPaise: number;
  profitPaise: number;
};

/** Net sales (pre-GST subtotal) + COGS + profit for a date range (bills, not cancelled). */
export async function salesSummary(db: Db, start: string, end: string): Promise<PeriodSales> {
  const [salesRow] = await db
    .select({
      net: sql<string>`coalesce(sum(${saleBills.subtotalPaise}), 0)`,
    })
    .from(saleBills)
    .where(and(eq(saleBills.cancelled, false), gte(saleBills.saleDate, start), lte(saleBills.saleDate, end)));
  const [cogsRow] = await db
    .select({
      cost: sql<string>`coalesce(sum(${saleItems.costPaise}), 0)`,
      profit: sql<string>`coalesce(sum(${saleItems.profitPaise}), 0)`,
    })
    .from(saleItems)
    .innerJoin(saleBills, eq(saleItems.saleId, saleBills.id))
    .where(and(eq(saleBills.cancelled, false), gte(saleBills.saleDate, start), lte(saleBills.saleDate, end)));
  return {
    netSalesPaise: Number(salesRow?.net ?? 0),
    cogsPaise: Number(cogsRow?.cost ?? 0),
    profitPaise: Number(cogsRow?.profit ?? 0),
  };
}

/** Daily subtotal + profit for the line charts. */
export function salesByDay(db: Db, start: string, end: string) {
  return db
    .select({
      day: saleBills.saleDate,
      subtotalPaise: sql<string>`coalesce(sum(${saleBills.subtotalPaise}), 0)`,
    })
    .from(saleBills)
    .where(and(eq(saleBills.cancelled, false), gte(saleBills.saleDate, start), lte(saleBills.saleDate, end)))
    .groupBy(saleBills.saleDate)
    .orderBy(asc(saleBills.saleDate));
}

/** Expenses in a range, grouped by category. */
export function expensesByCategory(db: Db, start: string, end: string) {
  return db
    .select({
      category: expenses.category,
      totalPaise: sql<string>`coalesce(sum(${expenses.amountPaise}), 0)`,
    })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, start), lte(expenses.expenseDate, end)))
    .groupBy(expenses.category)
    .orderBy(asc(sql`sum(${expenses.amountPaise})`));
}

/** Total expense amount in a range (all types — report as assumption). */
export async function expensesTotal(db: Db, start: string, end: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amountPaise}), 0)` })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, start), lte(expenses.expenseDate, end)));
  return Number(row?.total ?? 0);
}

/** Daily COGS + gross profit (bill line items) for the profit chart. */
export function profitByDay(db: Db, start: string, end: string) {
  return db
    .select({
      day: saleBills.saleDate,
      costPaise: sql<string>`coalesce(sum(${saleItems.costPaise}), 0)`,
      profitPaise: sql<string>`coalesce(sum(${saleItems.profitPaise}), 0)`,
    })
    .from(saleItems)
    .innerJoin(saleBills, eq(saleItems.saleId, saleBills.id))
    .where(and(eq(saleBills.cancelled, false), gte(saleBills.saleDate, start), lte(saleBills.saleDate, end)))
    .groupBy(saleBills.saleDate)
    .orderBy(asc(saleBills.saleDate));
}

/** Daily expenses for the net-profit line. */
export function expensesByDay(db: Db, start: string, end: string) {
  return db
    .select({
      day: expenses.expenseDate,
      totalPaise: sql<string>`coalesce(sum(${expenses.amountPaise}), 0)`,
    })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, start), lte(expenses.expenseDate, end)))
    .groupBy(expenses.expenseDate)
    .orderBy(asc(expenses.expenseDate));
}

/** Gross profit per item in a range (bar chart). */
export function profitByItem(db: Db, start: string, end: string) {
  return db
    .select({
      itemName: items.name,
      profitPaise: sql<string>`coalesce(sum(${saleItems.profitPaise}), 0)`,
    })
    .from(saleItems)
    .innerJoin(saleBills, eq(saleItems.saleId, saleBills.id))
    .innerJoin(items, eq(saleItems.itemId, items.id))
    .where(and(eq(saleBills.cancelled, false), gte(saleBills.saleDate, start), lte(saleBills.saleDate, end)))
    .groupBy(items.name)
    .orderBy(asc(sql`sum(${saleItems.profitPaise})`));
}

/** Capital invested up to and including a date (cumulative = capital account). */
export async function capitalThrough(db: Db, date: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${investments.amountPaise}), 0)` })
    .from(investments)
    .where(lte(investments.investedOn, date));
  return Number(row?.total ?? 0);
}

/** Per-item remaining qty + stock value at batch cost + low-stock flag. */
export function stockValueByItem(db: Db) {
  return db
    .select({
      itemId: items.id,
      itemName: items.name,
      unit: items.unit,
      minStockBase: items.minStockBase,
      qtyRemainingBase: sql<string>`coalesce(sum(${batches.qtyRemaining}), 0)`,
      valuePaise: sql<string>`coalesce(sum(${batches.qtyRemaining} * ${batches.unitPricePaise} / case when ${items.unit} = '60 kg bag' then 60000 when ${items.unit} in ('g','kg','ml','l') then 1000 else 1 end), 0)`,
    })
    .from(items)
    .leftJoin(batches, eq(batches.itemId, items.id))
    .groupBy(items.id, items.name, items.unit, items.minStockBase);
}