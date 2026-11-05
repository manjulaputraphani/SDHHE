/**
 * Customer master — one row per client.
 *
 * Billing saves the customer details into this master, so the same client is
 * never entered twice: a customer is matched by phone, then GSTIN, then name,
 * and an existing record is updated instead of duplicated.
 */
import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client";
import { customers, saleBills } from "./schema";
import { logActivity } from "./activity";

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(80, "Customer name is too long"),
  phone: z.string().trim().max(20, "Phone is too long").optional(),
  address: z.string().trim().max(200, "Address is too long").optional(),
  gstin: z.string().trim().max(20, "GSTIN is too long").optional(),
  email: z.string().trim().max(120, "Email is too long").optional(),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export type CustomerRow = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  email: string | null;
  /** How many bills this customer has. */
  billCount: number;
  /** What they have been billed in total (paise). */
  billedPaise: number;
  /** Credit still outstanding on their bills (paise). */
  creditPaise: number;
  lastBillDate: string | null;
};

export function parseCustomerInput(input: unknown): CustomerInput {
  const result = customerSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid customer");
  }
  return result.data;
}

/** Digits only — so "98765 43210" and "9876543210" are the same customer. */
export function normalisePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length ? digits : null;
}

/**
 * GSTIN, uppercased. "NA", "N/A" and "-" mean the customer has no GSTIN and
 * are stored as NULL — otherwise every such customer would match on "NA".
 */
export function normaliseGstin(gstin: string | null | undefined): string | null {
  const value = (gstin ?? "").trim().toUpperCase();
  if (!value || value === "NA" || value === "N/A" || value === "-") return null;
  return value;
}

/**
 * Find the master record for these details: phone → GSTIN → name.
 * Returns null when the client is new.
 */
export async function findCustomer(
  db: Db,
  input: { name?: string; phone?: string | null; gstin?: string | null },
): Promise<CustomerRow | null> {
  const phone = normalisePhone(input.phone);
  const gstin = normaliseGstin(input.gstin);
  const name = input.name?.trim() || null;

  const conditions = [];
  if (phone) conditions.push(eq(customers.phone, phone));
  if (gstin) conditions.push(eq(sql`upper(${customers.gstin})`, gstin));
  if (!conditions.length && name) conditions.push(sql`lower(${customers.name}) = lower(${name})`);
  if (!conditions.length) return null;

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      gstin: customers.gstin,
      email: customers.email,
    })
    .from(customers)
    .where(or(...conditions.map((condition) => condition))!)
    .limit(1);

  const found = rows[0];
  if (!found) return null;
  return { ...found, billCount: 0, billedPaise: 0, creditPaise: 0, lastBillDate: null };
}

/**
 * Save the customer into the master: update the matching record (filling in
 * what is new, keeping what is already known) or create a new one.
 */
export async function saveCustomer(db: Db, input: unknown): Promise<CustomerRow> {
  const data = parseCustomerInput(input);
  // The phone is stored as digits only, so "98765 43210" and "9876543210"
  // are the same client.
  const phone = normalisePhone(data.phone);
  const gstin = normaliseGstin(data.gstin);
  const address = data.address?.trim() || null;
  const email = data.email?.trim() || null;

  const existing = await findCustomer(db, { name: data.name, phone, gstin });

  if (existing) {
    const [updated] = await db
      .update(customers)
      .set({
        // Empty fields never wipe what the master already knows.
        name: data.name,
        phone: phone ?? existing.phone,
        address: address ?? existing.address,
        gstin: gstin ?? existing.gstin,
        email: email ?? existing.email,
      })
      .where(eq(customers.id, existing.id))
      .returning();
    await logActivity(db, {
      event: "customer.update",
      summary: `Customer updated: ${updated.name}`,
      entity: "customer",
      entityId: updated.id,
    });
    return { ...updated, billCount: 0, billedPaise: 0, creditPaise: 0, lastBillDate: null };
  }

  const [created] = await db
    .insert(customers)
    .values({ name: data.name, phone, address, gstin, email })
    .returning();
  await logActivity(db, {
    event: "customer.create",
    summary: `Customer added: ${created.name}`,
    entity: "customer",
    entityId: created.id,
  });
  return { ...created, billCount: 0, billedPaise: 0, creditPaise: 0, lastBillDate: null };
}

