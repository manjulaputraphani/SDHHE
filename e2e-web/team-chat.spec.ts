import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_ROLE_PERMISSIONS, ownerPermissions } from "../src/logic/permissions";

/**
 * The Team Chat screen (Phase 12).
 *
 * The Cloudflare Worker is mocked here: the history, the receipts and the
 * live socket. The suite therefore runs without a database and without a
 * Cloudflare account.
 */

const OWNER = {
  id: 1,
  name: "B PHANI KUMAR",
  role: "owner" as const,
  permissions: ownerPermissions(),
};

const STAFF = {
  id: 4,
  name: "RAJU",
  role: "staff" as const,
  permissions: DEFAULT_ROLE_PERMISSIONS.staff,
};

const MESSAGES = [
  {
    id: 1,
    room: "main",
    userId: 4,
    author: "RAJU",
    role: "staff",
    kind: "text" as const,
    body: "Baki stock ki kya rate badha?",
    receiptId: null,
    createdAt: "2026-11-06T09:42:00.000Z",
  },
  {
    id: 2,
    room: "main",
    userId: 1,
    author: "B PHANI KUMAR",
    role: "owner",
    kind: "text" as const,
    body: "₹96/kg — kal 20 kg laya tha",
    receiptId: null,
    createdAt: "2026-11-06T09:43:00.000Z",
    // Phase 14: the other member has received and read it.
    deliveredBy: [4],
    readBy: [4],
  },
];

const PENDING_RECEIPT = {
  id: 12,
  submittedBy: 4,
  submitterName: "RAJU",
  title: "Transport bill",
  amountPaise: 45000,
  note: "Paid today",
  r2Key: "receipts/2026-11-06/12.jpg",
  filename: "transport.jpg",
  mime: "image/jpeg",
  sizeBytes: 1024,
  status: "pending" as const,
  decidedBy: null,
  deciderName: null,
  decisionNote: null,
  decidedAt: null,
  messageId: 3,
  createdAt: "2026-11-06T09:45:00.000Z",
};

const DECIDED_RECEIPT = {
  ...PENDING_RECEIPT,
  id: 11,
  title: "Loading charges",
  amountPaise: 120000,
  status: "approved" as const,
  decidedBy: 1,
  deciderName: "B PHANI KUMAR",
  decidedAt: "2026-11-06T08:02:00.000Z",
};

const CONVERSATIONS = [
  {
    id: 1,
    room: "main",
    kind: "group" as const,
    other: null,
    unread: 0,
    lastMessageAt: "2026-11-06T09:43:00.000Z",
  },
  {
    id: 2,
    room: "dm-1-4",
    kind: "direct" as const,
    other: { id: 4, name: "RAJU", role: "staff" },
    unread: 2,
    lastMessageAt: "2026-11-06T09:40:00.000Z",
  },
];

const MEMBERS = [{ id: 4, name: "RAJU", role: "staff" }];

