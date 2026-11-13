/**
 * The mobile layout (max-width 767px ONLY) — the matrix at 320/360/375/390/
 * 412/430px in all three themes (light / dark / contrast).
 *
 * Covers: no horizontal scroll, the bottom navigation (+ hidden states), the
 * full-screen chat, back navigation (More sheet first), badge sync from the
 * ONE shared unread store, and no content hidden behind the bar.
 *
 * NOTE: iPhone Safari (visualViewport / safe areas) and Android Chrome
 * (interactive-widget=resizes-content) need a real device pass — the
 * automation below covers Chromium at phone sizes.
 */
import { expect, test, type Page } from "@playwright/test";
import { ownerPermissions } from "../src/logic/permissions";

const OWNER = { id: 1, name: "B PHANI KUMAR", role: "owner" as const, permissions: ownerPermissions() };

const BOOTSTRAP = {
  user: { id: 1, name: "B PHANI KUMAR", role: "owner", lastLoginAt: null },
  announcements: [],
  release: null,
  onboarding: { steps: [], done: 0, total: 0, completed: true },
  tours: [],
  loginHistory: [],
  session: { expiresAt: new Date(Date.now() + 1800_000).toISOString() },
};

const CONVERSATIONS = [
  {
    id: 1,
    room: "main",
    kind: "group" as const,
    title: null,
    aiPolish: false,
    other: null,
    unread: 2,
    lastMessageAt: new Date().toISOString(),
    lastMessage: {
      id: 2,
      userId: 4,
      author: "RAJU",
      body: "Stock ready, boss",
      kind: "text",
      createdAt: new Date().toISOString(),
    },
  },
  {
    id: 2,
    room: "dm-1-4",
    kind: "direct" as const,
    title: null,
    aiPolish: false,
    other: { id: 4, name: "RAJU", role: "staff" },
    unread: 0,
    lastMessageAt: new Date().toISOString(),
    lastMessage: {
      id: 2,
      userId: 1,
      author: "B PHANI KUMAR",
      body: "On my way",
      kind: "text",
      createdAt: new Date().toISOString(),
    },
  },
];

const MESSAGES = [
  {
    id: 1,
    room: "main",
    userId: 4,
    author: "RAJU",
    role: "staff",
    kind: "text",
    body: "Stock ready, boss",
    receiptId: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    room: "main",
    userId: 1,
    author: "B PHANI KUMAR",
    role: "owner",
    kind: "text",
    body: "On my way",
    receiptId: null,
    createdAt: new Date().toISOString(),
  },
];

async function mockMobile(page: Page) {
  // ONE catch-all answers every screen; the two specific routes register
  // after it (later = wins) with the shapes the screens expect.
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/api/chat/conversations"))
      return route.fulfill({ json: { conversations: CONVERSATIONS } });
    if (url.includes("/api/chat/messages"))
      return route.fulfill({ json: { messages: MESSAGES } });
    if (url.includes("/api/chat/members"))
      return route.fulfill({ json: { members: [{ id: 4, name: "RAJU", role: "staff" }] } });
    if (url.includes("/api/chat/receipts"))
      return route.fulfill({ json: { receipts: [], pending: 0 } });
    return route.fulfill({
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
        announcements: [],
        logins: [],
      },
    });
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: OWNER, session: BOOTSTRAP.session } }),
  );
  await page.route("**/api/notifications", (route) => route.fulfill({ json: BOOTSTRAP }));
  await page.routeWebSocket("**/api/chat/ws**", (socket) => {
    socket.onMessage((message) => {
      if (message === "ping") socket.send("pong");
    });
  });
}

/** The page must never be wider than the viewport (no pinch-zoom sideways). */
async function expectFits(page: Page, label: string) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    widths.scrollWidth,
    `${label}: wider than the viewport (${widths.scrollWidth}px > ${widths.innerWidth}px)`,
  ).toBeLessThanOrEqual(widths.innerWidth + 1);
}

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.locator(".mobile-dash-bar")).toBeVisible();
}

async function openChats(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Chats", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
}

