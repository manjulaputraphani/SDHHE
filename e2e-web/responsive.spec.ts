import { test, expect, type Page } from "@playwright/test";
import { ownerPermissions } from "../src/logic/permissions";

/**
 * Responsive audit (iPhone Safari focus).
 *
 * Every page must fit the viewport width (no horizontal scroll, no pinch
 * zoom) at 375 / 390 / 430 px, every visible field must be ≥16px so iOS
 * never auto-zooms, the drawer must close on tap, and the chat must lay
 * out one panel on a phone, two on a tablet and three on a desktop.
 *
 * The Cloudflare Worker is mocked (same pattern as notifications.spec).
 */

const OWNER = {
  id: 1,
  name: "B PHANI KUMAR",
  role: "owner" as const,
  permissions: ownerPermissions(),
};

const BOOTSTRAP = {
  user: { id: 1, name: "B PHANI KUMAR", role: "owner", lastLoginAt: null },
  announcements: [],
  release: null,
  onboarding: { steps: [], done: 0, total: 0, completed: true },
  tours: [],
  loginHistory: [],
  session: { expiresAt: new Date(Date.now() + 1800_000).toISOString() },
};

async function mockApp(page: Page) {
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
        announcements: [],
        logins: [],
      },
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: OWNER, session: BOOTSTRAP.session } }),
  );
  await page.route("**/api/notifications", (route) => route.fulfill({ json: BOOTSTRAP }));
  await page.route("**/api/notifications/welcome-banner", (route) =>
    route.fulfill({ json: { ok: true, showWelcomeBanner: false } }),
  );
  await page.route("**/api/notifications/onboarding/complete", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  // Team Chat: one shop room, no messages, nobody else online.
  await page.route("**/api/chat/conversations", (route) =>
    route.fulfill({
      json: {
        conversations: [
          {
            id: 1,
            room: "main",
            kind: "group",
            title: null,
            other: null,
            unread: 0,
            lastMessageAt: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/chat/members", (route) =>
    route.fulfill({ json: { members: [] } }),
  );
  await page.route("**/api/chat/token", (route) =>
    route.fulfill({
      json: { token: "test-token", expiresAt: Date.now() + 3600_000, user: OWNER },
    }),
  );
  await page.route("**/api/chat/messages*", (route) =>
    route.fulfill({
      json: {
        messages: [
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
        ],
      },
    }),
  );
  await page.route("**/api/chat/receipts*", (route) =>
    route.fulfill({
      json: {
        receipts: [
          {
            id: 12,
            submittedBy: 4,
            submitterName: "RAJU",
            title: "Transport bill",
            amountPaise: 45000,
            note: null,
            r2Key: "receipts/2026-11-06/12.jpg",
            filename: "transport.jpg",
            mime: "image/jpeg",
            sizeBytes: 1024,
            status: "pending",
            decidedBy: null,
            deciderName: null,
            decisionNote: null,
            decidedAt: null,
            messageId: 3,
            createdAt: "2026-11-06T09:45:00.000Z",
          },
        ],
        pending: 1,
      },
    }),
  );
}

/** The page must never be wider than the viewport (no pinch-zoom sideways). */
async function expectFits(page: Page, label: string) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    widths.scrollWidth,
    `${label}: the page is wider than the viewport (${widths.scrollWidth}px > ${widths.innerWidth}px)`,
  ).toBeLessThanOrEqual(widths.innerWidth + 1);
}

/** iOS auto-zooms on any focused text field below 16px — none may exist. */
async function expectNoAutoZoom(page: Page, label: string) {
  const small = await page.evaluate(() => {
    const skip = new Set(["checkbox", "radio", "file", "hidden", "submit", "button", "image"]);
    const fields = [
      ...document.querySelectorAll<HTMLElement>("input, select, textarea"),
    ].filter((element) => {
      if (element.offsetWidth === 0 || element.offsetHeight === 0) return false;
      if (element instanceof HTMLInputElement && skip.has(element.type)) return false;
      return true;
    });
    return fields
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        size: parseFloat(getComputedStyle(element).fontSize),
      }))
      .filter((field) => field.size < 15.5)
      .map((field) => `${field.tag} ${field.size}px`);
  });
  expect(small, `${label}: fields below 16px trigger the iOS auto-zoom: ${small.join(", ")}`).toEqual([]);
}

/** The pages every member can open (label in the nav, as shown on screen). */
const PAGES: Array<{ label: string; title: RegExp | string }> = [
  { label: "Dashboard", title: /Dashboard/ },
  { label: "New Bill", title: /New Bill/ },
  { label: "Invoices", title: /Invoices/ },
  { label: "Items", title: /Items/ },
  { label: "Purchases", title: /Purchases/ },
  { label: "Roasting", title: /Roasting/ },
  { label: "Team Chat", title: /Team Chat/ },
  { label: "Settings", title: /Settings/ },
];

/** Open a view: on a phone through the drawer, on md+ through the sidebar. */
async function goTo(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "Open menu" }).click();
    // The header toggle and the overlay share the "Close menu" label.
    await expect(page.getByRole("button", { name: "Close menu" }).first()).toBeVisible();
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: label, exact: true }).click();
  }
}