/** Mock the whole chat API of the worker. */
async function mockChat(
  page: Page,
  member: typeof OWNER | typeof STAFF,
  options: { onDecision?: (id: number) => void } = {},
) {
  // Anything else the app asks for (the shop details, the activity, ...) is
  // answered with an empty result — a 401 would sign the app out again and a
  // missing list would break the screen.
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
        stats: {
          today_sales: 0,
          month_sales: 0,
          month_profit: 0,
          month_expenses: 0,
          credit_paise: 0,
          credit_bills: 0,
          low_stock: 0,
        },
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
        },
      },
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: member } }),
  );
  await page.route("**/api/chat/conversations**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: { conversation: CONVERSATIONS[1] } });
    }
    return route.fulfill({ json: { conversations: CONVERSATIONS } });
  });
  await page.route("**/api/chat/members**", (route) =>
    route.fulfill({ json: { members: MEMBERS } }),
  );
  await page.route("**/api/chat/read**", (route) =>
    route.fulfill({ json: { ok: true, unread: 0 } }),
  );
  await page.route("**/api/chat/token", (route) =>
    route.fulfill({ json: { token: "test-token", expiresAt: Date.now() + 3_600_000, user: member } }),
  );
  await page.route("**/api/chat/messages**", async (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { body?: string };
      await route.fulfill({
        json: {
          message: {
            id: 99,
            room: "main",
            userId: member.id,
            author: member.name,
            role: member.role,
            kind: "text",
            body: body.body ?? "",
            receiptId: null,
            createdAt: new Date().toISOString(),
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { messages: MESSAGES } });
  });
  await page.route("**/api/chat/receipts**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.url().endsWith("/decision")) {
      const id = Number(request.url().match(/\/receipts\/(\d+)\/decision/)?.[1] ?? 0);
      options.onDecision?.(id);
      await route.fulfill({
        json: {
          receipt: { ...PENDING_RECEIPT, id, status: "approved", deciderName: member.name },
          message: { ...MESSAGES[0], id: 100, kind: "system", body: "approved" },
        },
      });
      return;
    }
    await route.fulfill({
      json: { receipts: [PENDING_RECEIPT, DECIDED_RECEIPT], pending: 1 },
    });
  });
  // The live room.
  await page.routeWebSocket("**/api/chat/ws**", (socket) => {
    socket.onMessage((message) => {
      if (message === "ping") socket.send("pong");
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        user: { id: member.id, name: member.name, role: member.role },
        presence: [{ id: member.id, name: member.name, role: member.role }],
      }),
    );
    socket.send(
      JSON.stringify({ type: "typing", userId: 4, name: "RAJU" }),
    );
  });
}

test.describe("Team Chat", () => {
  test("shows the room, the composer and the approvals", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");

    await expect(page.getByRole("heading", { name: "Team Chat" })).toBeVisible();
    await expect(page.getByText("Baki stock ki kya rate badha?")).toBeVisible();
    await expect(page.getByPlaceholder("Message…")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
    await expect(page.getByText("Transport bill").first()).toBeVisible();
    await expect(page.getByText("₹450.00").first()).toBeVisible();
  });

  test("keeps the address at /team-chat", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");
    await expect(page.getByRole("heading", { name: "Team Chat" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/team-chat");
  });

  test("the owner can approve a receipt", async ({ page }) => {
    let decided: number | null = null;
    await mockChat(page, OWNER, { onDecision: (id) => (decided = id) });
    await page.goto("/team-chat");

    const approve = page.getByRole("button", { name: "Approve" }).first();
    await expect(approve).toBeVisible();
    await approve.click();

    await expect(page.getByText(/Receipt #12 approved/)).toBeVisible();
    expect(decided).toBe(12);
  });

  test("staff sees the receipt but cannot approve it", async ({ page }) => {
    await mockChat(page, STAFF);
    await page.goto("/team-chat");

    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
    await expect(page.getByText("Transport bill").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await expect(page.getByText("Waiting for an owner")).toBeVisible();
  });

  test("sends a message", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");

    await page.getByPlaceholder("Message…").fill("Kal subah 6 baje khula hai");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Kal subah 6 baje khula hai")).toBeVisible();
  });

  test("shows the read tick on my own message", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");

    await expect(page.getByText("₹96/kg — kal 20 kg laya tha")).toBeVisible();
    // Read by the other member → the three ticks.
    await expect(page.getByText("✓✓✓")).toBeVisible();
  });

  test("shows who is typing", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");
    await expect(page.getByText(/RAJU is typing/)).toBeVisible();
  });

  test("lists the conversations with their unread count", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");

    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Shop room/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /RAJU/ })).toBeVisible();
    // The private chat carries its unread count.
    await expect(page.getByRole("button", { name: /RAJU/ }).getByText("2")).toBeVisible();
  });

  test("opens a private chat from the member list", async ({ page }) => {
    await mockChat(page, OWNER);
    await page.goto("/team-chat");

    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.getByRole("heading", { name: "Start a private chat" })).toBeVisible();
    await page.getByRole("button", { name: "RAJU", exact: true }).click();

    // The private chat is marked as such.
    await expect(page.getByText("Private")).toBeVisible();
    await expect(page.getByText(/only you and RAJU can read it/)).toBeVisible();
  });
});
