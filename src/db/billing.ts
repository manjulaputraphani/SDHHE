import { and, asc, desc, eq, gt, like } from "drizzle-orm";
import { z } from "zod";
import { withTransaction, type Db, type TxDb } from "./client";
import {
  batches,
  customers,
  items,
  movementBatchLinks,
  saleBills,
  saleItems,
  stockMovements,
} from "./schema";
import { logActivity } from "./activity";
import {
  customerSchema as customerMasterSchema,
  saveCustomer,
  type CustomerInput as CustomerMasterInput,
} from "./customers";
import { PAYMENT_MODES } from "./purchases";
import { recordCashEntry } from "./cashLedger";
import { getCostingMethod, getCostPool, saveCostPool } from "./costing";
import { billYear, formatBillNo, nextSequence } from "../logic/billNumber";
import { lineProfit } from "../logic/profit";
import { planSale } from "../logic/sales";
import { takeFromPool } from "../logic/weightedCost";
import { baseFactor, formatRupees, type Unit } from "../logic/units";

export const saleLineSchema = z.object({
  itemId: z.number({ message: "Choose an item" }).int().positive("Choose an item"),
  qtyBase: z.number({ message: "Enter a quantity" }).int().positive("Quantity must be positive"),
  unitPricePaise: z.number().int().nonnegative("Price cannot be negative"),
  hsnCode: z.string().trim().max(20, "HSN is too long").optional(),
});

export const saleBillSchema = z
  .object({
    customerId: z.number().int().positive().nullish(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
    paymentMode: z.enum(PAYMENT_MODES),
    paidPaise: z.number().int().nonnegative().optional(),
    discountPaise: z.number().int().nonnegative("Discount cannot be negative").default(0),
    gstPaise: z.number().int().nonnegative("GST cannot be negative").default(0),
    gstRateBp: z.number().int().min(0).max(10_000).optional(),
    /** Travel / delivery / packing paid for this deal. */
    saleExpensesPaise: z.number().int().nonnegative("Sale expenses cannot be negative").default(0),
    note: z.string().trim().max(200, "Note is too long").optional(),
    lines: z.array(saleLineSchema).min(1, "Add at least one item"),
  })
  .refine((v) => v.paymentMode !== "Credit" || v.customerId != null, {
    message: "Choose a customer for a credit sale",
  });

export type SaleBillInput = z.infer<typeof saleBillSchema>;

export function parseSaleBill(input: unknown): SaleBillInput {
  const result = saleBillSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid sale");
  }
  return result.data;
}

/** Next bill number for the sale's year: SD-2026-000001, …-000002, … */
export async function nextBillNoForDate(tx: TxDb, date: string): Promise<string> {
  const year = billYear(date);
  const prefix = `SD-${year}-`;
  const [row] = await tx
    .select({ billNo: saleBills.billNo })
    .from(saleBills)
    .where(like(saleBills.billNo, `${prefix}%`))
    .orderBy(desc(saleBills.billNo))
    .limit(1);
  const highest = row ? Number(row.billNo.slice(prefix.length)) : 0;
  return formatBillNo(year, nextSequence(highest));
}

export type SaleBillResult = {
  saleId: number;
  billNo: string;
  subtotalPaise: number;
  totalPaise: number;
  profitPaise: number;
};

/**
 * Save a whole bill in ONE transaction: per line FIFO-take stock (locked rows),
 * write the SALE movement + batch links, keep cost/profit per line, then the
 * bill header. Overselling blocks that line with an item-named message.
 */
export async function createSaleBill(url: string, input: unknown): Promise<SaleBillResult> {
  return withTransaction(url, (tx) => createSaleBillInTx(tx, input));
}

