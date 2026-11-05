/**
 * Supplier dues / payable tracking tests.
 *
 * DB integration tests need DATABASE_URL_TEST (a separate test database) and
 * skip otherwise.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { setupTestDb, testDbUrl, resetAll } from "./test-utils";
import { createItem } from "./items";
import { addPurchase } from "./purchases";
import {
  createSupplier,
  listSuppliers,
  getSupplierDues,
  recordSupplierPayment,
  listSupplierPayments,
  getTotalSupplierDues,
} from "./suppliers";

const db = await setupTestDb();
const url = testDbUrl();

if (db && url) {
  describe("suppliers — dues and payments (integration)", () => {
    beforeEach(async () => {
      await resetAll(db);
    });

    it("create and list suppliers", async () => {
      const s1 = await createSupplier(db, { name: "Rice Traders", phone: "9999999999" });
      const s2 = await createSupplier(db, { name: "Veg Supply", phone: null });

      const list = await listSuppliers(db);
      expect(list.length).toBe(2);
      expect(list.find((s) => s.id === s1.id)?.name).toBe("Rice Traders");
      expect(list.find((s) => s.id === s2.id)?.phone).toBeNull();
    });

    it("getSupplierDues returns zero when no purchases", async () => {
      await createSupplier(db, { name: "Empty Supplier" });
      const dues = await getSupplierDues(db);
      expect(dues.length).toBe(1);
      expect(dues[0].outstandingPaise).toBe(0);
      expect(dues[0].totalPurchasedPaise).toBe(0);
      expect(dues[0].totalPaidPaise).toBe(0);
    });

    it("tracks outstanding dues after purchases and partial payments", async () => {
      const supplier = await createSupplier(db, { name: "Rice Traders" });
      const item = await createItem(db, { name: "Rice", unit: "kg", minStockBase: 0 });

      // Purchase 1: ₹5,000 total
      const p1 = await addPurchase(db, {
        itemId: item.id,
        supplierId: supplier.id,
        qty: 100,
        unitPricePaise: 50_00, // ₹50/kg
        date: "2026-07-01",
      });
      // Purchase 2: ₹3,000 total
      await addPurchase(db, {
        itemId: item.id,
        supplierId: supplier.id,
        qty: 50,
        unitPricePaise: 60_00, // ₹60/kg
        date: "2026-07-05",
      });

      const dues = await getSupplierDues(db);
      const supplierDues = dues.find((d) => d.id === supplier.id)!;
      expect(supplierDues.totalPurchasedPaise).toBe(800_000); // ₹8,000
      expect(supplierDues.totalPaidPaise).toBe(0);
      expect(supplierDues.outstandingPaise).toBe(800_000);

      // Pay ₹2,000 against purchase 1
      await recordSupplierPayment(db, {
        purchaseId: p1.purchaseId,
        amountPaise: 200_000,
        paymentDate: "2026-07-10",
        paymentMode: "UPI",
        note: "Partial payment",
      });

      const duesAfter = await getSupplierDues(db);
      const supplierDuesAfter = duesAfter.find((d) => d.id === supplier.id)!;
      expect(supplierDuesAfter.totalPaidPaise).toBe(200_000);
      expect(supplierDuesAfter.outstandingPaise).toBe(600_000);

      // Total supplier dues across all suppliers
      const total = await getTotalSupplierDues(db);
      expect(total).toBe(600_000);

      // Payment is recorded in supplier_payments
      const payments = await listSupplierPayments(db);
      expect(payments.length).toBe(1);
      expect(payments[0].amountPaise).toBe(200_000);
      expect(payments[0].paymentMode).toBe("UPI");
      expect(payments[0].itemName).toBe("Rice");
    });

    it("rejects payment exceeding purchase total", async () => {
      const supplier = await createSupplier(db, { name: "Rice Traders" });
      const item = await createItem(db, { name: "Rice", unit: "kg", minStockBase: 0 });

      const p1 = await addPurchase(db, {
        itemId: item.id,
        supplierId: supplier.id,
        qty: 100,
        unitPricePaise: 50_00,
        date: "2026-07-01",
      }); // total = ₹5,000

      await expect(
        recordSupplierPayment(db, {
          purchaseId: p1.purchaseId,
          amountPaise: 600_000, // ₹6,000 > ₹5,000 total
          paymentDate: "2026-07-10",
        }),
      ).rejects.toThrow();
    });

    it("listSupplierPayments filtered by purchase", async () => {
      const supplier = await createSupplier(db, { name: "Rice Traders" });
      const item = await createItem(db, { name: "Rice", unit: "kg", minStockBase: 0 });

      const p1 = await addPurchase(db, {
        itemId: item.id,
        supplierId: supplier.id,
        qty: 100,
        unitPricePaise: 50_00,
        date: "2026-07-01",
      });
      const p2 = await addPurchase(db, {
        itemId: item.id,
        supplierId: supplier.id,
        qty: 50,
        unitPricePaise: 60_00,
        date: "2026-07-05",
      });

      await recordSupplierPayment(db, {
        purchaseId: p1.purchaseId,
        amountPaise: 100_000,
        paymentDate: "2026-07-10",
      });
      await recordSupplierPayment(db, {
        purchaseId: p2.purchaseId,
        amountPaise: 50_000,
        paymentDate: "2026-07-12",
      });

      const p1Payments = await listSupplierPayments(db, p1.purchaseId);
      expect(p1Payments.length).toBe(1);
      expect(p1Payments[0].amountPaise).toBe(100_000);

      const allPayments = await listSupplierPayments(db);
      expect(allPayments.length).toBe(2);
    });
  });
} else {
  describe.skip("suppliers — dues and payments (integration)", () => {
    it("skipped — no DATABASE_URL_TEST", () => {
      expect(true).toBe(true);
    });
  });
}
