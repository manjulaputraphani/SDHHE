import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_ROLE_PERMISSIONS, ownerPermissions } from "../src/logic/permissions";

/**
 * Chat polish (Phase 16) — the end-to-end scenarios the plan lists.
 *
 * The Cloudflare Worker is mocked, like the other chat suites. This file
 * covers: multi-line paste, no-op click, edit via the action icon, soft
 * delete, the 15-minute / ownership rules, the approvals button with its
 * badge, and reply + reaction.
 */

const OWNER = { id: 1, name: "B PHANI KUMAR", role: "owner" as const, permissions: ownerPermissions() };
const STAFF = { id: 4, name: "RAJU", role: "staff" as const, permissions: DEFAULT_ROLE_PERMISSIONS.staff };

/** Message #2 is the owner's, recent (editable). #1 is RAJU's, old. */
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
    createdAt: "2026-11-01T09:42:00.000Z",
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
    deliveredBy: [4],
    readBy: [4],
  },
];

const CONVERSATIONS = [
  {
    id: 1,
    room: "main",
    kind: "group" as const,
    title: null,
    aiPolish: false,
    other: null,
    unread: 0,
    lastMessageAt: null,
    lastMessage: null,
  },
];

async function mockApp(page: Page, member: typeof OWNER | typeof STAFF, options: { noReceipts?: boolean } = {}) {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        shop: { name: "SDHHE", email: "" },
        items: [], bills: [], activity: [], members: [], users: [], roles: [], expenses: [],
        purchases: [], roastings: [], investments: [], suppliers: [], customers: [], entries: [],
        daily: [], categories: [], dues: [], payments: [], usage: [], sessions: [], receipts: [],
        messages: [], pending: 0, stats: {},
      },
    }),
  );
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: member } }));
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: {
        user: { id: member.id, name: member.name, role: member.role, lastLoginAt: null },
        announcements: [], release: null,
        onboarding: { steps: [], done: 0, total: 0, completed: true },
        tours: [], loginHistory: [],
        session: { expiresAt: new Date(Date.now() + 1800_000).toISOString() },
      },
    }),
  );
  await page.route("**/api/chat/conversations**", (route) =>
    route.fulfill({ json: { conversations: CONVERSATIONS } }),
  );
  await page.route("**/api/chat/members**", (route) =>
    route.fulfill({ json: { members: [{ id: 4, name: "RAJU", role: "staff", lastSeenAt: null }] } }),
  );
  await page.route("**/api/chat/groups/members**", (route) =>
    route.fulfill({ json: { members: [{ id: 4, name: "RAJU", role: "staff", lastSeenAt: null }] } }),
  );
  await page.route("**/api/chat/pins**", (route) => route.fulfill({ json: { pins: [] } }));
  await page.route("**/api/chat/read**", (route) => route.fulfill({ json: { ok: true, unread: 0 } }));
  await page.route("**/api/chat/token", (route) =>
    route.fulfill({ json: { token: "test-token", expiresAt: Date.now() + 3600_000, user: member } }),
  );
  await page.route("**/api/chat/receipts*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: options.noReceipts ? { receipts: [], pending: 0 } : {
          receipts: [
            {
              id: 12, submittedBy: 4, submitterName: "RAJU", title: "Transport bill",
              amountPaise: 45000, note: null, r2Key: "receipts/12.jpg", filename: "t.jpg",
              mime: "image/jpeg", sizeBytes: 1024, status: "pending", decidedBy: null,
              deciderName: null, decisionNote: null, decidedAt: null, messageId: 3,
              createdAt: "2026-11-06T09:45:00.000Z",
            },
          ],
          pending: 1,
        },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  // Sending echoes the message back, including replyToId and aiPolished.
  await page.route("**/api/chat/messages**", async (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      return route.fulfill({
        json: {
          message: {
            id: 99, room: "main", userId: member.id, author: member.name, role: member.role,
            kind: "text", body: String(body.body ?? ""), receiptId: null,
            aiPolished: body.aiPolished === true, replyToId: body.replyToId ?? undefined,
            createdAt: new Date().toISOString(),
          },
        },
      });
    }
    return route.fulfill({ json: { messages: MESSAGES } });
  });
  await page.route("**/api/chat/messages/*", (route) => {
    const id = Number(route.request().url().match(/\/messages\/(\d+)/)?.[1] ?? 0);
    if (route.request().method() === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { body?: string };
      return route.fulfill({
        json: {
          message: {
            id, room: "main", userId: member.id, author: member.name, role: member.role,
            kind: "text", body: String(body.body ?? ""), receiptId: null,
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
            id, room: "main", userId: member.id, author: member.name, role: member.role,
            kind: "text", body: "", receiptId: null,
            createdAt: new Date(Date.now() - 60_000).toISOString(), deleted: true,
          },
        },
      });
    }
    return route.fallback();
  });
  await page.route("**/api/chat/reactions/*", (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ json: { reactions: [] } });
    const body = JSON.parse(route.request().postData() ?? "{}") as { emoji?: string };
    return route.fulfill({
      json: {
        reactions: [{ emoji: String(body.emoji ?? "👍"), userId: member.id, name: member.name }],
      },
    });
  });
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
  });
}

