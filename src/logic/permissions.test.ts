import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  MODULES,
  PERMISSION_ACTIONS,
  allowed,
} from "./permissions";

describe("role permission defaults", () => {
  it("Owner has every permission on every module", () => {
    for (const moduleKey of MODULES) {
      for (const action of PERMISSION_ACTIONS) {
        expect(allowed(DEFAULT_ROLE_PERMISSIONS.owner, moduleKey, action)).toBe(true);
      }
    }
  });

  it("CA: view+export on finance modules, view on items/customers/stock, nothing else", () => {
    const ca = DEFAULT_ROLE_PERMISSIONS.ca;
    for (const moduleKey of ["dashboard", "bills", "purchases", "expenses", "investments", "reports"] as const) {
      expect(allowed(ca, moduleKey, "view")).toBe(true);
      expect(allowed(ca, moduleKey, "export")).toBe(true);
      expect(allowed(ca, moduleKey, "create")).toBe(false);
      expect(allowed(ca, moduleKey, "edit")).toBe(false);
      expect(allowed(ca, moduleKey, "delete")).toBe(false);
    }
    for (const moduleKey of ["items", "customers", "stock"] as const) {
      expect(allowed(ca, moduleKey, "view")).toBe(true);
    }
    for (const moduleKey of ["billing", "activity", "team", "settings"] as const) {
      for (const action of PERMISSION_ACTIONS) {
        expect(allowed(ca, moduleKey, action)).toBe(false);
      }
    }
  });

  it("Staff: create on entry modules, view on invoices/items", () => {
    const staff = DEFAULT_ROLE_PERMISSIONS.staff;
    for (const moduleKey of ["billing", "purchases", "expenses", "stock", "customers"] as const) {
      expect(allowed(staff, moduleKey, "view")).toBe(true);
      expect(allowed(staff, moduleKey, "create")).toBe(true);
      expect(allowed(staff, moduleKey, "delete")).toBe(false);
    }
    for (const moduleKey of ["bills", "items"] as const) {
      expect(allowed(staff, moduleKey, "view")).toBe(true);
      expect(allowed(staff, moduleKey, "create")).toBe(false);
    }
    for (const moduleKey of ["dashboard", "investments", "reports", "activity", "team", "settings"] as const) {
      for (const action of PERMISSION_ACTIONS) {
        expect(allowed(staff, moduleKey, action)).toBe(false);
      }
    }
  });

  it("allowed() is safe with no permissions", () => {
    expect(allowed(null, "dashboard", "view")).toBe(false);
    expect(allowed(undefined, "items", "view")).toBe(false);
  });

  it("Team Chat: staff may talk and submit a receipt, CA and Owner may approve", () => {
    expect(allowed(DEFAULT_ROLE_PERMISSIONS.staff, "chat", "view")).toBe(true);
    expect(allowed(DEFAULT_ROLE_PERMISSIONS.staff, "chat", "create")).toBe(true);
    expect(allowed(DEFAULT_ROLE_PERMISSIONS.staff, "chat", "edit")).toBe(false);

    expect(allowed(DEFAULT_ROLE_PERMISSIONS.ca, "chat", "view")).toBe(true);
    expect(allowed(DEFAULT_ROLE_PERMISSIONS.ca, "chat", "create")).toBe(true);
    expect(allowed(DEFAULT_ROLE_PERMISSIONS.ca, "chat", "edit")).toBe(true);
    expect(allowed(DEFAULT_ROLE_PERMISSIONS.ca, "chat", "delete")).toBe(false);

    expect(allowed(DEFAULT_ROLE_PERMISSIONS.owner, "chat", "edit")).toBe(true);
  });
});
