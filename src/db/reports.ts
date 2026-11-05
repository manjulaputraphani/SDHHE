/**
 * Financial-year reports: turnover, purchases, gross profit, net profit and
 * closing stock (India FY: 1 April → 31 March).
 *
 * Money is integer paise; every figure below excludes GST.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { batches, customers, expenses, items, purchases, saleBills, saleItems } from "./schema";
import { finYearRange, listFinYearLabels } from "../logic/finYear";
import { baseFactor, type Unit } from "../logic/units";

export type ClosingStockRow = {
  itemId: number;
  name: string;
  unit: string;
  qtyBase: number;
  valuePaise: number;
  avgCostPaise: number;
};

export type FinYearReport = {
  finYear: string;
  startDate: string;
  endDate: string;
  /** Sales value minus discounts (GST excluded). */
  turnoverPaise: number;
  discountsPaise: number;
  gstPaise: number;
  salesCount: number;
  purchaseValuePaise: number;
  purchaseExpensesPaise: number;
  totalPurchasesPaise: number;
  /** Cost of goods sold (snapshot of the average cost at the time of the sale). */
  cogsPaise: number;
  grossProfitPaise: number;
  saleExpensesPaise: number;
  generalExpensesPaise: number;
  netProfitPaise: number;
  closingStock: ClosingStockRow[];
  closingStockQtyBase: number;
  closingStockValuePaise: number;
};

export type DealLineProfit = {
  itemName: string;
  qtyBase: number;
  unit: string;
  ratePaise: number;
  avgCostPaise: number;
  saleValuePaise: number;
  cogsPaise: number;
  profitPaise: number;
  profitPercent: number;
};

export type DealProfit = {
  saleId: number;
  billNo: string;
  date: string;
  customerName: string | null;
  saleValuePaise: number;
  discountPaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
  saleExpensesPaise: number;
  netProfitPaise: number;
  profitPercent: number;
  lines: DealLineProfit[];
};

/** Profit % of a deal (net profit on the sale value). */
export function profitPercent(netPaise: number, saleValuePaise: number): number {
  if (saleValuePaise === 0) return 0;
  return Math.round((netPaise * 100) / saleValuePaise);
}

/** The FY report for one financial year. */
export async function finYearReport(db: Db, label: string): Promise<FinYearReport> {
  const { startDate, endDate } = finYearRange(label);
  const inRange = and(gte(saleBills.saleDate, startDate), lte(saleBills.saleDate, endDate));

  const [sales] = await db
    .select({
      turnoverPaise: sql<number>`coalesce(sum(${saleBills.subtotalPaise} - ${saleBills.discountPaise}), 0)`.mapWith(Number),
      discountsPaise: sql<number>`coalesce(sum(${saleBills.discountPaise}), 0)`.mapWith(Number),
      gstPaise: sql<number>`coalesce(sum(${saleBills.gstPaise}), 0)`.mapWith(Number),
      saleExpensesPaise: sql<number>`coalesce(sum(${saleBills.saleExpensesPaise}), 0)`.mapWith(Number),
      salesCount: sql<number>`count(*)`.mapWith(Number),
    })
    .from(saleBills)
    .where(and(inRange, eq(saleBills.cancelled, false)));

  const [cogs] = await db
    .select({ cogsPaise: sql<number>`coalesce(sum(${saleItems.costPaise}), 0)`.mapWith(Number) })
    .from(saleItems)
    .innerJoin(saleBills, eq(saleItems.saleId, saleBills.id))
    .where(and(inRange, eq(saleBills.cancelled, false)));

  const [buy] = await db
    .select({
      purchaseValuePaise: sql<number>`coalesce(sum(${purchases.totalPaise}), 0)`.mapWith(Number),
      purchaseExpensesPaise: sql<number>`coalesce(sum(${purchases.expensesPaise}), 0)`.mapWith(Number),
    })
    .from(purchases)
    .where(
      and(
        gte(purchases.purchaseDate, startDate),
        lte(purchases.purchaseDate, endDate),
        eq(purchases.source, "purchase"),
      ),
    );

  // Sale expenses that are not attached to a deal are counted on their own.
  const [standaloneSale] = await db
    .select({ amountPaise: sql<number>`coalesce(sum(${expenses.amountPaise}), 0)`.mapWith(Number) })
    .from(expenses)
    .where(
      and(
        eq(expenses.expenseType, "sale"),
        isNull(expenses.relatedSaleId),
        gte(expenses.expenseDate, startDate),
        lte(expenses.expenseDate, endDate),
      ),
    );

  // Purchase expenses that are not attached to a purchase are counted on their
  // own (the ones linked to a purchase are already inside purchases.expenses_paise).
  const [standalonePurchase] = await db
    .select({ amountPaise: sql<number>`coalesce(sum(${expenses.amountPaise}), 0)`.mapWith(Number) })
    .from(expenses)
    .where(
      and(
        eq(expenses.expenseType, "purchase"),
        isNull(expenses.relatedPurchaseId),
        gte(expenses.expenseDate, startDate),
        lte(expenses.expenseDate, endDate),
      ),
    );

  const [general] = await db
    .select({ amountPaise: sql<number>`coalesce(sum(${expenses.amountPaise}), 0)`.mapWith(Number) })
    .from(expenses)
    .where(
      and(
        eq(expenses.expenseType, "general"),
        gte(expenses.expenseDate, startDate),
        lte(expenses.expenseDate, endDate),
      ),
    );

  const closingStock = await closingStockRows(db);

  const grossProfitPaise = sales.turnoverPaise - cogs.cogsPaise;
  const saleExpensesPaise = sales.saleExpensesPaise + standaloneSale.amountPaise;
  const purchaseExpensesPaise = buy.purchaseExpensesPaise + standalonePurchase.amountPaise;
  const netProfitPaise = grossProfitPaise - saleExpensesPaise - general.amountPaise;

  return {
    finYear: label,
    startDate,
    endDate,
    turnoverPaise: sales.turnoverPaise,
    discountsPaise: sales.discountsPaise,
    gstPaise: sales.gstPaise,
    salesCount: sales.salesCount,
    purchaseValuePaise: buy.purchaseValuePaise,
    purchaseExpensesPaise,
    totalPurchasesPaise: buy.purchaseValuePaise + purchaseExpensesPaise,
    cogsPaise: cogs.cogsPaise,
    grossProfitPaise,
    saleExpensesPaise,
    generalExpensesPaise: general.amountPaise,
    netProfitPaise,
    closingStock,
    closingStockQtyBase: closingStock.reduce((sum, row) => sum + row.qtyBase, 0),
    closingStockValuePaise: closingStock.reduce((sum, row) => sum + row.valuePaise, 0),
  };
}

