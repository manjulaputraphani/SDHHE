import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { batches, expenses, items, purchases, stockMovements, suppliers } from "./schema";
import { monthRange } from "./expenses";

export type LowStockRow = {
  id: number;
  name: string;
  unit: string;
  stockLeftBase: number;
  minStockBase: number;
};

export type RecentPurchase = {
  id: number;
  date: string;
  itemName: string;
  unit: string;
  qtyBase: number;
  totalPaise: number;
  supplier: string | null;
};

export type RecentCheck = {
  id: number;
  date: string;
  itemName: string;
  unit: string;
  type: string;
  qtyChange: number;
  costPaise: number;
};

export type PriceAlert = {
  itemId: number;
  itemName: string;
  unit: string;
  previousPaise: number;
  latestPaise: number;
};

export type DashboardData = {
  month: string;
  purchasesPaise: number;
  expensesPaise: number;
  totalSpentPaise: number;
  usedCostPaise: number;
  wastagePaise: number;
  stockValuePaise: number;
  itemCount: number;
  lowStock: LowStockRow[];
  lastPurchases: RecentPurchase[];
  lastChecks: RecentCheck[];
  priceAlerts: PriceAlert[];
};

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (result as T[]);
}

/** Everything the dashboard shows for one month. All money sums happen in SQL. */
export async function getDashboard(db: Db, month: string): Promise<DashboardData> {
  const { start, end } = monthRange(month);

  const [purchasesRow] = await db
    .select({ total: sql<number>`coalesce(sum(${purchases.totalPaise}), 0)`.mapWith(Number) })
    .from(purchases)
    .where(and(gte(purchases.purchaseDate, start), lt(purchases.purchaseDate, end)));

  const [expensesRow] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountPaise}), 0)`.mapWith(Number) })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, start), lt(expenses.expenseDate, end)));

  const [usedRow] = await db
    .select({ total: sql<number>`coalesce(sum(${stockMovements.costPaise}), 0)`.mapWith(Number) })
    .from(stockMovements)
    .where(
      and(
        sql`${stockMovements.type} in ('STOCK_CHECK', 'USAGE')`,
        gte(stockMovements.movementDate, start),
        lt(stockMovements.movementDate, end),
      ),
    );

  const [wastageRow] = await db
    .select({ total: sql<number>`coalesce(sum(${stockMovements.costPaise}), 0)`.mapWith(Number) })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.type, "WASTAGE"),
        gte(stockMovements.movementDate, start),
        lt(stockMovements.movementDate, end),
      ),
    );

  // Stock value: remaining qty × price ÷ factor (1000 for kg/l, 1 for pcs).
  const [valueRow] = await db
    .select({
      total: sql<number>`coalesce(round(sum(
        ${batches.qtyRemaining} * ${batches.unitPricePaise}::numeric /
        case when ${items.unit} = '60 kg bag' then 60000 when ${items.unit} in ('kg', 'l') then 1000 else 1 end
      )), 0)`.mapWith(Number),
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId));

  const [countRow] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(items);

  const lowStock = await db
    .select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      stockLeftBase: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)`.mapWith(Number),
      minStockBase: items.minStockBase,
    })
    .from(items)
    .leftJoin(batches, eq(batches.itemId, items.id))
    .groupBy(items.id)
    .having(sql`coalesce(sum(${batches.qtyRemaining}), 0) <= ${items.minStockBase}`)
    .orderBy(items.name);

  const lastPurchases = await db
    .select({
      id: purchases.id,
      date: purchases.purchaseDate,
      itemName: items.name,
      unit: items.unit,
      qtyBase: purchases.qtyBase,
      totalPaise: purchases.totalPaise,
      supplier: suppliers.name,
    })
    .from(purchases)
    .innerJoin(items, eq(items.id, purchases.itemId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.id))
    .limit(5);

  const lastChecks = await db
    .select({
      id: stockMovements.id,
      date: stockMovements.movementDate,
      itemName: items.name,
      unit: items.unit,
      type: stockMovements.type,
      qtyChange: stockMovements.qtyChange,
      costPaise: stockMovements.costPaise,
    })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .where(sql`${stockMovements.type} in ('STOCK_CHECK', 'USAGE', 'WASTAGE')`)
    .orderBy(desc(stockMovements.movementDate), desc(stockMovements.id))
    .limit(5);

  const alertRows = rowsOf<{
    item_id: number;
    item_name: string;
    unit: string;
    latest_paise: number;
    previous_paise: number;
  }>(
    await db.execute(sql`
      with ranked as (
        select item_id, unit_price_paise,
               row_number() over (
                 partition by item_id order by purchase_date desc, id desc
               ) as rn
        from purchases
      )
      select r.item_id, i.name as item_name, i.unit,
             r.unit_price_paise as latest_paise,
             prev.unit_price_paise as previous_paise
      from ranked r
      join items i on i.id = r.item_id
      join ranked prev on prev.item_id = r.item_id and prev.rn = 2
      where r.rn = 1
        and prev.unit_price_paise > 0
        and r.unit_price_paise > prev.unit_price_paise * 1.1
      order by i.name
    `),
  );

  const purchasesPaise = purchasesRow?.total ?? 0;
  const expensesPaise = expensesRow?.total ?? 0;

  return {
    month,
    purchasesPaise,
    expensesPaise,
    totalSpentPaise: purchasesPaise + expensesPaise,
    usedCostPaise: usedRow?.total ?? 0,
    wastagePaise: wastageRow?.total ?? 0,
    stockValuePaise: valueRow?.total ?? 0,
    itemCount: countRow?.total ?? 0,
    lowStock,
    lastPurchases,
    lastChecks,
    priceAlerts: alertRows.map((row) => ({
      itemId: Number(row.item_id),
      itemName: row.item_name,
      unit: row.unit,
      previousPaise: Number(row.previous_paise),
      latestPaise: Number(row.latest_paise),
    })),
  };
}