/** The customer master, newest activity first, with a name/phone/GSTIN search. */
export async function listCustomers(db: Db, search?: string): Promise<CustomerRow[]> {
  const text = search?.trim();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      gstin: customers.gstin,
      email: customers.email,
      billCount: sql<number>`count(${saleBills.id})`.mapWith(Number),
      billedPaise: sql<number>`coalesce(sum(${saleBills.totalPaise}), 0)`.mapWith(Number),
      // Credit still due: the unpaid part of their live (not cancelled) bills.
      creditPaise:
        sql<number>`coalesce(sum(case when ${saleBills.cancelled} = false and ${saleBills.paidPaise} < ${saleBills.totalPaise} then ${saleBills.totalPaise} - ${saleBills.paidPaise} else 0 end), 0)`.mapWith(Number),
      lastBillDate: sql<string | null>`max(${saleBills.saleDate})`.mapWith(String),
    })
    .from(customers)
    .leftJoin(saleBills, eq(saleBills.customerId, customers.id))
    .where(
      text
        ? or(
            ilike(customers.name, `%${text}%`),
            ilike(customers.phone, `%${text}%`),
            ilike(customers.gstin, `%${text}%`),
            ilike(customers.email, `%${text}%`),
          )
        : undefined,
    )
    .groupBy(customers.id)
    .orderBy(desc(sql`max(${saleBills.saleDate})`), asc(customers.name));

  return rows;
}

export async function getCustomer(db: Db, id: number): Promise<CustomerRow | null> {
  const rows = await listCustomers(db);
  return rows.find((row) => row.id === id) ?? null;
}

/** Edit a customer in place (the master row is picked in the UI). */
export async function updateCustomer(db: Db, id: number, input: unknown): Promise<CustomerRow> {
  const data = parseCustomerInput(input);
  const phone = normalisePhone(data.phone);
  const gstin = normaliseGstin(data.gstin);
  const [updated] = await db
    .update(customers)
    .set({
      name: data.name,
      phone,
      address: data.address?.trim() || null,
      gstin,
      email: data.email?.trim() || null,
    })
    .where(eq(customers.id, id))
    .returning();
  if (!updated) throw new Error("Customer not found");
  await logActivity(db, {
    event: "customer.update",
    summary: `Customer updated: ${updated.name}`,
    entity: "customer",
    entityId: updated.id,
  });
  return { ...updated, billCount: 0, billedPaise: 0, creditPaise: 0, lastBillDate: null };
}

/** Remove a customer from the master (only when no bill uses them). */
export async function deleteCustomer(db: Db, id: number): Promise<void> {
  const used = await db
    .select({ id: saleBills.id })
    .from(saleBills)
    .where(eq(saleBills.customerId, id))
    .limit(1);
  if (used.length > 0) throw new Error("This customer has bills — they cannot be deleted");
  const [removed] = await db
    .delete(customers)
    .where(eq(customers.id, id))
    .returning({ id: customers.id, name: customers.name });
  if (!removed) throw new Error("Customer not found");
  await logActivity(db, {
    event: "customer.delete",
    summary: `Customer deleted: ${removed.name}`,
    entity: "customer",
    entityId: removed.id,
  });
}

/** Find a customer by GSTIN (used by the billing screen's GSTIN auto-fill). */
export async function findCustomerByGstin(db: Db, gstin: string): Promise<CustomerRow | null> {
  const value = normaliseGstin(gstin);
  if (!value) return null;
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      gstin: customers.gstin,
      email: customers.email,
    })
    .from(customers)
    .where(eq(sql`upper(${customers.gstin})`, value))
    .limit(1);
  const found = rows[0];
  if (!found) return null;
  return { ...found, billCount: 0, billedPaise: 0, creditPaise: 0, lastBillDate: null };
}

/** Customers whose details start with the given text (picker helper). */
export async function searchCustomers(db: Db, text: string, limit = 20): Promise<CustomerRow[]> {
  const rows = await listCustomers(db, text);
  return rows.slice(0, limit);
}
