/**
 * Dump every app table to docs/db-backup-<timestamp>.json (gitignored).
 *
 *   node --env-file=.env scripts/db-backup.mjs
 *
 * Uses the Neon HTTP driver, so it needs Node 22 (global fetch) and a
 * DATABASE_URL in .env. Read-only: never writes to the database.
 */
import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL missing — run with: node --env-file=.env scripts/db-backup.mjs");
  process.exit(1);
}

const TABLES = [
  "items", "suppliers", "purchases", "batches", "stock_movements", "movement_batch_links",
  "sales", "expenses", "expense_bills", "activity_log", "app_users", "role_permissions",
  "user_sessions", "customers", "sale_bills", "sale_items", "settings", "investments",
  "ai_suggestions", "roastings", "chat_messages", "receipt_requests", "chat_conversations",
  "chat_conversation_members", "chat_message_states", "chat_message_edits", "chat_reactions",
  "chat_pinned_messages", "cash_ledger", "opening_balance", "supplier_payments",
  "announcements", "announcement_dismissals", "releases", "user_releases_seen", "user_tours",
  "login_history", "push_subscriptions", "push_tokens",
];

const sql = neon(url);
const dump = {};
const counts = {};

for (const table of TABLES) {
  const [exists] = await sql.query(
    `select to_regclass('public.${table}') is not null as ok`,
  );
  if (!exists?.ok) {
    counts[table] = "missing";
    continue;
  }
  const rows = await sql.query(`select * from ${table}`);
  dump[table] = rows;
  counts[table] = rows.length;
}

mkdirSync("docs", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = `docs/db-backup-${stamp}.json`;
writeFileSync(file, JSON.stringify(dump, null, 2));

console.log(`backup written: ${file}`);
for (const [table, n] of Object.entries(counts)) console.log(String(n).padStart(7), table);
