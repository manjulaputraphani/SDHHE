-- Working capital: cash/bank ledger + opening balance
--> statement-breakpoint
CREATE TABLE "cash_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"ref_type" text,
	"ref_id" integer,
	"entry_date" date NOT NULL,
	"note" text,
	"actor" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_balance" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount_paise" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
