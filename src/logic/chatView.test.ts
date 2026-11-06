/**
 * Tests for the Phase 2 chat-redesign view helpers (web Team Chat).
 * Pure functions — no database, no component.
 */
import { describe, expect, it } from "vitest";
import {
  chatDaySections,
  conversationName,
  filterConversations,
  filterMessages,
  formatChatListTimeRow as formatChatListTime,
  type ConversationListEntry,
  type ViewMessage,
} from "./chatView";

function message(id: number, createdAt: string, body = `m${id}`, author = "RAJU"): ViewMessage {
  return {
    id,
    author,
    userId: 4,
    kind: "text",
    body,
    receiptId: null,
    createdAt,
  };
}

describe("chatDaySections", () => {
  const now = new Date(2026, 10, 6, 12, 0); // Fri 6 Nov 2026, 12:00 local

  it("puts same-day messages in one section labelled Today", () => {
    const sections = chatDaySections(
      [
        message(1, new Date(2026, 10, 6, 9, 0).toISOString()),
        message(2, new Date(2026, 10, 6, 10, 30).toISOString()),
      ],
      now,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toBe("Today");
    expect(sections[0]!.messages.map((m) => m.id)).toEqual([1, 2]);
  });

  it("splits today / yesterday / older days with the right labels", () => {
    const sections = chatDaySections(
      [
        message(3, new Date(2026, 10, 3, 18, 0).toISOString()),
        message(1, new Date(2026, 10, 5, 23, 50).toISOString()),
        message(2, new Date(2026, 10, 6, 0, 5).toISOString()),
      ],
      now,
    );
    expect(sections.map((s) => s.label)).toEqual(["Tue, 3 Nov", "Yesterday", "Today"]);
    expect(sections[0]!.messages.map((m) => m.id)).toEqual([3]);
    expect(sections[2]!.messages.map((m) => m.id)).toEqual([2]);
  });

  it("keys the sections by calendar day so React can use them as keys", () => {
    const sections = chatDaySections(
      [
        message(1, new Date(2026, 10, 6, 1, 0).toISOString()),
        message(2, new Date(2026, 10, 5, 23, 0).toISOString()),
      ],
      now,
    );
    expect(sections[0]!.key).not.toBe(sections[1]!.key);
  });

  it("returns an empty list for no messages", () => {
    expect(chatDaySections([], now)).toEqual([]);
  });
});

describe("conversationName", () => {
  it("names a group by its title, falling back to Shop room", () => {
    expect(conversationName({ room: "main", kind: "group", title: "Morning team" })).toBe(
      "Morning team",
    );
    expect(conversationName({ room: "main", kind: "group", title: null })).toBe("Shop room");
    expect(conversationName({ room: "main", kind: "group", title: "   " })).toBe("Shop room");
  });

  it("names a private chat after the other member", () => {
    expect(
      conversationName({ room: "dm-1-4", kind: "direct", other: { name: "RAJU" } }),
    ).toBe("RAJU");
    expect(conversationName({ room: "dm-1-4", kind: "direct", other: null })).toBe("dm-1-4");
  });
});

describe("filterConversations", () => {
  const list: ConversationListEntry[] = [
    { room: "main", kind: "group", title: null, other: null },
    { room: "dm-1-4", kind: "direct", title: null, other: { name: "Raju" } },
    { room: "dm-1-7", kind: "direct", title: null, other: { name: "Anita" } },
  ];

  it("returns everything for an empty query", () => {
    expect(filterConversations(list, "")).toHaveLength(3);
    expect(filterConversations(list, "   ")).toHaveLength(3);
  });

  it("matches the name case-insensitively", () => {
    expect(filterConversations(list, "raju").map((c) => c.room)).toEqual(["dm-1-4"]);
    expect(filterConversations(list, "SHOP").map((c) => c.room)).toEqual(["main"]);
  });

  it("matches a renamed group by its title", () => {
    const renamed: ConversationListEntry[] = [
      { room: "main", kind: "group", title: "Morning team", other: null },
    ];
    expect(filterConversations(renamed, "morning")).toHaveLength(1);
  });
});

describe("filterMessages", () => {
  const messages = [
    message(1, new Date(2026, 10, 6, 9).toISOString(), "rice 20 kg", "RAJU"),
    message(2, new Date(2026, 10, 6, 9, 1).toISOString(), "dal rate?", "B PHANI KUMAR"),
  ];

  it("matches the body and the author, case-insensitive", () => {
    expect(filterMessages(messages, "RICE").map((m) => m.id)).toEqual([1]);
    expect(filterMessages(messages, "phani").map((m) => m.id)).toEqual([2]);
  });

  it("returns everything for a blank query", () => {
    expect(filterMessages(messages, " ")).toHaveLength(2);
  });
});

describe("formatChatListTime", () => {
  const now = new Date(2026, 10, 6, 15, 0); // Fri 6 Nov 2026, 15:00

  it("shows the clock time for today", () => {
    expect(formatChatListTime(new Date(2026, 10, 6, 9, 42).toISOString(), now)).toBe("09:42");
  });

  it("shows Yesterday for yesterday", () => {
    expect(formatChatListTime(new Date(2026, 10, 5, 23, 1).toISOString(), now)).toBe("Yesterday");
  });

  it("shows the weekday and short date for older days", () => {
    expect(formatChatListTime(new Date(2026, 10, 3, 8, 0).toISOString(), now)).toBe("Tue, 3 Nov");
  });

  it("shows nothing without a message", () => {
    expect(formatChatListTime(null, now)).toBe("");
  });
});
