import { asc, desc, eq, gte, inArray, lte, and, sql } from "drizzle-orm";
import { z } from "zod";
import { withTransaction, type Db, type TxDb } from "./client";
import { batches, items, movementBatchLinks, purchases, stockMovements, suppliers } from "./schema";
import { baseFactor, costPaise, formatQuantity, formatRupees, toBase, type Unit } from "../logic/units";
import { replayItem, type ReplayMovement } from "../logic/replay";
import { logActivity } from "./activity";
import { rebuildItemPool } from "./costing";

export const PAYMENT_MODES = ["Cash", "UPI", "Card", "Credit"] as const;

export const purchaseInputSchema = z.object({
  itemId: z.number({ message: "Choose an item" }).int().positive("Choose an item"),
  supplierName: z.string().trim().max(80, "Supplier name is too long").optional(),
  qty: z
    .number({ message: "Quantity is required" })
    .positive("Quantity must be more than 0"),
  unitPricePaise: z
    .number({ message: "Price is required" })
    .int("Price must be whole paise")
    .min(0, "Price cannot be negative"),
  /** Transport / loading / commission — added into the stock cost. */
  expensesPaise: z.number().int("Expenses must be whole paise").min(0, "Expenses cannot be negative").optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  note: z.string().trim().max(200, "Note is too long").optional(),
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export function parsePurchaseInput(input: unknown): PurchaseInput {
  const result = purchaseInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid purchase");
  }
  return result.data;
}

export type AddPurchaseResult = {
  purchaseId: number;
  batchId: number;
  movementId: number;
  qtyBase: number;
  totalPaise: number;
};

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (result as T[]);
}

/**
 * Insert purchase + batch + PURCHASE movement as ONE statement (CTEs), so the
 * three rows exist together or not at all. Supplier is found by name or created.
 */
export async function addPurchase(db: Db | TxDb, input: unknown): Promise<AddPurchaseResult> {
  const data = parsePurchaseInput(input);

  const [item] = await db
    .select({ id: items.id, unit: items.unit })
    .from(items)
    .where(eq(items.id, data.itemId));
  if (!item) throw new Error("Item not found");

  const unit = item.unit as Unit;
  const qtyBase = toBase(data.qty, unit);
  if (qtyBase <= 0) throw new Error("Quantity is too small");
  const totalPaise = costPaise(qtyBase, data.unitPricePaise, unit);

  const supplier = data.supplierName?.trim() || null;
  const note = data.note?.trim() || null;
  const paymentMode = data.paymentMode ?? null;
  const expensesPaise = data.expensesPaise ?? 0;
  const factor = baseFactor(unit);

  // One statement: supplier → purchase → batch → movement → cost pool.
  // The pool keeps the weighted-average value of the stock (purchase expenses included).
  const result = await db.execute(sql`
    WITH new_supplier AS (
      INSERT INTO suppliers (name)
      SELECT ${supplier}::text
      WHERE ${supplier}::text IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM suppliers WHERE lower(name) = lower(${supplier}::text))
      RETURNING id
    ),
    supplier_id AS (
      SELECT id FROM new_supplier
      UNION ALL
      SELECT id FROM suppliers WHERE lower(name) = lower(${supplier}::text)
      LIMIT 1
    ),
    p AS (
      INSERT INTO purchases
        (item_id, supplier_id, qty_base, unit_price_paise, total_paise, expenses_paise, purchase_date, payment_mode, note)
      SELECT
        ${data.itemId}::int, (SELECT id FROM supplier_id), ${qtyBase}::int,
        ${data.unitPricePaise}::int, ${totalPaise}::int, ${expensesPaise}::int, ${data.date}::date,
        ${paymentMode}::text, ${note}::text
      RETURNING id, item_id, qty_base, unit_price_paise, total_paise, purchase_date
    ),
    b AS (
      INSERT INTO batches
        (purchase_id, item_id, qty_original, qty_remaining, unit_price_paise, purchase_date)
      SELECT id, item_id, qty_base, qty_base, unit_price_paise, purchase_date FROM p
      RETURNING id, qty_remaining
    ),
    m AS (
      INSERT INTO stock_movements
        (item_id, type, qty_change, cost_paise, movement_date, note)
      SELECT item_id, 'PURCHASE', qty_base, total_paise + ${expensesPaise}::int, purchase_date, ${note}::text FROM p
      RETURNING id
    ),
    stock_qty AS (
      SELECT coalesce(sum(all_b.qty_remaining), 0)::int AS qty
      FROM (
        SELECT nb.qty_remaining FROM b nb
        UNION ALL
        SELECT ob.qty_remaining FROM batches ob
        WHERE ob.item_id = (SELECT item_id FROM p) AND ob.qty_remaining > 0
      ) all_b
    ),
    i AS (
      UPDATE items it
      SET stock_value_paise = it.stock_value_paise + p.total_paise + ${expensesPaise}::int,
          avg_cost_paise = CASE
            WHEN (SELECT qty FROM stock_qty) > 0
            THEN round((((it.stock_value_paise + p.total_paise + ${expensesPaise}::int)::numeric) * ${factor}::int) / (SELECT qty FROM stock_qty))::int
            ELSE 0
          END
      FROM p
      WHERE it.id = p.item_id
      RETURNING it.id
    )
    SELECT p.id AS purchase_id, b.id AS batch_id, m.id AS movement_id
    FROM p, b, m, i
  `);

  const row = rowsOf<{ purchase_id: number; batch_id: number; movement_id: number }>(result)[0];
  if (!row) throw new Error("Purchase was not saved");

  await logActivity(db, {
    event: "purchase.create",
    summary: `Purchase: ${formatQuantity(qtyBase, unit)} for ${formatRupees(totalPaise)}${
      supplier ? ` from ${supplier}` : ""
    }`,
    entity: "purchase",
    entityId: Number(row.purchase_id),
  });

  return {
    purchaseId: Number(row.purchase_id),
    batchId: Number(row.batch_id),
    movementId: Number(row.movement_id),
    qtyBase,
    totalPaise,
  };
}

