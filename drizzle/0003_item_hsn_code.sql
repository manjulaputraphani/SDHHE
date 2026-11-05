-- HSN code on the item master (optional, shown on invoices)
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "hsn_code" text;
