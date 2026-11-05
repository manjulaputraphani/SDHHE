/**
 * Roasting: consume raw seeds, add roasted seeds with the raw cost + charge.
 *
 * The roasted output is stored as an internal purchase (source = 'roasting')
 * so it gets a normal batch and feeds the existing WAC/FIFO costing. Internal
 * purchases are excluded from the Purchases screen and purchase-spend stats.
 */
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { withTransaction, type Db, type TxDb } from "./client";
import {
  batches,
  items,
  movementBatchLinks,
  purchases,
  roastings,
  stockMovements,
} from "./schema";
import { allocateFifo } from "../logic/fifo";
import { baseFactor, formatQuantity, toBase, type Unit } from "../logic/units";
import { takeFromPool } from "../logic/weightedCost";
import { getCostingMethod, getCostPool, saveCostPool } from "./costing";
import {
  DEFAULT_YIELD_BP,
  MAX_YIELD_BP,
  MIN_YIELD_BP,
  planRoast,
} from "../logic/roasting";
import { getAuditActor, logActivity } from "./activity";

export const roastingInputSchema = z.object({
  rawItemId: z.number({ message: "Choose the raw item" }).int().positive("Choose the raw item"),
  roastedItemId: z.number({ message: "Choose the roasted item" }).int().positive("Choose the roasted item"),
  rawQty: z.number({ message: "Enter the raw quantity" }).positive("Enter the raw quantity"),
  yieldBp: z
    .number()
    .int("Yield must be a whole number")
    .min(MIN_YIELD_BP, "Yield must be at least 1.000")
    .max(MAX_YIELD_BP, "Yield is too high")
    .default(DEFAULT_YIELD_BP),
  chargePerKgPaise: z
    .number({ message: "Enter the roasting charge" })
    .int("Charge must be whole paise")
    .min(0, "Charge cannot be negative")
    .default(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
  marginBp: z.number().int().min(0, "Margin cannot be negative").max(10_000, "Margin cannot exceed 100%").default(0),
  note: z.string().trim().max(200, "Note is too long").optional(),
});

export type RoastingInput = z.infer<typeof roastingInputSchema>;

export function parseRoastingInput(input: unknown): RoastingInput {
  const result = roastingInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid roasting batch");
  }
  return result.data;
}

function requireWeightUnit(unit: string): Unit {
  if (unit !== "kg" && unit !== "60 kg bag") {
    throw new Error("Roasting needs a weight unit (kg or 60 kg bag)");
  }
  return unit as Unit;
}

/** Consume raw stock FIFO/WAC and record a ROASTING movement. */
async function consumeRaw(
  tx: TxDb,
  item: { id: number; unit: string },
  qtyBase: number,
  date: string,
  note: string,
): Promise<{ costPaise: number }> {
  const unit = requireWeightUnit(item.unit);
  const factor = baseFactor(unit);

  const open = await tx
    .select({
      id: batches.id,
      qtyRemaining: batches.qtyRemaining,
      unitPricePaise: batches.unitPricePaise,
      purchaseDate: batches.purchaseDate,
    })
    .from(batches)
    .where(and(eq(batches.itemId, item.id), gt(batches.qtyRemaining, 0)))
    .orderBy(asc(batches.purchaseDate), asc(batches.id))
    .for("update");

  const allocation = allocateFifo(open, qtyBase, factor);

  const costing = await getCostingMethod(tx);
  const poolBefore = costing === "WAC" ? await getCostPool(tx, item.id) : null;

  const taken = new Map(allocation.takes.map((take) => [take.batchId, take.qty]));
  for (const batch of open) {
    const remaining = batch.qtyRemaining - (taken.get(batch.id) ?? 0);
    if (remaining !== batch.qtyRemaining) {
      await tx.update(batches).set({ qtyRemaining: remaining }).where(eq(batches.id, batch.id));
    }
  }

  let costPaise = allocation.totalCostPaise;
  if (poolBefore && qtyBase > 0) {
    const take = takeFromPool(
      { qtyBase: poolBefore.qtyBase, valuePaise: poolBefore.valuePaise },
      qtyBase,
      factor,
    );
    costPaise = take.costPaise;
    await saveCostPool(tx, item.id, take.pool, unit);
  }

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      itemId: item.id,
      type: "ROASTING",
      qtyChange: -qtyBase,
      costPaise,
      movementDate: date,
      note,
      actor: getAuditActor().name,
      createdAt: new Date(),
    })
    .returning({ id: stockMovements.id });

  if (allocation.takes.length > 0) {
    await tx.insert(movementBatchLinks).values(
      allocation.takes.map((take) => ({
        movementId: movement.id,
        batchId: take.batchId,
        qtyTaken: take.qty,
        unitPricePaise: take.unitPricePaise,
        costPaise: take.costPaise,
      })),
    );
  }

  return { costPaise };
}