/** Most recent purchase for an item — used to prefill the price field. */
export async function getLastPurchase(
  db: Db,
  itemId: number,
): Promise<{ unitPricePaise: number; date: string } | null> {
  const rows = await db
    .select({ unitPricePaise: purchases.unitPricePaise, date: purchases.purchaseDate })
    .from(purchases)
    .where(eq(purchases.itemId, itemId))
    .orderBy(desc(purchases.purchaseDate), desc(purchases.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Supplier names for the autocomplete list. */
export async function listSuppliers(db: Db): Promise<string[]> {
  const rows = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .orderBy(asc(suppliers.name));
  return rows.map((r) => r.name);
}

export type PurchaseListRow = {
  id: number;
  date: string;
  itemId: number;
  itemName: string;
  unit: string;
  qtyBase: number;
  unitPricePaise: number;
  totalPaise: number;
  paidPaise: number;
  supplier: string | null;
  paymentMode: string | null;
  note: string | null;
  qtyRemaining: number;
};

/** Purchases, newest first, optionally filtered by item and date range. */
export async function listPurchases(
  db: Db,
  filter: { itemId?: number; from?: string; to?: string } = {},
): Promise<PurchaseListRow[]> {
  const conditions = [
    filter.itemId ? eq(purchases.itemId, filter.itemId) : undefined,
    filter.from ? gte(purchases.purchaseDate, filter.from) : undefined,
    filter.to ? lte(purchases.purchaseDate, filter.to) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: purchases.id,
      date: purchases.purchaseDate,
      itemId: purchases.itemId,
      itemName: items.name,
      unit: items.unit,
      qtyBase: purchases.qtyBase,
      unitPricePaise: purchases.unitPricePaise,
      totalPaise: purchases.totalPaise,
      paidPaise: purchases.paidPaise,
      supplier: suppliers.name,
      paymentMode: purchases.paymentMode,
      note: purchases.note,
      qtyRemaining: batches.qtyRemaining,
    })
    .from(purchases)
    .innerJoin(items, eq(items.id, purchases.itemId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .leftJoin(batches, eq(batches.purchaseId, purchases.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchases.purchaseDate), desc(purchases.id));

  return rows.map((r) => ({ ...r, qtyRemaining: r.qtyRemaining ?? 0 }));
}

// ---------------------------------------------------------------------------
// Edit / delete a purchase, then replay every later movement of that item
// (docs/BLUEPRINT.md §6). All inside ONE transaction.
// ---------------------------------------------------------------------------

export const purchaseEditSchema = z.object({
  qty: z.number({ message: "Quantity is required" }).positive("Quantity must be more than 0"),
  unitPricePaise: z
    .number({ message: "Price is required" })
    .int("Price must be whole paise")
    .min(0, "Price cannot be negative"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
  supplierName: z.string().trim().max(80, "Supplier name is too long").optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  note: z.string().trim().max(200, "Note is too long").optional(),
});

export type PurchaseEditInput = z.infer<typeof purchaseEditSchema>;

export function parsePurchaseEdit(input: unknown): PurchaseEditInput {
  const result = purchaseEditSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid purchase");
  }
  return result.data;
}

async function findOrCreateSupplier(
  tx: TxDb,
  name: string | null,
): Promise<number | null> {
  if (!name) return null;
  const [existing] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(sql`lower(${suppliers.name}) = lower(${name})`)
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(suppliers).values({ name }).returning({ id: suppliers.id });
  return created.id;
}

/** Replay the item and write back batch leftovers, movement costs and links. */
async function replayAndWriteBack(
  tx: TxDb,
  itemId: number,
  factor: number,
): Promise<void> {
  const batchRows = await tx
    .select({
      id: batches.id,
      qtyOriginal: batches.qtyOriginal,
      unitPricePaise: batches.unitPricePaise,
      purchaseDate: batches.purchaseDate,
    })
    .from(batches)
    .where(eq(batches.itemId, itemId))
    .orderBy(asc(batches.purchaseDate), asc(batches.id))
    .for("update");

  const movementRows = await tx
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      movementDate: stockMovements.movementDate,
      qtyChange: stockMovements.qtyChange,
      enteredQtyLeft: stockMovements.enteredQtyLeft,
    })
    .from(stockMovements)
    .where(eq(stockMovements.itemId, itemId))
    .orderBy(asc(stockMovements.movementDate), asc(stockMovements.id));

  const result = replayItem(
    batchRows,
    movementRows.map((m) => ({ ...m, type: m.type as ReplayMovement["type"] })),
    factor,
  );

  for (const row of result.batches) {
    await tx.update(batches).set({ qtyRemaining: row.qtyRemaining }).where(eq(batches.id, row.id));
  }

  for (const movement of result.movements) {
    await tx
      .update(stockMovements)
      .set({ qtyChange: movement.qtyChange, costPaise: movement.costPaise })
      .where(eq(stockMovements.id, movement.id));
  }

  const replayedIds = result.movements.map((m) => m.id);
  if (replayedIds.length > 0) {
    await tx.delete(movementBatchLinks).where(inArray(movementBatchLinks.movementId, replayedIds));
    if (result.links.length > 0) {
      await tx.insert(movementBatchLinks).values(result.links);
    }
  }
}

/** Change a purchase (and its batch), then replay later movements. */
export async function updatePurchase(
  url: string,
  purchaseId: number,
  input: unknown,
): Promise<void> {
  const data = parsePurchaseEdit(input);

  await withTransaction(url, async (tx) => {
    const [row] = await tx
      .select({
        id: purchases.id,
        itemId: purchases.itemId,
        qtyBase: purchases.qtyBase,
        purchaseDate: purchases.purchaseDate,
        unit: items.unit,
      })
      .from(purchases)
      .innerJoin(items, eq(items.id, purchases.itemId))
      .where(eq(purchases.id, purchaseId))
      .for("update");

    if (!row) throw new Error("Purchase not found");

    const unit = row.unit as Unit;
    const factor = baseFactor(unit);
    const qtyBase = toBase(data.qty, unit);
    const totalPaise = costPaise(qtyBase, data.unitPricePaise, unit);
    const supplierId = await findOrCreateSupplier(tx, data.supplierName?.trim() || null);

    await tx
      .update(purchases)
      .set({
        qtyBase,
        unitPricePaise: data.unitPricePaise,
        totalPaise,
        purchaseDate: data.date,
        supplierId,
        paymentMode: data.paymentMode ?? null,
        note: data.note?.trim() || null,
      })
      .where(eq(purchases.id, purchaseId));

    await tx
      .update(batches)
      .set({
        qtyOriginal: qtyBase,
        unitPricePaise: data.unitPricePaise,
        purchaseDate: data.date,
      })
      .where(eq(batches.purchaseId, purchaseId));

    // Keep the PURCHASE movement in step with the purchase it mirrors.
    const [purchaseMovement] = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.itemId, row.itemId),
          eq(stockMovements.type, "PURCHASE"),
          eq(stockMovements.movementDate, row.purchaseDate),
          eq(stockMovements.qtyChange, row.qtyBase),
        ),
      )
      .limit(1);

    if (purchaseMovement) {
      await tx
        .update(stockMovements)
        .set({ qtyChange: qtyBase, costPaise: totalPaise, movementDate: data.date })
        .where(eq(stockMovements.id, purchaseMovement.id));
    }

    await replayAndWriteBack(tx, row.itemId, factor);
    // Keep the weighted-average pool in step with the new batches.
    await rebuildItemPool(tx, row.itemId);

    await logActivity(tx, {
      event: "purchase.update",
      summary: `Purchase edited: ${formatQuantity(qtyBase, unit)} for ${formatRupees(totalPaise)}`,
      entity: "purchase",
      entityId: purchaseId,
    });
  });
}

