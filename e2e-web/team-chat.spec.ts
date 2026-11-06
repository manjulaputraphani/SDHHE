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
  options: { onDecision?: (id: number) => void; groups?: boolean; polish?: boolean } = {},
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
  // Message editing (Phase 17): the author fixes their own text.
  await page.route("**/api/chat/messages/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const id = Number(route.request().url().match(/\/messages\/(\d+)/)?.[1] ?? 0);
    const data = JSON.parse(route.request().postData() ?? "{}") as { body?: string };
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
    // Message editing (Phase 17) has its own route above.
    if (route.request().method() === "PATCH") return route.fallback();
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

  test("staff sees the receipt but cannot approve it", async ({ page }) => {
    await mockChat(page, STAFF);
    await openChat(page);

    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toBeVisible();
    await expect(page.getByText("Transport bill").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await expect(page.getByText("Waiting for an owner")).toBeVisible();
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
  test("the author can fix their own message", async ({ page }) => {
    await mockChat(page, OWNER);
    await openChat(page);

    // Tap my own message (#2 — B PHANI KUMAR wrote it).
    await page
      .locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]')
      .click();
    const editor = page.getByRole("textbox", { name: "Edit message" });
    await expect(editor).toBeVisible();
    await editor.fill("₹96/kg — kal 25 kg laya tha");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("₹96/kg — kal 25 kg laya tha", { exact: true })).toBeVisible();
    await expect(page.getByText("edited").first()).toBeVisible();
  });
});
