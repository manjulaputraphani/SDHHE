import { test, expect } from "@playwright/test";
import { ownerPermissions, DEFAULT_ROLE_PERMISSIONS } from "../src/logic/permissions";

/**
 * The notification system (Phase 15): the welcome banner, the toast, the
 * announcement bar, the "what's new" window and the onboarding checklist.
 *
 * The worker is mocked, so the suite needs no database and no account.
 */
const OWNER = { id: 1, name: "B PHANI KUMAR", role: "owner" as const, permissions: ownerPermissions() };
const STAFF = { id: 4, name: "RAJU", role: "staff" as const, permissions: DEFAULT_ROLE_PERMISSIONS.staff };

const BOOTSTRAP = {
  user: {
    id: 1,
    name: "B PHANI KUMAR",
    role: "owner",
    lastLoginAt: "2026-11-06T09:00:00.000Z",
    showWelcomeBanner: true,
  },
  announcements: [
    {
      id: 5,
      title: "Diwali offer",
      message: "Buy 10 kg, get 1 kg free.",
      kind: "warning" as const,
      linkLabel: "See the offer",
      linkUrl: "https://example.com",
      isActive: true,
      createdAt: "2026-11-06T08:00:00.000Z",
    },
  ],
  release: {
    id: 3,
    version: "1.4",
    title: "The Team Chat is here",
    items: ["Chat with the whole team", "Send receipts for approval"],
    imageUrl: null,
    releaseDate: "2026-11-06T09:00:00.000Z",
  },
  onboarding: {
    steps: [
      { key: "items", label: "Add your first item", done: false },
      { key: "expenses", label: "Record your first expense", done: true },
    ],
    done: 1,
    total: 2,
    completed: false,
  },
  tours: [],
  loginHistory: [],
  session: { expiresAt: new Date(Date.now() + 1800_000).toISOString() },
};

async function mockApp(page: import("@playwright/test").Page, member: typeof OWNER | typeof STAFF) {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        shop: { name: "SDHHE", email: "" },
        items: [],
        bills: [],
        activity: [],
        members: [],
        users: [],
        roles: [],
        expenses: [],
        purchases: [],
        roastings: [],
        investments: [],
        suppliers: [],
        customers: [],
        entries: [],
        daily: [],
        categories: [],
        dues: [],
        payments: [],
        usage: [],
        sessions: [],
        receipts: [],
        messages: [],
        pending: 0,
        stats: {},
        rotation: {
          asOfDate: "2026-11-06",
          investmentPaise: 0,
          stockValuePaise: 0,
          cashInBankPaise: 0,
          creditOutstandingPaise: 0,
          amountInRotationPaise: 0,
          netSalesPaise: 0,
          cogsPaise: 0,
          expensesPaise: 0,
          grossProfitPaise: 0,
          netProfitPaise: 0,
          rotationTimes: 0,
          daysToRotate: null,
          inventoryTurnover: 0,
          daily: [],
          trend: [],
        },
        notifications: BOOTSTRAP,
        announcements: BOOTSTRAP.announcements,
        logins: [],
      },
    }),
  );
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: member } }));
  await page.route("**/api/notifications", (route) => route.fulfill({ json: BOOTSTRAP }));
  await page.route("**/api/notifications/announcements/5/dismiss", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/notifications/releases/3/seen", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/notifications/onboarding/complete", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/notifications/tours/team-chat", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/notifications/login-history", (route) =>
    route.fulfill({ json: { logins: [] } }),
  );
  await page.route("**/api/notifications/welcome-banner", (route) =>
    route.fulfill({ json: { ok: true, showWelcomeBanner: false } }),
  );
}

/** Simulate a REAL login: the login success handler sets the one-time flag. */
async function withLoginFlag(page: import("@playwright/test").Page) {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("sdhhe:just-logged-in", "1"),
  );
}

test.describe("The notification system", () => {
  test("welcomes the member once after a real login and hides after 6 s", async ({ page }) => {
    await mockApp(page, OWNER);
    await withLoginFlag(page);
    await page.goto("/");
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toBeVisible();
    await expect(page.getByText(/Your last sign-in was/)).toBeVisible();
    // Auto-hides after 6 seconds.
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toHaveCount(0, {
      timeout: 8000,
    });
  });

  test("shows NO welcome banner on a refresh or a new tab (no login flag)", async ({ page }) => {
    await mockApp(page, OWNER);
    // No login flag — this is a session restore (refresh / new tab).
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Dashboard/ }).first()).toBeVisible();
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toHaveCount(0);
    // A page refresh must not bring it back either.
    await page.reload();
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toHaveCount(0);
    await expect(page.getByText(/Logged in successfully/)).toHaveCount(0);
  });

  test("the welcome banner does not come back after the flag is consumed", async ({ page }) => {
    await mockApp(page, OWNER);
    await withLoginFlag(page);
    await page.goto("/");
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toBeVisible();
    // The flag was consumed on mount — a refresh in the SAME tab shows nothing.
    await page.reload();
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toHaveCount(0);
  });

  test("the welcome banner can be closed with the X", async ({ page }) => {
    await mockApp(page, OWNER);
    await withLoginFlag(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Close the welcome message" })
      .first()
      .dispatchEvent("click");
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toHaveCount(0);
  });

  test("the welcome banner never shows when the member's setting is off", async ({ page }) => {
    await mockApp(page, OWNER);
    await page.route("**/api/notifications", (route) =>
      route.fulfill({
        json: {
          ...BOOTSTRAP,
          user: { ...BOOTSTRAP.user, showWelcomeBanner: false },
        },
      }),
    );
    await withLoginFlag(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Dashboard/ }).first()).toBeVisible();
    await expect(page.getByText("Welcome back, B PHANI KUMAR!")).toHaveCount(0);
  });

  test("shows the announcement bar", async ({ page }) => {
    await mockApp(page, OWNER);
    await page.goto("/");
    await expect(page.getByText("Diwali offer")).toBeVisible();
    await expect(page.getByText("Buy 10 kg, get 1 kg free.")).toBeVisible();
  });

  test("shows the what's new window once", async ({ page }) => {
    await mockApp(page, OWNER);
    await page.goto("/");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("The Team Chat is here")).toBeVisible();
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("shows the onboarding checklist with the progress", async ({ page }) => {
    await mockApp(page, OWNER);
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
    await expect(page.getByText("1 of 2 steps done")).toBeVisible();
    await expect(page.getByText("Add your first item")).toBeVisible();
  });
});