for (const width of [320, 360, 375, 390, 412, 430]) {
  for (const theme of ["light", "dark", "contrast"] as const) {
    test.describe(`${width}px · ${theme}`, () => {
      test.use({ viewport: { width, height: 812 } });
      test.setTimeout(60_000);

      test("nav, full-screen chat, back and badge behave", async ({ page }) => {
        await page.addInitScript((mode) => window.localStorage.setItem("sdhhe-theme", mode), theme);
        await mockMobile(page);
        await openApp(page);
        await expectFits(page, `${theme} dashboard at ${width}px`);

        // ---- The bottom navigation: 5 labelled tabs, nothing behind it ----
        const nav = page.getByRole("navigation", { name: "Main" });
        await expect(nav).toBeVisible();
        for (const tab of ["Home", "New Bill", "Chats", "Stock", "More"]) {
          await expect(nav.getByRole("button", { name: tab, exact: true })).toBeVisible();
        }
        // Content carries the bar's height + the safe area.
        const pad = await page
          .locator("main")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
        expect(pad, `${theme} at ${width}px: content hides behind the bar`).toBeGreaterThanOrEqual(64);

        // ---- The Chats tab badge comes from the shared unread store ----
        await expect(nav.getByRole("button", { name: "Chats", exact: true })).toContainText("2");

        // ---- The chat list ----
        await openChats(page);
        await expectFits(page, `${theme} chat list at ${width}px`);

        // ---- The open chat is FULL screen: no app header, no bottom bar ----
        await page.getByRole("button", { name: /Shop room/ }).click();
        await expect(page.getByRole("button", { name: "Back to chats" })).toBeVisible();
        await expect(nav).toHaveCount(0); // the bar hides inside an open chat
        // The app header (logo + brand) hides too — the chat header stays.
        await expect(page.getByRole("banner").filter({ hasText: "SDHHE" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Voice call" })).toBeVisible();
        await expect(page.locator('[aria-label="B PHANI KUMAR: On my way"]')).toBeVisible();
        const composer = page.getByRole("textbox", { name: "Message" });
        const box = await composer.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y + box!.height, `${theme} at ${width}px: composer under the fold`).toBeLessThanOrEqual(813);
        await expectFits(page, `${theme} open chat at ${width}px`);

        // ---- Back: chat → chat list (the app header and bar return) ----
        await page.getByRole("button", { name: "Back to chats" }).click();
        await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
        await expect(nav).toBeVisible();
        await expect(page.getByRole("banner").filter({ hasText: "SDHHE" }).first()).toBeVisible();
      });
    });
  }
}

test.describe("mobile details", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.setTimeout(60_000);

  test("the More sheet lists every other screen, the theme and Sign out", async ({ page }) => {
    await mockMobile(page);
    await openApp(page);
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    for (const label of ["Invoices", "Items", "Purchases", "Roasting", "Stock Check", "Customers", "Expenses", "Activity", "Settings"]) {
      await expect(sheet.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    // The tabs' screens are not listed twice — and Sign out lives here now.
    await expect(sheet.getByRole("button", { name: "New Bill", exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectFits(page, "the More sheet at 375px");
  });

  test("the More sheet closes on back before anything else leaves", async ({ page }) => {
    await mockMobile(page);
    await openApp(page);
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
    await expect(page.locator(".mobile-dash-bar")).toBeVisible();
  });

  test("the 1:1-style Message info shows Read / Delivered rows only", async ({ page }) => {
    const infoAt = new Date(Date.now() - 60_000).toISOString();
    await page.route("**/api/chat/messages/*/info**", (route) =>
      route.fulfill({
        json: {
          recipients: [{ id: 4, name: "RAJU", initials: "RA", avatar: null }],
          receipts: [
            {
              userId: 4,
              user: { id: 4, name: "RAJU", initials: "RA", avatar: null },
              deliveredAt: infoAt,
              readAt: null,
            },
          ],
        },
      }),
    );
    await mockMobile(page);
    await openApp(page);
    await openChats(page);
    // The private chat with RAJU — a 1:1 Message info has no member lists.
    await page.getByRole("button", { name: /^RA RAJU/ }).click();
    await page.locator('[aria-label="B PHANI KUMAR: On my way"]').hover();
    await page.getByRole("button", { name: "Message info" }).click();

    await expect(page.getByRole("heading", { name: "Message info" })).toBeVisible();
    await expect(page.getByText("Read", { exact: true })).toBeVisible();
    await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/#\d+/)).toHaveCount(0);
    await expectFits(page, "Message info at 375px");
  });

  test("Group info opens from the chat header and hides the bar", async ({ page }) => {
    await mockMobile(page);
    await openApp(page);
    await openChats(page);
    await page.getByRole("button", { name: /Shop room/ }).click();
    await page.getByRole("button", { name: "Chat menu" }).click();
    await page.getByRole("menuitem", { name: "Group info" }).click();

    await expect(page.getByRole("heading", { name: "Group info" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.locator(".info-page__sectionlabel")).toBeVisible();
    await expectFits(page, "Group info at 375px");
    // Back: Group info → the open chat.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Group info" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Back to chats" })).toBeVisible();
  });
});
