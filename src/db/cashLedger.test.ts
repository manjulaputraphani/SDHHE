/**
 * Cash ledger + working capital tests.
 *
 * Pure logic tests run always; DB integration tests need DATABASE_URL_TEST
 * (a separate test database) and skip otherwise.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupTestDb, testDbUrl, resetAll } from "./test-utils";
import {
  creditAging,
  workingCapital,
  rotationTrend,
  type CreditAgingRow,
} from "./cashLedger";
import { items, saleBills, customers, openingBalance } from "./schema";

// ---- Pure helper: days between two dates ----

function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

describe("cash ledger — days between", () => {
  it("same day is 0", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });
  it("one day apart is 1", () => {
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
  });
  it("month boundary", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
  });
  it("year boundary", () => {
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

// ---- Credit aging bucket logic (pure) ----

function ageBucket(daysOverdue: number): CreditAgingRow["ageBucket"] {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

describe("cash ledger — credit age buckets", () => {
  it("current for 0 or negative overdue", () => {
    expect(ageBucket(0)).toBe("current");
    expect(ageBucket(-5)).toBe("current");
  });
  it("1-30 bucket", () => {
    expect(ageBucket(1)).toBe("1-30");
    expect(ageBucket(30)).toBe("1-30");
  });
  it("31-60 bucket", () => {
    expect(ageBucket(31)).toBe("31-60");
    expect(ageBucket(60)).toBe("31-60");
  });
  it("61-90 bucket", () => {
    expect(ageBucket(61)).toBe("61-90");
    expect(ageBucket(90)).toBe("61-90");
  });
  it("90+ bucket", () => {
    expect(ageBucket(91)).toBe("90+");
  });
});

// ---- DB integration tests ----

const db = await setupTestDb();
const url = testDbUrl();

if (db && url) {
  describe(
    "cash ledger — working capital + credit aging (integration)",
    { timeout: 60_000 },
    () => {
      beforeEach(async () => {
        await resetAll(db);
      });

      it("working capital returns zeros when no data", async () => {
        const wc = await workingCapital(db);
        expect(wc.investmentPaise).toBe(0);
        expect(wc.stockValuePaise).toBe(0);
        expect(wc.cashInBankPaise).toBe(0);
        expect(wc.creditOutstandingPaise).toBe(0);
        expect(wc.amountInRotationPaise).toBe(0);
      });

      it("opening balance is used as investment and cash base", async () => {
        // ₹10,00,000 = 100000000 paise
        await db.insert(openingBalance).values({
          amountPaise: 100_000_000,
          asOfDate: "2026-04-01",
          note: "Owner investment",
        });
        const wc = await workingCapital(db, "2026-04-01");
        expect(wc.investmentPaise).toBe(100_000_000);
        expect(wc.cashInBankPaise).toBe(100_000_000);
      });

      it("credit aging groups unpaid bills by bucket", async () => {
        const [item] = await db
          .insert(items)
          .values({ name: "Rice", unit: "kg", minStockBase: 0 })
          .returning();

        const [customer] = await db
          .insert(customers)
          .values({ name: "Ramu", phone: "9999999999" })
          .returning();

        // Unpaid bill from 45 days ago → 31-60 bucket
        const oldDate = new Date();
        oldDate.setUTCDate(oldDate.getUTCDate() - 45);
        const oldDateStr = oldDate.toISOString().slice(0, 10);

        await db.insert(saleBills).values({
          billNo: "SD-2026-000001",
          customerId: customer.id,
          saleDate: oldDateStr,
          subtotalPaise: 50_000,
          discountPaise: 0,
          gstPaise: 0,
          gstRateBp: 0,
          totalPaise: 50_000,
          paymentMode: "Credit",
          paidPaise: 10_000, // ₹400 outstanding
          saleExpensesPaise: 0,
          cancelled: false,
        });

        // Current bill (today, fully unpaid)
        const today = new Date().toISOString().slice(0, 10);
        await db.insert(saleBills).values({
          billNo: "SD-2026-000002",
          customerId: customer.id,
          saleDate: today,
          subtotalPaise: 30_000,
          discountPaise: 0,
          gstPaise: 0,
          gstRateBp: 0,
          totalPaise: 30_000,
          paymentMode: "Credit",
          paidPaise: 0,
          saleExpensesPaise: 0,
          cancelled: false,
        });

        void item;

        const aging = await creditAging(db);
        expect(aging.totalOutstandingPaise).toBe(70_000); // ₹400 + ₹300
        expect(aging.byBucket["31-60"]).toBe(40_000);
        expect(aging.byBucket.current).toBe(30_000);
        expect(aging.rows.length).toBe(2);
      });

      it("rotation trend returns daily net sales", async () => {
        const trend = await rotationTrend(db, 7);
        expect(trend.length).toBe(7);
        // All zeros when no bills
        for (const day of trend) {
          expect(day.netSalesPaise).toBe(0);
        }
      });
    });
} else {
  describe.skip("cash ledger — working capital + credit aging (integration)", () => {
    it("skipped — no DATABASE_URL_TEST", () => {
      expect(true).toBe(true);
    });
  });
}
