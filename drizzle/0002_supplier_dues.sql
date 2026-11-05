-- Supplier dues / payable tracking
--> statement-breakpoint
-- Add paid_paise column to purchases (default 0)
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "paid_paise" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Create supplier_payments table
CREATE TABLE IF NOT EXISTS "supplier_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_id" integer NOT NULL REFERENCES "purchases"("id"),
	"amount_paise" integer NOT NULL,
	"payment_date" date NOT NULL,
	"payment_mode" text,
	"note" text,
	"actor" text,
	"created_at" timestamp with time zone NOT NULL
);
