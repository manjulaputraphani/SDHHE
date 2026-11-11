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
    createdAt: new Date(Date.now() - 60_000).toISOString(),
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

let conversationsState: Array<{
  id: number;
  room: string;
  kind: "group" | "direct";
  title: string | null;
  aiPolish: boolean;
  other: { id: number; name: string; role: string } | null;
  unread: number;
  lastMessageAt: string | null;
}> = [];

const CONVERSATIONS = [
  {
    id: 1,
    room: "main",
    kind: "group" as const,
    title: null,
    aiPolish: false,
    other: null,
    unread: 0,
    lastMessageAt: "2026-11-06T09:43:00.000Z",
    lastMessage: {
      author: "B PHANI KUMAR",
      body: "₹96/kg — kal 20 kg laya tha",
      kind: "text",
      createdAt: "2026-11-06T09:43:00.000Z",
    },
  },
  {
    id: 2,
    room: "dm-1-4",
    kind: "direct" as const,
    title: null,
    aiPolish: false,
    other: { id: 4, name: "RAJU", role: "staff" },
    unread: 2,
    lastMessageAt: "2026-11-06T09:40:00.000Z",
    lastMessage: {
      author: "RAJU",
      body: "ok boss",
      kind: "text",
      createdAt: "2026-11-06T09:40:00.000Z",
    },
  },
];

const MEMBERS = [{ id: 4, name: "RAJU", role: "staff" }];

/** A group the owner made (Phase 14). */
const GROUP = {
  id: 3,
  room: "group-buy",
  kind: "group" as const,
  title: "Purchase team",
  aiPolish: false,
  other: null,
  unread: 0,
  lastMessageAt: "2026-11-06T09:50:00.000Z",
  lastMessage: {
    author: "RAJU",
    body: "Kal ka purchase ready?",
    kind: "text",
    createdAt: "2026-11-06T09:50:00.000Z",
  },
};

/** Who is in that group (the roster of the header popup). */
const GROUP_MEMBERS = [{ id: 4, name: "RAJU", role: "staff", lastSeenAt: null }];

