import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, TxDb } from "./client";
import { batches, items, purchases, saleItems } from "./schema";
import { logActivity } from "./activity";

export const ITEM_UNITS = ["kg", "60 kg bag"] as const;

export const itemInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  unit: z.enum(ITEM_UNITS, { message: "Unit must be kg or 60 kg bag" }),
  category: z.string().trim().max(60, "Category is too long").optional(),
  /** GST HSN code (optional; digits, 4–8 characters in practice). */
  hsnCode: z.string().trim().max(20, "HSN is too long").optional(),
  minStockBase: z
    .number({ message: "Min stock must be a number" })
    .int("Min stock must be a whole number")
    .min(0, "Min stock cannot be negative"),
  /** Optional picture: an R2 public URL or any http(s) image URL. */
  imageUrl: z
    .string()
    .trim()
    .max(500, "Image link is too long")
    .refine((value) => value === "" || /^https?:\/\//i.test(value), "Image link must start with http:// or https://")
    .optional(),
});

export type ItemInput = z.infer<typeof itemInputSchema>;

export type ItemRow = {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  hsnCode: string | null;
  minStockBase: number;
  imageUrl: string | null;
  stockLeftBase: number;
};

/** Validate + normalise; throws a plain Error with a user-facing message. */
export function parseItemInput(input: unknown): ItemInput {
  const result = itemInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid item");
  }
  return result.data;
}

async function assertUniqueName(db: Db | TxDb, name: string, excludeId?: number) {
  const clash = await db
    .select({ id: items.id })
    .from(items)
    .where(sql`lower(${items.name}) = lower(${name})`);
  if (clash.some((row) => row.id !== excludeId)) {
    throw new Error("An item with this name already exists");
  }
}

/** Every item with its current stock (sum of remaining batch quantities). */
export async function listItems(db: Db): Promise<ItemRow[]> {
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      category: items.category,
      hsnCode: items.hsnCode,
      minStockBase: items.minStockBase,
      imageUrl: items.imageUrl,
      stockLeftBase: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)`.mapWith(Number),
    })
    .from(items)
    .leftJoin(batches, eq(batches.itemId, items.id))
    .groupBy(items.id)
    .orderBy(asc(items.name));
  return rows;
}

export async function getItem(db: Db, id: number): Promise<ItemRow | null> {
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      unit: items.unit,
      category: items.category,
      hsnCode: items.hsnCode,
      minStockBase: items.minStockBase,
      imageUrl: items.imageUrl,
      stockLeftBase: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)`.mapWith(Number),
    })
    .from(items)
    .leftJoin(batches, eq(batches.itemId, items.id))
    .where(eq(items.id, id))
    .groupBy(items.id);
  return rows[0] ?? null;
}

export async function createItem(db: Db | TxDb, input: unknown): Promise<ItemRow> {
  const data = parseItemInput(input);
  await assertUniqueName(db, data.name);
  const [created] = await db
    .insert(items)
    .values({
      name: data.name,
      unit: data.unit,
      category: data.category || null,
      hsnCode: data.hsnCode?.trim() || null,
      minStockBase: data.minStockBase,
      imageUrl: data.imageUrl?.trim() || null,
    })
    .returning();
  await logActivity(db, {
    event: "item.create",
    summary: `Item created: ${data.name} (${data.unit})`,
    entity: "item",
    entityId: created.id,
  });
  return { ...created, stockLeftBase: 0 };
}

export async function updateItem(db: Db, id: number, input: unknown): Promise<ItemRow> {
  const data = parseItemInput(input);
  await assertUniqueName(db, data.name, id);
  const [updated] = await db
    .update(items)
    .set({
      name: data.name,
      unit: data.unit,
      category: data.category || null,
      hsnCode: data.hsnCode?.trim() || null,
      minStockBase: data.minStockBase,
      imageUrl: data.imageUrl?.trim() || null,
    })
    .where(eq(items.id, id))
    .returning();
  if (!updated) throw new Error("Item not found");
  await logActivity(db, {
    event: "item.update",
    summary: `Item edited: ${data.name}`,
    entity: "item",
    entityId: id,
  });
  return { ...updated, stockLeftBase: await getStockLeft(db, id) };
}

export async function deleteItem(db: Db | TxDb, id: number): Promise<void> {
  const used = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.itemId, id))
    .limit(1);
  if (used.length > 0) throw new Error("Item has purchases");
  const sold = await db
    .select({ id: saleItems.id })
    .from(saleItems)
    .where(eq(saleItems.itemId, id))
    .limit(1);
  if (sold.length > 0) throw new Error("Item is used in a bill — it cannot be deleted");
  await db.delete(items).where(eq(items.id, id));
  await logActivity(db, {
    event: "item.delete",
    summary: `Item deleted: #${id}`,
    entity: "item",
    entityId: id,
  });
}

/** Stock left = sum of remaining batches for the item. */
export async function getStockLeft(db: Db, itemId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)`.mapWith(Number) })
    .from(batches)
    .where(eq(batches.itemId, itemId));
  return row?.total ?? 0;
}