/** Delete a purchase, its batch and its PURCHASE movement, then replay. */
export async function deletePurchase(url: string, purchaseId: number): Promise<void> {
  await withTransaction(url, async (tx) => {
    const [row] = await tx
      .select({
        id: purchases.id,
        itemId: purchases.itemId,
        qtyBase: purchases.qtyBase,
        purchaseDate: purchases.purchaseDate,
      })
      .from(purchases)
      .where(eq(purchases.id, purchaseId));

    if (!row) throw new Error("Purchase not found");

    const [item] = await tx
      .select({ unit: items.unit })
      .from(items)
      .where(eq(items.id, row.itemId));
    const factor = baseFactor(item.unit as Unit);

    const movementIds = (
      await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(eq(stockMovements.itemId, row.itemId))
    ).map((m) => m.id);

    if (movementIds.length > 0) {
      await tx
        .delete(movementBatchLinks)
        .where(inArray(movementBatchLinks.movementId, movementIds));
    }

    await tx.delete(batches).where(eq(batches.purchaseId, purchaseId));
    await tx.delete(purchases).where(eq(purchases.id, purchaseId));
    await tx.delete(stockMovements).where(
      and(
        eq(stockMovements.itemId, row.itemId),
        eq(stockMovements.type, "PURCHASE"),
        eq(stockMovements.movementDate, row.purchaseDate),
        eq(stockMovements.qtyChange, row.qtyBase),
      ),
    );

    await replayAndWriteBack(tx, row.itemId, factor);
    // Keep the weighted-average pool in step with the remaining batches.
    await rebuildItemPool(tx, row.itemId);

    await logActivity(tx, {
      event: "purchase.delete",
      summary: `Purchase deleted: #${purchaseId} (${formatQuantity(row.qtyBase, item.unit as Unit)})`,
      entity: "purchase",
      entityId: purchaseId,
    });
  });
}
