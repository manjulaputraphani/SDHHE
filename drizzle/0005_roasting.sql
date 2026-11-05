-- Roasted seeds: internal production batches (raw → roasted + charge).

ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'purchase';

CREATE TABLE IF NOT EXISTS "roastings" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_item_id" integer NOT NULL REFERENCES "items"("id"),
	"roasted_item_id" integer NOT NULL REFERENCES "items"("id"),
	"roasted_purchase_id" integer REFERENCES "purchases"("id"),
	"roast_date" date NOT NULL,
	"raw_qty_base" integer NOT NULL,
	"roasted_qty_base" integer NOT NULL,
	"yield_bp" integer NOT NULL,
	"charge_per_kg_paise" integer NOT NULL DEFAULT 0,
	"charge_paise" integer NOT NULL DEFAULT 0,
	"raw_cost_paise" integer NOT NULL DEFAULT 0,
	"total_cost_paise" integer NOT NULL DEFAULT 0,
	"margin_bp" integer NOT NULL DEFAULT 0,
	"suggested_price_paise" integer NOT NULL DEFAULT 0,
	"note" text,
	"actor" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "stock_movements" DROP CONSTRAINT IF EXISTS "stock_movements_type_valid";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_valid"
	CHECK ("type" in ('PURCHASE','STOCK_CHECK','USAGE','WASTAGE','ADJUSTMENT','SALE','ROASTING'));