export type RoastingResult = {
  id: number;
  roastedPurchaseId: number | null;
  rawCostPaise: number;
  chargePaise: number;
  totalCostPaise: number;
  roastedQtyBase: number;
  costPerKgPaise: number;
  suggestedPricePaise: number;
};

/** Run one roasting batch: consume raw, add roasted stock, record the costs. */
export async function createRoasting(url: string, input: unknown): Promise<RoastingResult> {
  const data = parseRoastingInput(input);

  return withTransaction(url, async (tx) => {
    const [raw] = await tx
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(eq(items.id, data.rawItemId));
    const [roasted] = await tx
      .select({ id: items.id, name: items.name, unit: items.unit })
      .from(items)
      .where(eq(items.id, data.roastedItemId));

    if (!raw || !roasted) throw new Error("Item not found");
    if (raw.id === roasted.id) throw new Error("Raw and roasted items must be different");

    const rawUnit = requireWeightUnit(raw.unit);
    const roastedUnit = requireWeightUnit(roasted.unit);
    const rawQtyBase = toBase(data.rawQty, rawUnit);
    if (rawQtyBase <= 0) throw new Error("Raw quantity is too small");

    const summary = `Roasting: ${formatQuantity(rawQtyBase, rawUnit)} ${raw.name} → ${roasted.name}`;
    const rawResult = await consumeRaw(tx, raw, rawQtyBase, data.date, summary);

    const plan = planRoast({
      rawQtyBase,
      yieldBp: data.yieldBp,
      chargePerKgPaise: data.chargePerKgPaise,
      rawCostPaise: rawResult.costPaise,
      marginBp: data.marginBp,
    });

    const roastedFactor = baseFactor(roastedUnit);
    const unitCostPaise = Math.round((plan.totalCostPaise * roastedFactor) / plan.roastedQtyBase);

    // Internal purchase = the roasted batch, so existing stock/sale costing works.
    const [purchase] = await tx
      .insert(purchases)
      .values({
        itemId: roasted.id,
        supplierId: null,
        qtyBase: plan.roastedQtyBase,
        unitPricePaise: unitCostPaise,
        totalPaise: plan.totalCostPaise,
        expensesPaise: 0,
        purchaseDate: data.date,
        paymentMode: null,
        source: "roasting",
        note: `${summary} (yield ${(data.yieldBp / 10_000).toFixed(3)}, charge ₹${(plan.chargePaise / 100).toFixed(2)})`,
      })
      .returning({ id: purchases.id });

    await tx.insert(batches).values({
      purchaseId: purchase.id,
      itemId: roasted.id,
      qtyOriginal: plan.roastedQtyBase,
      qtyRemaining: plan.roastedQtyBase,
      unitPricePaise: unitCostPaise,
      purchaseDate: data.date,
    });

    await tx.insert(stockMovements).values({
      itemId: roasted.id,
      type: "PURCHASE",
      qtyChange: plan.roastedQtyBase,
      costPaise: plan.totalCostPaise,
      movementDate: data.date,
      note: `Roasting output: ${summary}`,
      actor: getAuditActor().name,
      createdAt: new Date(),
    });

    // The new batch is included in qtyBase; the value pool still holds the old value.
    const poolAfter = await getCostPool(tx, roasted.id);
    await saveCostPool(
      tx,
      roasted.id,
      { qtyBase: poolAfter.qtyBase, valuePaise: poolAfter.valuePaise + plan.totalCostPaise },
      roastedUnit,
    );

    const [created] = await tx
      .insert(roastings)
      .values({
        rawItemId: raw.id,
        roastedItemId: roasted.id,
        roastedPurchaseId: purchase.id,
        roastDate: data.date,
        rawQtyBase,
        roastedQtyBase: plan.roastedQtyBase,
        yieldBp: data.yieldBp,
        chargePerKgPaise: data.chargePerKgPaise,
        chargePaise: plan.chargePaise,
        rawCostPaise: rawResult.costPaise,
        totalCostPaise: plan.totalCostPaise,
        marginBp: data.marginBp,
        suggestedPricePaise: plan.suggestedPricePaise,
        note: data.note?.trim() || null,
        actor: getAuditActor().name,
      })
      .returning({ id: roastings.id });

    await logActivity(tx, {
      event: "roasting.create",
      summary: `${summary} — cost ₹${(plan.totalCostPaise / 100).toFixed(2)}, ₹${(plan.costPerKgPaise / 100).toFixed(2)}/kg`,
      entity: "roasting",
      entityId: created.id,
    });

    return {
      id: created.id,
      roastedPurchaseId: purchase.id,
      rawCostPaise: rawResult.costPaise,
      chargePaise: plan.chargePaise,
      totalCostPaise: plan.totalCostPaise,
      roastedQtyBase: plan.roastedQtyBase,
      costPerKgPaise: plan.costPerKgPaise,
      suggestedPricePaise: plan.suggestedPricePaise,
    };
  });
}

