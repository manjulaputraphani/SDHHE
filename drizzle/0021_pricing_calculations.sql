-- Green Coffee Pricing Calculator — saved quotes.
-- Inputs and the derived results are stored together so a saved quote can be
-- reopened exactly as it was. Money here is quoted rupees (the calculator),
-- not the ledger's integer paise.

CREATE TABLE IF NOT EXISTS "pricing_calculations" (
	"id" serial PRIMARY KEY NOT NULL,
	"grade" text NOT NULL,
	"note" text,
	"inputs" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"created_by" integer REFERENCES "app_users"("id") ON DELETE SET NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pricing_calculations_created_idx"
	ON "pricing_calculations" ("created_at");
CREATE INDEX IF NOT EXISTS "pricing_calculations_grade_idx"
	ON "pricing_calculations" ("grade");
