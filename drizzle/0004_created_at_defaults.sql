-- Manual migrations 0001 and 0002 created these timestamps as NOT NULL
-- without a default, while the Drizzle schema uses .defaultNow().
-- Without the default, inserts that pass `default` violate NOT NULL.
ALTER TABLE "cash_ledger" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "opening_balance" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "supplier_payments" ALTER COLUMN "created_at" SET DEFAULT now();
