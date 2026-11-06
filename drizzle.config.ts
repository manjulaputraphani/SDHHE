import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env and paste the Neon dev URL.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // This Neon project also holds an unrelated app's tables (CamelCase, public)
  // and an `sdhhe_fy2025` schema. Restrict push to public so drizzle never
  // touches anything outside our own lowercase tables.
  schemaFilter: ["public"],
  // The old app's CamelCase tables were dropped from the database on
  // 2026-10-31. Keep them out of every future push so drizzle does not
  // recreate them (they are not part of src/db/schema.ts).
  tablesFilter: [
    "public.items",
    "public.purchases",
    "public.batches",
    "public.stock_movements",
    "public.movement_batch_links",
    "public.sales",
    "public.expenses",
    "public.expense_bills",
    "public.activity_log",
    "public.app_users",
    "public.user_sessions",
    "public.customers",
    "public.sale_bills",
    "public.sale_items",
    "public.settings",
    "public.ai_suggestions",
    "public.cash_ledger",
    "public.opening_balance",
    "public.supplier_payments",
    "public.roastings",
    "public.chat_messages",
    "public.receipt_requests",
    "public.chat_conversations",
    "public.chat_conversation_members",
    "public.chat_message_states",
    "public.push_subscriptions",
  ],
  dbCredentials: { url },
});
