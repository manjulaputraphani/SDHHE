import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, type Db } from "./client";

/** Only OUR tables — never the pre-existing CamelCase tables in the shared Neon project. */
const OUR_TABLES = [
  "movement_batch_links",
  "stock_movements",
  "batches",
  "purchases",
  "expenses",
  "expense_bills",
  "ai_suggestions",
  "settings",
  "suppliers",
  "items",
  "customers",
  "sale_items",
  "sale_bills",
  "activity_log",
  "app_users",
  "role_permissions",
  "user_sessions",
  "investments",
  "cash_ledger",
  "opening_balance",
  "supplier_payments",
  "chat_messages",
  "receipt_requests",
] as const;

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] };
  return r.rows ?? (result as T[]);
}

/**
 * Returns a handle for DATABASE_URL_TEST, or null when it is not configured
 * (so the suite skips instead of failing on machines without a test DB).
 *
 * Hard safety gate: refuse to touch a database that looks like the real app
 * database, because these tests TRUNCATE tables.
 */
export async function setupTestDb(): Promise<Db | null> {
  const url = process.env.DATABASE_URL_TEST?.trim();
  if (!url) return null;

  if (url === process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL_TEST must point at a different database than DATABASE_URL");
  }

  const db = getDb(url);
  const found = rowsOf<{ c: number }>(
    await db.execute(sql`
      select count(*)::int as c from information_schema.tables
      where table_schema = 'public'
        and table_name in ('Users', 'Invoices', 'StockLedger', '__EFMigrationsHistory')
    `),
  )[0]?.c;

  if ((found ?? 0) > 0) {
    throw new Error(
      "Refusing to run DB tests: DATABASE_URL_TEST looks like the production database. Use a separate dev branch.",
    );
  }

  return db;
}

/** Wipe our tables and restart ids. Test database only. */
export async function resetAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${OUR_TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

/** The raw test URL, for flows that need a transactional client. */
export function testDbUrl(): string | null {
  return process.env.DATABASE_URL_TEST?.trim() || null;
}