for (const width of [360, 375, 390, 430]) {
  test.describe(`a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 812 } });
    test.setTimeout(180_000);

    test("the chat fits and stays readable in the dark theme too (T-16.5)", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("sdhhe-theme", "dark"));
      await mockApp(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("button", { name: "Team Chat" }).click();
      await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
      await page.getByRole("button", { name: /Shop room/ }).click();
      await expectFits(page, `the dark chat at ${width}px`);
      // The bubble text is 14px, 1.5 line height — comfortable to read.
      const style = await page
        .locator(".chat-bubble")
        .first()
        .evaluate((el) => {
          const computed = getComputedStyle(el);
          return {
            fontSize: computed.fontSize,
            lineHeight: computed.lineHeight,
            whiteSpace: computed.whiteSpace,
          };
        });
      expect(style.fontSize).toBe("14px");
      expect(style.whiteSpace).toBe("pre-wrap");
    });

    test("every page fits the screen and has 16px+ fields", async ({ page }) => {
      await mockApp(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Dashboard/ }).first()).toBeVisible();
      for (const entry of PAGES) {
        await goTo(page, entry.label);
        await expect(page.getByRole("heading", { name: entry.title }).first()).toBeVisible();
        await expectFits(page, `${entry.label} at ${width}px`);
        await expectNoAutoZoom(page, `${entry.label} at ${width}px`);
      }
    });

    test("the drawer opens over a dark overlay and closes on a link tap", async ({ page }) => {
      await mockApp(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("button", { name: "Close menu" }).first()).toBeVisible();
      await page.getByRole("button", { name: "Invoices", exact: true }).click();
      await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /Invoices/ })).toBeVisible();
      await expectFits(page, `Invoices after the drawer at ${width}px`);
      // The overlay itself closes the drawer too (second "Close menu" = the
      // overlay). Tap the dimmed area OUTSIDE the drawer (its centre is
      // under the drawer), like a thumb would.
      await page.getByRole("button", { name: "Open menu" }).click();
      await page
        .getByRole("button", { name: "Close menu" })
        .nth(1)
        .click({ position: { x: 350, y: 400 } });
      await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
    });

    test("the chat shows one panel at a time with the composer pinned", async ({ page }) => {
      await mockApp(page);
      // The app opens on the Dashboard now — the drawer leads into the chat.
      await page.goto("/");
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("button", { name: "Team Chat" }).click();
      await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
      // The list is the screen — no room, no back arrow yet.
      await expect(page.getByRole("button", { name: "Back to chats" })).toHaveCount(0);
      await expectFits(page, `the chat list at ${width}px`);
      // Tap a chat — the room takes the whole screen with a back arrow.
      await page.getByRole("button", { name: /Shop room/ }).click();
      await expect(page.getByRole("button", { name: "Back to chats" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Chats" })).toBeHidden();
      const composer = page.getByRole("textbox", { name: "Message" });
      await expect(composer).toBeVisible();
      const fontSize = await composer.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      );
      expect(fontSize).toBeGreaterThanOrEqual(16);
      await expectFits(page, `the open room at ${width}px`);
      // The composer must sit fully inside the viewport (no page jump).
      const box = await composer.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(813);
      // The back arrow returns to the list.
      await page.getByRole("button", { name: "Back to chats" }).click();
      await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    });
  });
}

test.describe("the login screen", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test.setTimeout(60_000);

  test("fits a small phone and never auto-zooms", async ({ page }) => {
    await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: {} }));
    await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expectFits(page, "login at 375px");
    await expectNoAutoZoom(page, "login at 375px");
  });
});

test.describe("a 768px tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 } });
  test.setTimeout(60_000);

  test("the chat shows the list and the room side by side", async ({ page }) => {
    await mockApp(page);
    // The app opens on the Dashboard now — the sidebar leads into the chat.
    await page.goto("/");
    await page.getByRole("button", { name: "Team Chat" }).click();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shop room" })).toBeVisible();
    // No back arrow on a tablet — the list is always there.
    await expect(page.getByRole("button", { name: "Back to chats" })).toHaveCount(0);
    // Approvals slide over the grid, not a separate column.
    await page.getByRole("button", { name: "Approvals (1)", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expectFits(page, "the chat with the approvals slide-over at 768px");
  });
});

test.describe("a 1280px desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(60_000);

  test("the sidebar stays full height when the page is scrolled to the bottom", async ({ page }) => {
    await mockApp(page);
    await page.goto("/");
    const aside = page.locator("aside.nav-texture").first();
    await expect(aside).toBeVisible();

    // Scroll the Dashboard to the very bottom.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);

    const box = await aside.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    const viewport = await page.evaluate(() => window.innerHeight);

    // The rail is pinned to the top and its bottom edge reaches the viewport
    // bottom — no cream gap below "Sign out".
    expect(box.top).toBeLessThanOrEqual(1);
    expect(Math.abs(box.bottom - viewport)).toBeLessThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(viewport - 1);
  });

  test("the sidebar footer stays pinned at the bottom on a short laptop screen", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 700 });
    await mockApp(page);
    await page.goto("/");
    const aside = page.locator("aside.nav-texture").first();
    await expect(aside).toBeVisible();

    const signOut = aside.getByRole("button", { name: "Sign out" });
    const box = await signOut.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    const viewport = await page.evaluate(() => window.innerHeight);
    // The footer sits at the very bottom of the rail; the nav scrolls inside.
    expect(box.bottom).toBeLessThanOrEqual(viewport);
    expect(viewport - box.bottom).toBeLessThanOrEqual(64);
  });

  test("the chat shows all three panels", async ({ page }) => {
    await mockApp(page);
    // The app opens on the Dashboard now — the sidebar leads into the chat.
    await page.goto("/");
    await page.getByRole("button", { name: "Team Chat" }).click();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shop room" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
    await expectFits(page, "the chat at 1280px");
  });

  test("the viewport meta allows pinch zoom and respects the notch", async ({ page }) => {
    await mockApp(page);
    await page.goto("/");
    const content = await page.evaluate(
      () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? "",
    );
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
    expect(content).toContain("viewport-fit=cover");
    expect(content).not.toContain("maximum-scale");
    expect(content).not.toContain("user-scalable=no");
  });
});