/** Stock on hand per item: quantity, value and average cost. */
export async function closingStockRows(db: Db): Promise<ClosingStockRow[]> {
  const rows = await db
    .select({
      itemId: items.id,
      name: items.name,
      unit: items.unit,
      qtyBase: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)`.mapWith(Number),
      valuePaise: sql<number>`coalesce(${items.stockValuePaise}, 0)`.mapWith(Number),
      avgCostPaise: sql<number>`coalesce(${items.avgCostPaise}, 0)`.mapWith(Number),
    })
    .from(items)
    .leftJoin(batches, eq(batches.itemId, items.id))
    .groupBy(items.id)
    .orderBy(asc(items.name));
  return rows.map((row) => ({
    ...row,
    valuePaise: row.qtyBase > 0 ? row.valuePaise : 0,
    avgCostPaise: row.qtyBase > 0 ? row.avgCostPaise : 0,
  }));
}

/** Every deal of a financial year with its profit breakdown. */
export async function dealProfits(db: Db, label: string): Promise<DealProfit[]> {
  const { startDate, endDate } = finYearRange(label);
  const bills = await db
    .select({
      id: saleBills.id,
      billNo: saleBills.billNo,
      date: saleBills.saleDate,
      customerName: customers.name,
      subtotalPaise: saleBills.subtotalPaise,
      discountPaise: saleBills.discountPaise,
      saleExpensesPaise: saleBills.saleExpensesPaise,
      cancelled: saleBills.cancelled,
    })
    .from(saleBills)
    .leftJoin(customers, eq(customers.id, saleBills.customerId))
    .where(and(gte(saleBills.saleDate, startDate), lte(saleBills.saleDate, endDate)))
    .orderBy(desc(saleBills.saleDate), desc(saleBills.id));

  const live = bills.filter((bill) => !bill.cancelled);
  if (live.length === 0) return [];
  const ids = live.map((bill) => bill.id);

  const lines = await db
    .select({
      saleId: saleItems.saleId,
      itemId: saleItems.itemId,
      itemName: items.name,
      unit: items.unit,
      qtyBase: saleItems.qtyBase,
      ratePaise: saleItems.unitPricePaise,
      avgCostPaise: saleItems.avgCostPaise,
      saleValuePaise: saleItems.lineTotalPaise,
      cogsPaise: saleItems.costPaise,
    })
    .from(saleItems)
    .innerJoin(items, eq(items.id, saleItems.itemId))
    .where(inArray(saleItems.saleId, ids))
    .orderBy(asc(saleItems.id));

  const bySale = new Map<number, DealLineProfit[]>();
  for (const line of lines) {
    const profitPaise = line.saleValuePaise - line.cogsPaise;
    const row: DealLineProfit = {
      itemName: line.itemName,
      qtyBase: line.qtyBase,
      unit: line.unit,
      ratePaise: line.ratePaise,
      avgCostPaise: line.avgCostPaise,
      saleValuePaise: line.saleValuePaise,
      cogsPaise: line.cogsPaise,
      profitPaise,
      profitPercent: profitPercent(profitPaise, line.saleValuePaise),
    };
    const list = bySale.get(line.saleId) ?? [];
    list.push(row);
    bySale.set(line.saleId, list);
  }

  return live.map((bill) => {
    const saleLines = bySale.get(bill.id) ?? [];
    const saleValuePaise = bill.subtotalPaise - bill.discountPaise;
    const cogsPaise = saleLines.reduce((sum, line) => sum + line.cogsPaise, 0);
    const grossProfitPaise = saleValuePaise - cogsPaise;
    const netProfitPaise = grossProfitPaise - bill.saleExpensesPaise;
    return {
      saleId: bill.id,
      billNo: bill.billNo,
      date: bill.date,
      customerName: bill.customerName,
      saleValuePaise,
      discountPaise: bill.discountPaise,
      cogsPaise,
      grossProfitPaise,
      saleExpensesPaise: bill.saleExpensesPaise,
      netProfitPaise,
      profitPercent: profitPercent(netProfitPaise, saleValuePaise),
      lines: saleLines,
    };
  });
}

/** Financial years that have data (plus the current one) for the FY selector. */
export async function finYearOptions(db: Db): Promise<string[]> {
  const [oldestPurchase] = await db
    .select({ date: sql<string>`min(${purchases.purchaseDate})`.mapWith(String) })
    .from(purchases);
  const [oldestSale] = await db
    .select({ date: sql<string>`min(${saleBills.saleDate})`.mapWith(String) })
    .from(saleBills);

  const dates = [oldestPurchase?.date, oldestSale?.date].filter(
    (date): date is string => Boolean(date) && date !== "",
  );
  const today = new Date().toISOString().slice(0, 10);
  const earliest = dates.length ? (dates.sort()[0] as string) : today;
  const labels = listFinYearLabels(earliest, today);
  const current = listFinYearLabels(today, today)[0];
  if (!labels.includes(current)) labels.push(current);
  return labels.reverse(); // newest first
}

/** Average cost per display unit for an item (from the value pool). */
export function avgCostPerUnit(valuePaise: number, qtyBase: number, unit: string): number {
  const factor = baseFactor(unit as Unit);
  if (qtyBase <= 0) return 0;
  return Math.round((valuePaise * factor) / qtyBase);
}

// ---- Lot-wise (per-batch) ledger — T-2 -------------------------------------

export type BatchLedgerSale = {
  billNo: string;
  saleDate: string;
  customerName: string | null;
  /** Base units taken from this batch for this sale. */
  qtyTaken: number;
  /** Sale unit price (paise per display unit) of the line. */
  unitPricePaise: number;
  /** This batch's share of the line revenue (paise), by quantity. */
  revenuePaise: number;
  /** Cost of goods sold from this batch for this sale (paise). */
  cogsPaise: number;
  /** revenuePaise − cogsPaise. */
  profitPaise: number;
};

export type BatchLedgerRow = {
  batchId: number;
  purchaseId: number;
  purchaseDate: string;
  supplierName: string | null;
  /** Original purchased quantity (base units). */
  qtyOriginal: number;
  /** Quantity still on hand (base units). */
  qtyRemaining: number;
  /** Purchase unit price (paise per display unit). */
  unitPricePaise: number;
  /** Purchase expenses (transport etc.) in paise. */
  expensesPaise: number;
  /** Quantity sold out of this batch (base units). */
  qtySold: number;
  /** This batch's share of sale revenue (paise). */
  soldValuePaise: number;
  /** Cost of goods sold from this batch (paise). */
  cogsPaise: number;
  /** soldValuePaise − cogsPaise. */
  profitPaise: number;
  /** Value of the stock still on hand (paise). */
  pendingValuePaise: number;
  /** Individual sales that drew from this batch (oldest first). */
  sales: BatchLedgerSale[];
};

export type BatchLedger = {
  itemId: number;
  itemName: string;
  unit: string;
  batches: BatchLedgerRow[];
};

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (result as T[]);
}

/**
 * Lot-wise ledger for one item: for every purchase batch, how much was bought,
 * how much has been sold (and for how much / at what profit), and how much is
 * still pending. Revenue and profit are attributed to a batch by its quantity
 * share of each sale line it contributed to. Cancelled bills are excluded.
 */
export async function batchLedger(db: Db, itemId: number): Promise<BatchLedger> {
  const [item] = await db
    .select({ id: items.id, name: items.name, unit: items.unit })
    .from(items)
    .where(eq(items.id, itemId));
  if (!item) throw new Error("Item not found");

  const factor = baseFactor(item.unit as Unit);

  // Per-batch summary: purchase info + aggregated sold qty / cogs / revenue share.
  const summaryRows = rowsOf<{
    batch_id: number;
    purchase_id: number;
    purchase_date: string;
    supplier_name: string | null;
    qty_original: number;
    qty_remaining: number;
    unit_price_paise: number;
    expenses_paise: number;
    qty_sold: number;
    cogs_paise: number;
    sold_value_paise: number;
  }>(
    await db.execute(sql`
      select
        b.id as batch_id,
        b.purchase_id,
        b.purchase_date::text as purchase_date,
        s.name as supplier_name,
        b.qty_original,
        b.qty_remaining,
        b.unit_price_paise,
        coalesce(p.expenses_paise, 0) as expenses_paise,
        coalesce(sum(mbl.qty_taken), 0)::bigint as qty_sold,
        coalesce(sum(mbl.cost_paise), 0)::bigint as cogs_paise,
        coalesce(sum(round(si.line_total_paise * mbl.qty_taken::numeric / si.qty_base)), 0)::bigint as sold_value_paise
      from batches b
      left join purchases p on p.id = b.purchase_id
      left join suppliers s on s.id = p.supplier_id
      left join movement_batch_links mbl on mbl.batch_id = b.id
      left join stock_movements sm on sm.id = mbl.movement_id and sm.type = 'SALE'
      left join sale_items si on si.movement_id = sm.id
      left join sale_bills sb on sb.id = si.sale_id and not sb.cancelled
      where b.item_id = ${itemId} and (sb.id is not null or mbl.id is null)
      group by b.id, s.name, p.expenses_paise
      order by b.purchase_date, b.id
    `),
  );

  // Per-batch sale lines (only batches that actually sold).
  const saleRows = rowsOf<{
    batch_id: number;
    bill_no: string;
    sale_date: string;
    customer_name: string | null;
    qty_taken: number;
    unit_price_paise: number;
    line_total_paise: number;
    line_qty_base: number;
    cogs_paise: number;
  }>(
    await db.execute(sql`
      select
        mbl.batch_id,
        sb.bill_no,
        sb.sale_date::text as sale_date,
        c.name as customer_name,
        mbl.qty_taken,
        si.unit_price_paise,
        si.line_total_paise,
        si.qty_base as line_qty_base,
        mbl.cost_paise as cogs_paise
      from movement_batch_links mbl
      join stock_movements sm on sm.id = mbl.movement_id and sm.type = 'SALE'
      join sale_items si on si.movement_id = sm.id
      join sale_bills sb on sb.id = si.sale_id and not sb.cancelled
      left join customers c on c.id = sb.customer_id
      where mbl.batch_id in (
        select id from batches where item_id = ${itemId}
      )
      order by sb.sale_date, sb.id, mbl.batch_id
    `),
  );

  const salesByBatch = new Map<number, BatchLedgerSale[]>();
  for (const r of saleRows) {
    const revenueShare = Math.round(
      (r.line_total_paise * r.qty_taken) / r.line_qty_base,
    );
    const entry: BatchLedgerSale = {
      billNo: r.bill_no,
      saleDate: r.sale_date,
      customerName: r.customer_name,
      qtyTaken: r.qty_taken,
      unitPricePaise: r.unit_price_paise,
      revenuePaise: revenueShare,
      cogsPaise: r.cogs_paise,
      profitPaise: revenueShare - r.cogs_paise,
    };
    const list = salesByBatch.get(r.batch_id) ?? [];
    list.push(entry);
    salesByBatch.set(r.batch_id, list);
  }

  const batchesList: BatchLedgerRow[] = summaryRows.map((r) => {
    const soldValuePaise = Number(r.sold_value_paise);
    const cogsPaise = Number(r.cogs_paise);
    const pendingValuePaise = Math.round(
      (r.qty_remaining * r.unit_price_paise) / factor,
    );
    return {
      batchId: r.batch_id,
      purchaseId: r.purchase_id,
      purchaseDate: r.purchase_date,
      supplierName: r.supplier_name,
      qtyOriginal: r.qty_original,
      qtyRemaining: r.qty_remaining,
      unitPricePaise: r.unit_price_paise,
      expensesPaise: Number(r.expenses_paise),
      qtySold: Number(r.qty_sold),
      soldValuePaise,
      cogsPaise,
      profitPaise: soldValuePaise - cogsPaise,
      pendingValuePaise,
      sales: salesByBatch.get(r.batch_id) ?? [],
    };
  });

  return {
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    batches: batchesList,
  };
}