async function openChat(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Team Chat" }).click();
  await expect(page.getByRole("heading", { name: "Team Chat" })).toBeVisible();
}

test.describe("Chat polish (Phase 16)", () => {
  test("a pasted multi-line message keeps its exact lines", async ({ page }) => {
    await mockApp(page, OWNER);
    await openChat(page);

    await page.getByPlaceholder("Message…").fill("Line one\n\nLine two\nLine three");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const bubble = page.locator(".chat-bubble").filter({ hasText: "Line one" }).first();
    await expect(bubble).toBeVisible();
    const text = await bubble.evaluate((el) => el.textContent ?? "");
    expect(text.startsWith("Line one\n\nLine two\nLine three")).toBe(true);
    expect(await bubble.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
  });

  test("clicking a bubble does nothing", async ({ page }) => {
    await mockApp(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').click();
    await expect(page.getByText(/Editing message/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save edit" })).toHaveCount(0);
  });

  test("editing via the action icon shows the edited label", async ({ page }) => {
    await mockApp(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Edit message" }).click();
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toHaveValue("₹96/kg — kal 20 kg laya tha");
    await composer.fill("₹96/kg — kal 25 kg laya tha");
    await page.getByRole("button", { name: "Save edit" }).click();

    await expect(page.getByText("₹96/kg — kal 25 kg laya tha", { exact: true })).toBeVisible();
    await expect(page.getByText("edited").first()).toBeVisible();
  });

  test("deleting my own message shows the tombstone", async ({ page }) => {
    await mockApp(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Delete message" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByText("🚫 This message was deleted").first()).toBeVisible();
  });

  test("staff cannot edit after 15 minutes or delete others' messages", async ({ page }) => {
    await mockApp(page, STAFF);
    await openChat(page);

    // The owner's recent message: not theirs — no edit, no delete.
    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await expect(page.getByRole("button", { name: "Edit message" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete message" })).toHaveCount(0);

    // Their own, but weeks old: no edit (15 minutes), delete still offered.
    await page.locator('[aria-label="RAJU: Baki stock ki kya rate badha?"]').hover();
    await expect(page.getByRole("button", { name: "Edit message" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete message" })).toBeVisible();
  });

  test("the approvals button hides with 0 pending and shows the count with 1", async ({ page }) => {
    await mockApp(page, OWNER, { noReceipts: true });
    await openChat(page);
    await expect(page.getByRole("button", { name: "Receipt approvals" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Receipt approvals" })).toHaveCount(0);

    await mockApp(page, OWNER);
    await page.goto("/");
    await page.getByRole("button", { name: "Team Chat" }).click();
    const button = page.getByRole("button", { name: "Receipt approvals" });
    await expect(button).toBeVisible();
    await expect(button.getByText("1")).toBeVisible();
  });

  test("a reply quotes the original inside the bubble", async ({ page }) => {
    await mockApp(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "Reply to message" }).click();
    await expect(page.getByText(/↩ Replying to B PHANI KUMAR/)).toBeVisible();

    await page.getByPlaceholder("Message…").fill("Ha, perfect");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The reply went out with the quote of the original.
    const reply = page.locator(".chat-bubble").filter({ hasText: "Ha, perfect" }).first();
    await expect(reply).toBeVisible();
    await expect(reply.getByText("₹96/kg — kal 20 kg laya tha")).toBeVisible();
  });

  test("a reaction appears as a chip and my click toggles it", async ({ page }) => {
    await mockApp(page, OWNER);
    await openChat(page);

    await page.locator('[aria-label="B PHANI KUMAR: ₹96/kg — kal 20 kg laya tha"]').hover();
    await page.getByRole("button", { name: "React to message" }).click();
    await page.getByRole("button", { name: "React 👍" }).click();

    await expect(page.getByRole("button", { name: "1 👍" })).toBeVisible();

    // The same emoji again removes my reaction (the mock answers empty).
    await page.getByRole("button", { name: "1 👍" }).click();
    await expect(page.getByRole("button", { name: "1 👍" })).toHaveCount(0);
  });
});