/** Mock the whole chat API of the worker. */
async function mockChat(
  page: Page,
  member: typeof OWNER | typeof STAFF,
  options: { onDecision?: (id: number) => void; groups?: boolean; polish?: boolean; noReceipts?: boolean } = {},
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
          daily: [],
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
      },
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: member } }),
  );
  // The notification system (Phase 15) — nothing is due in the chat tests.
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: {
        user: { id: member.id, name: member.name, role: member.role, lastLoginAt: null },
        announcements: [],
        release: null,
        onboarding: { steps: [], done: 0, total: 0, completed: true },
        tours: [],
        loginHistory: [],
        session: { expiresAt: new Date(Date.now() + 1800_000).toISOString() },
      },
    }),
  );
  await page.route("**/api/notifications/login-history", (route) =>
    route.fulfill({ json: { logins: [] } }),
  );
  await page.route("**/api/chat/conversations**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: { conversation: CONVERSATIONS[1] } });
    }
    return route.fulfill({ json: { conversations: conversationsState } });
  });
  await page.route("**/api/chat/members**", (route) =>
    route.fulfill({ json: { members: MEMBERS } }),
  );
  await page.route("**/api/chat/read**", (route) =>
    route.fulfill({ json: { ok: true, unread: 0 } }),
  );
  await page.route("**/api/chat/rename**", (route) => {
    // The server is the single source of the name: the list now carries it.
    conversationsState = conversationsState.map((entry) =>
      entry.room === "main" ? { ...entry, title: "Morning team" } : entry,
    );
    return route.fulfill({ json: { ok: true, room: "main", title: "Morning team" } });
  });
  // Chat groups (Phase 14): the owner makes them and picks the members.
  await page.route("**/api/chat/groups", (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ json: { conversations: [] } });
    }
    conversationsState = [...conversationsState, GROUP];
    return route.fulfill({
      json: {
        conversation: GROUP,
        message: { id: 101, room: GROUP.room, kind: "system", body: "created the group" },
      },
    });
  });
  await page.route("**/api/chat/groups/members**", (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ json: { members: GROUP_MEMBERS } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/chat/groups/archive**", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  // AI polish (Phase 15): the owner sets the switch, the member asks for a suggestion.
  await page.route("**/api/chat/groups/polish**", (route) => {
    const request = route.request();
    const data = JSON.parse(request.postData() ?? "{}") as { room?: string; enabled?: boolean };
    conversationsState = conversationsState.map((entry) =>
      entry.room === (data.room ?? "") ? { ...entry, aiPolish: Boolean(data.enabled) } : entry,
    );
    return route.fulfill({
      json: { ok: true, room: data.room ?? "", aiPolish: Boolean(data.enabled) },
    });
  });
  await page.route("**/api/chat/polish**", (route) =>
    route.fulfill({
      json: { polished: "Please send 20 bags by tomorrow." },
    }),
  );
  // Message editing / deleting (Phase 17 + T-16.2): author-only, 15 minutes,
  // soft delete. The mocks echo the change back.
  await page.route("**/api/chat/messages/*", (route) => {
    const id = Number(route.request().url().match(/\/messages\/(\d+)/)?.[1] ?? 0);
    const data = JSON.parse(route.request().postData() ?? "{}") as { body?: string };
    if (route.request().method() === "PATCH") {
      return route.fulfill({
        json: {
          message: {
            id,
            room: "main",
            userId: member.id,
            author: member.name,
            role: member.role,
            kind: "text",
            body: String(data.body ?? ""),
            receiptId: null,
            createdAt: new Date(Date.now() - 60_000).toISOString(),
            editedAt: new Date().toISOString(),
          },
        },
      });
    }
    if (route.request().method() === "DELETE") {
      return route.fulfill({
        json: {
          message: {
            id,
            room: "main",
            userId: member.id,
            author: member.name,
            role: member.role,
            kind: "text",
            body: "",
            receiptId: null,
            createdAt: new Date(Date.now() - 60_000).toISOString(),
            deleted: true,
          },
        },
      });
    }
    return route.fallback();
  });
  // Start every test from the default conversation list (polish can be pre-armed).
  conversationsState = options.groups
    ? [...CONVERSATIONS, GROUP]
    : options.polish
      ? CONVERSATIONS.map((entry) => (entry.room === "main" ? { ...entry, aiPolish: true } : entry))
      : CONVERSATIONS;
  await page.route("**/api/auth/logout-all", (route) =>
    route.fulfill({ json: { ok: true, epoch: 2 } }),
  );
  await page.route("**/api/chat/token", (route) =>
    route.fulfill({ json: { token: "test-token", expiresAt: Date.now() + 3_600_000, user: member } }),
  );
  await page.route("**/api/chat/messages**", async (route) => {
    // Message editing / deleting have their own route above.
    if (route.request().method() === "PATCH" || route.request().method() === "DELETE") {
      return route.fallback();
    }
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        body?: string;
        aiPolished?: boolean;
      };
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
            aiPolished: body.aiPolished === true,
            createdAt: new Date().toISOString(),
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { messages: MESSAGES } });
  });
  // Message info (the 1:1 fix): the conversation's own members + receipts,
  // each with its joined user data. Never the team, never a raw "#id".
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
            readAt: infoAt,
          },
        ],
      },
    }),
  );
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
      json: options.noReceipts
        ? { receipts: [], pending: 0 }
        : { receipts: [PENDING_RECEIPT, DECIDED_RECEIPT], pending: 1 },
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
  /** The app always opens on the Dashboard now (the owner asked) — the tests
   *  walk into the chat through the sidebar, like a member does. */
  async function openChat(page: Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "Team Chat" }).click();
    await expect(page.getByRole("heading", { name: "Team Chat" })).toBeVisible();
  }

  test("shows the room, the composer and the approvals", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await expect(page.getByRole("heading", { name: "Team Chat" })).toBeVisible();
    await expect(page.getByText("Baki stock ki kya rate badha?", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Message…")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
    await expect(page.getByText("Transport bill").first()).toBeVisible();
    await expect(page.getByText("₹450.00").first()).toBeVisible();
  });

  test("opens the room on the NEWEST message, not the first one", async ({ page }) => {
    await mockChat(page, OWNER);
    // A long history so the list is really scrollable — a 2-message room
    // cannot tell top from bottom.
    const tall = Array.from({ length: 80 }, (_, i) => ({
      ...MESSAGES[0],
      id: 1000 + i,
      body: `Line ${i}`,
      createdAt: new Date(Date.now() - (80 - i) * 60_000).toISOString(),
    }));
    tall[tall.length - 1] = { ...tall[tall.length - 1], body: "NEWEST message here" };
    // Registered after mockChat → checked first; everything but GET still
    // falls through to the shared chat mock.
    await page.route("**/api/chat/messages**", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { messages: tall } });
      }
      return route.fallback();
    });
    await openChat(page);

    await expect(page.getByText("NEWEST message here")).toBeVisible();
    // The list sits within 80px of the bottom — the app's own at-bottom margin.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const el = document.querySelector<HTMLElement>(".chat-scroll");
          if (!el) return -1;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        }),
      )
      .toBeLessThanOrEqual(80);
  });

  test("keeps the address at /team-chat", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);
    await expect(page.getByRole("heading", { name: "Team Chat" })).toBeVisible();
    await expect(page).toHaveURL(/\/team-chat$/);
  });

  test("the app ALWAYS opens on the Dashboard, even from a /team-chat URL", async ({ page }) => {
    await mockChat(page, OWNER);
    // A cold open at the chat URL must still land on the Dashboard.
    await page.goto("/team-chat");

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team Chat" })).toHaveCount(0);
    // The address bar settles back to the app root.
    await expect(page).toHaveURL(/\/$/);
  });

  test("the owner can approve a receipt", async ({ page }) => {
    let decided: number | null = null;
    await mockChat(page, OWNER, { onDecision: (id) => (decided = id) });
    await openChat(page);

    const approve = page.getByRole("button", { name: "Approve" }).first();
    await expect(approve).toBeVisible();
    await approve.click();

    await expect(page.getByText(/Receipt #12 approved/)).toBeVisible();
    expect(decided).toBe(12);
  });

  test("staff never see the approvals panel (T-16.3)", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Receipt approvals" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Approvals/ })).toHaveCount(0);
  });

  test("the approvals panel hides completely when nothing is pending (T-16.3)", async ({ page }) => {
    await mockChat(page, OWNER, { noReceipts: true });
    await openChat(page);

    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Receipt approvals" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Approvals/ })).toHaveCount(0);
  });

  test("the approver's header button carries the gold count (T-16.3)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    const button = page.getByRole("button", { name: "Receipt approvals" });
    await expect(button).toBeVisible();
    await expect(button.getByText("1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
  });

  test("sends a message", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.getByPlaceholder("Message…").fill("Kal subah 6 baje khula hai");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Kal subah 6 baje khula hai", { exact: true })).toBeVisible();
  });

  test("shows the read tick on my own message", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    // The message is in the room (the list preview shows it too — use exact).
    await expect(page.getByText("₹96/kg — kal 20 kg laya tha", { exact: true })).toBeVisible();
    // Read by the other member → the two ticks, plus who read it.
    await expect(page.getByText("✓✓").first()).toBeVisible();
  });

  test("shows who is typing", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);
    await expect(page.getByText(/RAJU is typing/)).toBeVisible();
  });

  test("the owner can rename the group", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    // Phase 2: the rename lives in the ⋮ menu of the room header.
    await page.getByRole("button", { name: "Chat menu" }).click();
    await page.getByRole("button", { name: "Rename" }).click();
    const input = page.getByRole("textbox", { name: "Rename chat" });
    await input.fill("Morning team");
    await page.getByRole("button", { name: "Save" }).click();

    // The new name is asked for from the worker (shown in the room AND the list).
    await expect(page.getByText("Morning team").first()).toBeVisible();
  });

  test("the chat list has a search bar and date previews (Phase 2)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeVisible();
    // Filtering the list by name works.
    await page.getByRole("textbox", { name: "Search chats" }).fill("raju");
    await expect(page.getByRole("button", { name: /RAJU/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Shop room/ })).toHaveCount(0);
  });

  test("the composer sends with Enter (Phase 2)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    const composer = page.getByPlaceholder("Message…");
    await composer.fill("Sent with Enter");
    await composer.press("Enter");
    await expect(page.getByText("Sent with Enter", { exact: true })).toBeVisible();
  });

  test("a pasted multi-line message keeps its exact lines (T-16.1)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    const composer = page.getByPlaceholder("Message…");
    await composer.fill("Stock ok.\n\nLine two\nLast line");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The bubble carries the same lines — not one collapsed paragraph…
    const bubble = page.locator(".chat-bubble").filter({ hasText: "Stock ok." }).first();
    const text = await bubble.evaluate((el) => el.textContent ?? "");
    expect(text.startsWith("Stock ok.\n\nLine two\nLast line")).toBe(true);
    // …and it RENDERS them: the bubble must not collapse the newlines.
    const whiteSpace = await bubble.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe("pre-wrap");
  });

  test("on a touch phone the return key makes a new line — the button sends", async ({ page }) => {
    // A phone keyboard from the very first render: Playwright cannot emulate
    // a coarse pointer, so the media query is answered as a phone would.
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const mql = original(query);
        if (query !== "(pointer: coarse)") return mql;
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList;
      }) as typeof window.matchMedia;
    });
    await mockChat(page, OWNER);
    await openChat(page);

    const composer = page.getByPlaceholder("Message…");
    await composer.fill("Kal subah 6 baje");
    await composer.press("Enter");
    await composer.type("khula hai");
    // The return key made a new line — nothing has gone out yet.
    await expect(page.getByRole("note", { name: "AI polish suggestion" })).toHaveCount(0);

    await page.getByRole("button", { name: "Send", exact: true }).click();
    // One message, both lines (WhatsApp behaviour).
    await expect(
      page.locator('[aria-label*="Kal subah 6 baje"][aria-label*="khula hai"]'),
    ).toBeVisible();
  });

  test("a staff member cannot rename the group", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  });

  test("lists the conversations with their unread count", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Shop room/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /RAJU/ })).toBeVisible();
    // The private chat carries its unread count.
    await expect(page.getByRole("button", { name: /RAJU/ }).getByText("2")).toBeVisible();
  });

  test("opens a private chat from the member list", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.getByRole("heading", { name: "Start a private chat" })).toBeVisible();
    await page.getByRole("button", { name: "RAJU", exact: true }).click();

    // The private chat is marked as such.
    await expect(page.getByText("Private")).toBeVisible();
    await expect(page.getByText(/only you and RAJU can read it/)).toBeVisible();
  });

  // ---- Chat groups (Phase 14) ----
  test("the owner can make a group with the members they pick", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.getByRole("button", { name: "New group" }).click();
    await expect(page.getByRole("heading", { name: "New group" })).toBeVisible();
    await page.getByRole("textbox", { name: "Group name" }).fill("Purchase team");
    // Tick RAJU (the owner is part of the group automatically).
    await page.getByRole("button", { name: "RAJU", exact: true }).click();
    await expect(page.getByRole("button", { name: "✓ RAJU", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create group" }).click();

    // The group opens and shows in the list.
    await expect(page.getByRole("heading", { name: "Purchase team" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Purchase team/ })).toBeVisible();
  });

  test("staff cannot make a group", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    await expect(page.getByRole("button", { name: "New group" })).toHaveCount(0);
  });

  test("the owner can manage the members of a group from the header menu", async ({ page }) => {
    await mockChat(page, OWNER, { groups: true });
    await openChat(page);

    await page.getByRole("button", { name: /Purchase team/ }).click();
    await page.getByRole("button", { name: "Chat menu" }).click();
    await expect(page.getByRole("button", { name: "Add members" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove member" })).toBeVisible();

    // The shop room is not manageable this way (Rename only).
    await expect(page.getByRole("button", { name: "Archive group" })).toBeVisible();
    await page.getByRole("button", { name: "Close menu" }).click();
    await page.getByRole("button", { name: /Shop room/ }).click();
    await page.getByRole("button", { name: "Chat menu" }).click();
    await expect(page.getByRole("button", { name: "Add members" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove member" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive group" })).toHaveCount(0);
  });

  test("the owner can remove a member from a group", async ({ page }) => {
    await mockChat(page, OWNER, { groups: true });
    await openChat(page);

    await page.getByRole("button", { name: /Purchase team/ }).click();
    await page.getByRole("button", { name: "Chat menu" }).click();
    await page.getByRole("button", { name: "Remove member" }).click();
    await page.getByRole("button", { name: "RAJU", exact: true }).click();

    await expect(page.getByText(/RAJU left the group/)).toBeVisible();
  });

  test("the owner can archive a group", async ({ page }) => {
    await mockChat(page, OWNER, { groups: true });
    await openChat(page);

    await page.getByRole("button", { name: /Purchase team/ }).click();
    await page.getByRole("button", { name: "Chat menu" }).click();
    await page.getByRole("button", { name: "Archive group" }).click();

    await expect(page.getByText("Group archived")).toBeVisible();
    // The owner lands back in the shop room.
    await expect(page.getByRole("heading", { name: "Shop room" })).toBeVisible();
  });

  // ---- AI polish (Phase 15) ----
  test("the owner turns AI polish on for the shop room", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.getByRole("button", { name: "Chat menu" }).click();
    await page.getByRole("button", { name: /AI polish messages — off/ }).click();

    // Everybody in the room sees the chip at once.
    await expect(page.getByTestId("ai-polish-chip")).toBeVisible();
    await page.getByRole("button", { name: "Chat menu" }).click();
    await expect(page.getByRole("button", { name: /AI polish messages — on/ })).toBeVisible();
  });

  test("staff cannot see the AI polish switch", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    await page.getByRole("button", { name: "Chat menu" }).click();
    await expect(page.getByRole("button", { name: /AI polish messages/ })).toHaveCount(0);
  });

  test("a member confirms a polish suggestion before the message goes out", async ({ page }) => {
    await mockChat(page, STAFF, { polish: true });
    await openChat(page);

    await page.getByPlaceholder("Message…").fill("pls send 20 bags tmrw");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The suggestion card appears — nothing has been sent yet.
    await expect(page.getByRole("note", { name: "AI polish suggestion" })).toBeVisible();
    await expect(page.getByText("✨ Suggested")).toBeVisible();
    await expect(page.getByText("Please send 20 bags by tomorrow.")).toBeVisible();

    await page.getByRole("button", { name: "Send suggested" }).click();

    // The polished text goes out, marked with the spark.
    await expect(
      page.getByText("Please send 20 bags by tomorrow.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Polished by AI")).toBeVisible();
  });

  test("a room without polish sends directly — no AI call, no card", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.getByPlaceholder("Message…").fill("Kal subah 6 baje khula hai");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText("Kal subah 6 baje khula hai", { exact: true })).toBeVisible();
    await expect(page.getByRole("note", { name: "AI polish suggestion" })).toHaveCount(0);
  });

  // ---- Message editing (Phase 17) ----
  // ---- Message actions (T-16.2) ----
  test("clicking a bubble does nothing (T-16.2)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').click();

    await expect(page.getByText(/Editing message/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save edit" })).toHaveCount(0);
  });

  test("the author fixes their message from the action row, in the composer (T-16.2)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Edit message" }).click();

    // The edit lives in the composer, full width — with a clear bar.
    await expect(page.getByText("✏️ Editing message — Enter saves, Esc cancels")).toBeVisible();
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toHaveValue("₹96/kg — kal 20 kg laya tha");
    await composer.fill("₹96/kg — kal 25 kg laya tha");
    await page.getByRole("button", { name: "Save edit" }).click();

    await expect(page.getByText("₹96/kg — kal 25 kg laya tha", { exact: true })).toBeVisible();
    await expect(page.getByText("edited").first()).toBeVisible();
  });

  test("deleting my own message shows the tombstone (T-16.2)", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Delete message" }).click();
    // The in-app confirm dialog (never a browser alert).
    await expect(page.getByRole("heading", { name: "Delete this message?" })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByText("🚫 This message was deleted").first()).toBeVisible();
  });

  test("staff cannot edit or delete a message that is not theirs (T-16.2)", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await expect(page.getByRole("button", { name: "Edit message" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete message" })).toHaveCount(0);
    // Copy and Info are still there for everyone.
    await expect(page.getByRole("button", { name: "Copy message" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Message info" })).toBeVisible();
  });

  test("a message older than 15 minutes can no longer be edited (T-16.2)", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    // RAJU's own message, sent "yesterday" in the mock.
    await page.locator('[aria-label="RAJU: Baki stock ki kya rate badha?"]').hover();
    await expect(page.getByRole("button", { name: "Edit message" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete message" })).toBeVisible();
  });

  // ---- Message info (the 1:1 fix) ----
  test("the 1:1 Message info shows Read / Delivered times only", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);
    // The private chat with RAJU.
    await page.getByRole("button", { name: /RAJU/ }).click();
    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Message info" }).click();

    await expect(page.getByRole("heading", { name: "Message info" })).toBeVisible();
    // The bubble preview, then exactly two rows with their times.
    await expect(page.getByText("Read", { exact: true })).toBeVisible();
    await expect(page.getByText("Delivered", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Today, \d{2}:\d{2} (AM|PM)$/)).toHaveCount(2);
    // No Pending, no member chips, and never a raw "#id".
    await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Seen by (read)")).toHaveCount(0);
    await expect(page.getByText("Delivered to", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/#\d+/)).toHaveCount(0);
  });

  test("group Message info keeps Read by / Delivered to / Pending", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);
    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Message info" }).click();

    await expect(page.getByRole("heading", { name: "Message info" })).toBeVisible();
    await expect(page.getByText("Seen by (read)")).toBeVisible();
    await expect(page.getByText("Delivered to", { exact: true })).toBeVisible();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    // The chips carry real names from the joined user data — never "#id".
    await expect(page.getByText("RAJU").first()).toBeVisible();
    await expect(page.getByText(/#\d+/)).toHaveCount(0);
    // Nobody of this conversation is still waiting.
    await expect(page.getByText("none")).toBeVisible();
  });
});
