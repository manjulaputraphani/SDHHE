/**
 * Green Coffee Pricing Calculator persistence.
 *
 * The calculator itself is pure (src/logic/pricing.ts); this file only
 * stores the inputs + the results derived from them and reads them back.
 */
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import { batches, items, pricingCalculations } from "./schema";
import {
  calculatePricing,
  validatePricingInputs,
  type PricingInputs,
  type PricingResult,
} from "../logic/pricing";

export type PricingCalculation = {
  id: number;
  grade: string;
  note: string | null;
  inputs: PricingInputs;
  results: PricingResult;
  createdBy: number | null;
  createdByName: string;
  createdAt: string;
};

type Row = {
  id: number;
  grade: string;
  note: string | null;
  inputs: unknown;
  results: unknown;
  createdBy: number | null;
  createdByName: string;
  createdAt: Date | string;
};

function mapRow(row: Row): PricingCalculation {
  return {
    id: row.id,
    grade: row.grade,
    note: row.note,
    inputs: row.inputs as PricingInputs,
    results: row.results as PricingResult,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export type SavePricingCalculationInput = {
  grade: string;
  note?: string | null;
  inputs: PricingInputs;
  userId: number | null;
  userName: string;
};

/** Validate, calculate the results on the server, then store one quote. */
export async function savePricingCalculation(
  db: Db,
  entry: SavePricingCalculationInput,
): Promise<PricingCalculation> {
  const grade = entry.grade.trim();
  if (!grade) throw new Error("Choose a coffee grade");
  if (grade.length > 80) throw new Error("Coffee grade is too long");

  const note = entry.note?.trim() || null;
  if (note && note.length > 500) throw new Error("Note is too long");

  const errors = validatePricingInputs(entry.inputs);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);

  const results = calculatePricing(entry.inputs);
  const [row] = await db
    .insert(pricingCalculations)
    .values({
      grade,
      note,
      inputs: entry.inputs,
      results,
      createdBy: entry.userId,
      createdByName: entry.userName,
    })
    .returning();

  return mapRow(row as Row);
}

export type PricingHistoryFilter = {
  grade?: string;
  /** YYYY-MM-DD (inclusive). */
  from?: string;
  /** YYYY-MM-DD (inclusive). */
  to?: string;
  limit?: number;
};

export async function listPricingCalculations(
  db: Db,
  filter: PricingHistoryFilter = {},
): Promise<PricingCalculation[]> {
  const conditions = [];
  const grade = filter.grade?.trim();
  if (grade) {
    conditions.push(sql`lower(${pricingCalculations.grade}) like ${`%${grade.toLowerCase()}%`}`);
  }
  if (filter.from) {
    conditions.push(
      sql`(${pricingCalculations.createdAt} at time zone 'Asia/Kolkata')::date >= ${filter.from}::date`,
    );
  }
  if (filter.to) {
    conditions.push(
      sql`(${pricingCalculations.createdAt} at time zone 'Asia/Kolkata')::date <= ${filter.to}::date`,
    );
  }

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
  const rows = await db
    .select()
    .from(pricingCalculations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(pricingCalculations.createdAt), desc(pricingCalculations.id))
    .limit(limit);

  return (rows as Row[]).map(mapRow);
}

/** Admin-only delete. The worker checks the owner role before calling this. */
export async function deletePricingCalculation(db: Db, id: number): Promise<boolean> {
  const deleted = await db
    .delete(pricingCalculations)
    .where(eq(pricingCalculations.id, id))
    .returning({ id: pricingCalculations.id });
  return deleted.length > 0;
}

export type LatestStockPrice = {
  itemName: string;
  /** Rupees per kg. */
  pricePerKg: number;
  purchaseDate: string;
};

/**
 * The newest stock batch whose item name or category matches the grade.
 * Returns null when our stock has no such coffee — the UI then says so.
 */
export async function latestPurchasePriceForGrade(
  db: Db,
  grade: string,
): Promise<LatestStockPrice | null> {
  const needle = grade.trim().toLowerCase();
  if (!needle) return null;

  const [match] = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(
      and(
        or(eq(items.unit, "kg"), eq(items.unit, "60 kg bag")),
        or(
          sql`lower(${items.name}) = ${needle}`,
          sql`lower(coalesce(${items.category}, '')) = ${needle}`,
          sql`lower(${items.name}) like ${`%${needle}%`}`,
          sql`lower(coalesce(${items.category}, '')) like ${`%${needle}%`}`,
        ),
      ),
    )
    .orderBy(
      sql`case
        when lower(${items.name}) = ${needle} then 0
        when lower(coalesce(${items.category}, '')) = ${needle} then 1
        else 2
      end`,
      desc(items.id),
    )
    .limit(1);

  if (!match) return null;

  const selectBatch = () =>
    db
      .select({
        unitPricePaise: batches.unitPricePaise,
        purchaseDate: batches.purchaseDate,
      })
      .from(batches)
      .where(eq(batches.itemId, match.id))
      .orderBy(desc(batches.purchaseDate), desc(batches.id))
      .limit(1);

  let [batch] = await db
    .select({
      unitPricePaise: batches.unitPricePaise,
      purchaseDate: batches.purchaseDate,
    })
    .from(batches)
    .where(and(eq(batches.itemId, match.id), gt(batches.qtyRemaining, 0)))
    .orderBy(desc(batches.purchaseDate), desc(batches.id))
    .limit(1);

  // Nothing on hand? Fall back to the latest batch ever received for it.
  if (!batch) [batch] = await selectBatch();
  if (!batch) return null;

  return {
    itemName: match.name,
    pricePerKg: Math.round((batch.unitPricePaise / 100) * 100) / 100,
    purchaseDate: batch.purchaseDate,
  };
}