export type RoastingRow = {
  id: number;
  roastDate: string;
  rawItemId: number;
  rawItemName: string;
  rawUnit: string;
  roastedItemId: number;
  roastedItemName: string;
  roastedUnit: string;
  rawQtyBase: number;
  roastedQtyBase: number;
  yieldBp: number;
  chargePerKgPaise: number;
  chargePaise: number;
  rawCostPaise: number;
  totalCostPaise: number;
  costPerKgPaise: number;
  marginBp: number;
  suggestedPricePaise: number;
  note: string | null;
};

/** Latest roasting batches, newest first. */
export async function listRoastings(db: Db, limit = 50): Promise<RoastingRow[]> {
  const rawItems = alias(items, "raw_items");
  const roastedItems = alias(items, "roasted_items");

  const rows = await db
    .select({
      id: roastings.id,
      roastDate: roastings.roastDate,
      rawItemId: roastings.rawItemId,
      rawItemName: rawItems.name,
      rawUnit: rawItems.unit,
      roastedItemId: roastings.roastedItemId,
      roastedItemName: roastedItems.name,
      roastedUnit: roastedItems.unit,
      rawQtyBase: roastings.rawQtyBase,
      roastedQtyBase: roastings.roastedQtyBase,
      yieldBp: roastings.yieldBp,
      chargePerKgPaise: roastings.chargePerKgPaise,
      chargePaise: roastings.chargePaise,
      rawCostPaise: roastings.rawCostPaise,
      totalCostPaise: roastings.totalCostPaise,
      marginBp: roastings.marginBp,
      suggestedPricePaise: roastings.suggestedPricePaise,
      note: roastings.note,
    })
    .from(roastings)
    .innerJoin(rawItems, eq(rawItems.id, roastings.rawItemId))
    .innerJoin(roastedItems, eq(roastedItems.id, roastings.roastedItemId))
    .orderBy(desc(roastings.roastDate), desc(roastings.id))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    costPerKgPaise: Math.round((row.totalCostPaise * 1000) / row.roastedQtyBase),
  }));
}