/** Same as {@link createSaleBill} but inside a transaction the caller owns. */
export async function createSaleBillInTx(tx: TxDb, input: unknown): Promise<SaleBillResult> {
  const data = parseSaleBill(input);

  return (async () => {
    if (data.customerId != null) {
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, data.customerId));
      if (!customer) throw new Error("Customer not found");
    }

    const billNo = await nextBillNoForDate(tx, data.date);
    const costing = await getCostingMethod(tx);

    const lines: {
      itemId: number;
      movementId: number;
      qtyBase: number;
      unitPricePaise: number;
      hsnCode: string | null;
      lineTotalPaise: number;
      costPaise: number;
      profitPaise: number;
      avgCostPaise: number;
    }[] = [];

    for (const line of data.lines) {
      const [item] = await tx
        .select({ name: items.name, unit: items.unit })
        .from(items)
        .where(eq(items.id, line.itemId));
      if (!item) throw new Error(`Item #${line.itemId} not found`);

      const factor = baseFactor(item.unit as Unit);

      // Lock this item's open batches so two bills cannot double-spend stock.
      const open = await tx
        .select({
          id: batches.id,
          qtyRemaining: batches.qtyRemaining,
          unitPricePaise: batches.unitPricePaise,
          purchaseDate: batches.purchaseDate,
        })
        .from(batches)
        .where(and(eq(batches.itemId, line.itemId), gt(batches.qtyRemaining, 0)))
        .orderBy(asc(batches.purchaseDate), asc(batches.id))
        .for("update");

      // Read the value pool BEFORE the batches are reduced (stock on hand before the sale).
      const poolBefore = costing === "WAC" ? await getCostPool(tx, line.itemId) : null;

      let plan;
      try {
        plan = planSale(open, line.qtyBase, line.unitPricePaise, factor);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${item.name}: ${message}`);
      }

      for (const row of plan.remaining) {
        const before = open.find((b) => b.id === row.id)?.qtyRemaining;
        if (before !== row.qtyRemaining) {
          await tx
            .update(batches)
            .set({ qtyRemaining: row.qtyRemaining })
            .where(eq(batches.id, row.id));
        }
      }

      // Cost of goods sold: weighted average (default) or FIFO batch cost.
      let costPaise: number;
      let avgCostPaise: number;
      if (poolBefore) {
        const take = takeFromPool(
          { qtyBase: poolBefore.qtyBase, valuePaise: poolBefore.valuePaise },
          line.qtyBase,
          factor,
        );
        costPaise = take.costPaise;
        avgCostPaise = take.avgCostPaise;
        await saveCostPool(tx, line.itemId, take.pool, item.unit as Unit);
      } else {
        costPaise = plan.totalCostPaise;
        avgCostPaise = Math.round((plan.totalCostPaise * factor) / line.qtyBase);
      }

      const [movement] = await tx
        .insert(stockMovements)
        .values({
          itemId: line.itemId,
          type: "SALE",
          qtyChange: -line.qtyBase,
          costPaise,
          enteredQtyLeft: null,
          movementDate: data.date,
          note: `Bill ${billNo}`,
        })
        .returning({ id: stockMovements.id });

      if (plan.takes.length > 0) {
        await tx.insert(movementBatchLinks).values(
          plan.takes.map((take) => ({
            movementId: movement.id,
            batchId: take.batchId,
            qtyTaken: take.qty,
            unitPricePaise: take.unitPricePaise,
            costPaise: take.costPaise,
          })),
        );
      }

      lines.push({
        itemId: line.itemId,
        movementId: movement.id,
        qtyBase: line.qtyBase,
        unitPricePaise: line.unitPricePaise,
        hsnCode: line.hsnCode?.trim() || null,
        lineTotalPaise: plan.revenuePaise,
        costPaise,
        profitPaise: lineProfit(plan.revenuePaise, costPaise),
        avgCostPaise,
      });
    }

    const subtotalPaise = lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    const totalPaise = subtotalPaise - data.discountPaise + data.gstPaise;
    if (totalPaise < 0) throw new Error("Discount is more than the bill");
    const paidPaise = data.paidPaise ?? (data.paymentMode === "Credit" ? 0 : totalPaise);
    if (paidPaise > totalPaise) throw new Error("Paid amount is more than the bill");

    const [bill] = await tx
      .insert(saleBills)
      .values({
        billNo,
        customerId: data.customerId ?? null,
        saleDate: data.date,
        subtotalPaise,
        discountPaise: data.discountPaise,
        gstPaise: data.gstPaise,
        gstRateBp: data.gstRateBp ?? 0,
        totalPaise,
        paymentMode: data.paymentMode,
        paidPaise,
        saleExpensesPaise: data.saleExpensesPaise,
        note: data.note?.trim() || null,
      })
      .returning({ id: saleBills.id });

    // Cash ledger: money received from this sale (paid amount only).
    if (paidPaise > 0) {
      await recordCashEntry(tx, {
        type: "sale",
        amountPaise: paidPaise,
        refType: "sale",
        refId: bill.id,
        entryDate: data.date,
        note: `Bill ${billNo}`,
        actor: undefined,
      });
    }

    await tx.insert(saleItems).values(lines.map((line) => ({ saleId: bill.id, ...line })));

    const profitPaise = lines.reduce((sum, l) => sum + l.profitPaise, 0);
    await logActivity(tx, {
      event: "sale.create",
      summary: `Sale ${billNo}: ${lines.length} line(s), ${formatRupees(totalPaise)}, profit ${formatRupees(
        profitPaise,
      )}`,
      entity: "sale",
      entityId: bill.id,
    });

    return { saleId: bill.id, billNo, subtotalPaise, totalPaise, profitPaise };
  })();
}

export type SaleBillRow = {
  id: number;
  billNo: string;
  customerName: string | null;
  saleDate: string;
  totalPaise: number;
  paidPaise: number;
  paymentMode: string;
  cancelled: boolean;
};
export async function listSaleBills(db: Db, limit = 50): Promise<SaleBillRow[]> {
  return db
    .select({
      id: saleBills.id,
      billNo: saleBills.billNo,
      customerName: customers.name,
      saleDate: saleBills.saleDate,
      totalPaise: saleBills.totalPaise,
      paidPaise: saleBills.paidPaise,
      paymentMode: saleBills.paymentMode,
      cancelled: saleBills.cancelled,
    })
    .from(saleBills)
    .leftJoin(customers, eq(saleBills.customerId, customers.id))
    .orderBy(desc(saleBills.saleDate), desc(saleBills.id))
    .limit(limit);
}

/**
 * Cancel a bill: restore each line's exact batch quantities from its SALE
 * movement links, then mark the bill cancelled. Never a hard delete.
 */
export async function cancelSaleBill(url: string, saleId: number): Promise<{ restored: number }> {
  return withTransaction(url, async (tx) => {
    const [bill] = await tx
      .select({ id: saleBills.id, billNo: saleBills.billNo, cancelled: saleBills.cancelled })
      .from(saleBills)
      .where(eq(saleBills.id, saleId))
      .for("update");
    if (!bill) throw new Error("Sale not found");
    if (bill.cancelled) throw new Error("Sale is already cancelled");

    const lines = await tx
      .select({
        id: saleItems.id,
        movementId: saleItems.movementId,
        itemId: saleItems.itemId,
        qtyBase: saleItems.qtyBase,
        costPaise: saleItems.costPaise,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId));

    const costing = await getCostingMethod(tx);

    // Read the pools BEFORE the batches are restored (stock on hand before the undo).
    const pools = new Map<number, { qtyBase: number; valuePaise: number }>();
    if (costing === "WAC") {
      for (const line of lines) {
        if (pools.has(line.itemId)) continue;
        const pool = await getCostPool(tx, line.itemId);
        pools.set(line.itemId, { qtyBase: pool.qtyBase, valuePaise: pool.valuePaise });
      }
    }

    for (const line of lines) {
      if (line.movementId == null) continue;
      const links = await tx
        .select({ batchId: movementBatchLinks.batchId, qtyTaken: movementBatchLinks.qtyTaken })
        .from(movementBatchLinks)
        .where(eq(movementBatchLinks.movementId, line.movementId));
      for (const link of links) {
        const [batch] = await tx
          .select({ qtyRemaining: batches.qtyRemaining })
          .from(batches)
          .where(eq(batches.id, link.batchId));
        if (!batch) continue;
        await tx
          .update(batches)
          .set({ qtyRemaining: batch.qtyRemaining + link.qtyTaken })
          .where(eq(batches.id, link.batchId));
      }
    }

    // Give the cost of goods sold back to the weighted-average pool.
    if (costing === "WAC") {
      for (const line of lines) {
        const pool = pools.get(line.itemId);
        if (!pool) continue;
        const [item] = await tx
          .select({ unit: items.unit })
          .from(items)
          .where(eq(items.id, line.itemId));
        if (!item) continue;
        await saveCostPool(
          tx,
          line.itemId,
          {
            qtyBase: pool.qtyBase + line.qtyBase,
            valuePaise: pool.valuePaise + line.costPaise,
          },
          item.unit as Unit,
        );
      }
    }

    await tx.update(saleBills).set({ cancelled: true }).where(eq(saleBills.id, saleId));
    await logActivity(tx, {
      event: "sale.cancel",
      summary: `Sale ${bill.billNo} cancelled; stock restored`,
      entity: "sale",
      entityId: saleId,
    });

    return { restored: lines.length };
  });
}

export const customerSchema = customerMasterSchema;
export type CustomerInput = CustomerMasterInput;

/**
 * Save the customer into the master (matched by phone → GSTIN → name) and
 * return it. Billing calls this for every bill, so the same client is never
 * stored twice.
 */
export async function createCustomer(
  db: Db,
  input: unknown,
): Promise<{ id: number; name: string; phone: string | null }> {
  const saved = await saveCustomer(db, input);
  return { id: saved.id, name: saved.name, phone: saved.phone };
}

/**
 * Record a payment against a bill (credit collection).
 * The amount is added to what has been paid; it can never go past the bill
 * total, and the bill is never marked paid while money is still due.
 */
export async function recordBillPayment(
  db: Db,
  saleId: number,
  amountPaise: number,
): Promise<{ paidPaise: number; totalPaise: number; creditPaise: number }> {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Enter an amount greater than zero");
  }
  const [bill] = await db
    .select({
      id: saleBills.id,
      billNo: saleBills.billNo,
      totalPaise: saleBills.totalPaise,
      paidPaise: saleBills.paidPaise,
      cancelled: saleBills.cancelled,
    })
    .from(saleBills)
    .where(eq(saleBills.id, saleId));
  if (!bill) throw new Error("Bill not found");
  if (bill.cancelled) throw new Error("This bill is cancelled");

  const paidPaise = Math.min(bill.totalPaise, bill.paidPaise + amountPaise);
  await db.update(saleBills).set({ paidPaise }).where(eq(saleBills.id, saleId));

  // Cash ledger: money received against this bill.
  await recordCashEntry(db, {
    type: "sale",
    amountPaise: amountPaise,
    refType: "sale",
    refId: saleId,
    entryDate: new Date().toISOString().slice(0, 10),
    note: `Payment on ${bill.billNo}`,
  });

  await logActivity(db, {
    event: "sale.payment",
    summary: `Payment received on ${bill.billNo}: ${formatRupees(paidPaise - bill.paidPaise)}`,
    entity: "sale",
    entityId: saleId,
  });
  return { paidPaise, totalPaise: bill.totalPaise, creditPaise: bill.totalPaise - paidPaise };
}

export type SaleBillLineDetail = {
  itemName: string;
  unit: string;
  qtyBase: number;
  unitPricePaise: number;
  hsnCode: string | null;
  lineTotalPaise: number;
  costPaise: number;
  profitPaise: number;
};

export type SaleBillDetail = {
  id: number;
  billNo: string;
  saleDate: string;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerGstin: string | null;
  customerEmail: string | null;
  paymentMode: string;
  subtotalPaise: number;
  discountPaise: number;
  gstPaise: number;
  gstRateBp: number;
  totalPaise: number;
  paidPaise: number;
  cancelled: boolean;
  lines: SaleBillLineDetail[];
};

/** One bill with its lines — used by the printable GST bill. */
export async function getSaleBill(db: Db, id: number): Promise<SaleBillDetail | null> {
  const [bill] = await db
    .select({
      id: saleBills.id,
      billNo: saleBills.billNo,
      saleDate: saleBills.saleDate,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerAddress: customers.address,
      customerGstin: customers.gstin,
      customerEmail: customers.email,
      paymentMode: saleBills.paymentMode,
      subtotalPaise: saleBills.subtotalPaise,
      discountPaise: saleBills.discountPaise,
      gstPaise: saleBills.gstPaise,
      gstRateBp: saleBills.gstRateBp,
      totalPaise: saleBills.totalPaise,
      paidPaise: saleBills.paidPaise,
      cancelled: saleBills.cancelled,
    })
    .from(saleBills)
    .leftJoin(customers, eq(saleBills.customerId, customers.id))
    .where(eq(saleBills.id, id));
  if (!bill) return null;

  const lines = await db
    .select({
      itemName: items.name,
      unit: items.unit,
      qtyBase: saleItems.qtyBase,
      unitPricePaise: saleItems.unitPricePaise,
      hsnCode: saleItems.hsnCode,
      lineTotalPaise: saleItems.lineTotalPaise,
      costPaise: saleItems.costPaise,
      profitPaise: saleItems.profitPaise,
    })
    .from(saleItems)
    .innerJoin(items, eq(items.id, saleItems.itemId))
    .where(eq(saleItems.saleId, id))
    .orderBy(asc(saleItems.id));

  return { ...bill, lines };
}

export type SavedCustomer = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  email: string | null;
};

/** Customer saved earlier with this GSTIN (for auto-fill on the billing form). */
export async function findCustomerByGstin(db: Db, gstin: string): Promise<SavedCustomer | null> {
  const normalized = gstin.trim().toUpperCase();
  if (!normalized) return null;
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      gstin: customers.gstin,
      email: customers.email,
    })
    .from(customers)
    .where(eq(customers.gstin, normalized))
    .orderBy(desc(customers.id))
    .limit(1);
  return row ?? null;
}
