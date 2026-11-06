import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamChat from "./TeamChat";
import { DbProvider } from "../lib/db-context";
import { getChatWorkerUrl } from "../db/settings";
import { getSecret } from "../lib/secrets";
import { chatConversations, chatMessages, chatReceipts, chatSend } from "../lib/chatClient";

vi.mock("../db/permissions", () => ({
  getCurrentPermissions: vi.fn(() => ({ chat: { view: true, create: true, edit: true, delete: false, export: false } })),
  can: vi.fn(() => true),
}));

vi.mock("../db/client", () => ({
  getDb: vi.fn(() => ({})),
  getTxDb: vi.fn(),
  withTransaction: vi.fn(),
  pingDb: vi.fn(),
}));

vi.mock("../db/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/settings")>();
  return { ...actual, getChatWorkerUrl: vi.fn(async () => "") };
});

vi.mock("../lib/secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/secrets")>();
  return { ...actual, getSecret: vi.fn(async () => null) };
});

vi.mock("../lib/chatClient", () => ({
  chatMessages: vi.fn(),
  chatReceipts: vi.fn(),
  chatSend: vi.fn(),
  chatDecide: vi.fn(),
  chatUpload: vi.fn(),
  chatConversations: vi.fn(async () => [
    { id: 1, room: "main", kind: "group", other: null, unread: 0, lastMessageAt: null },
  ]),
  chatMembers: vi.fn(async () => []),
  startChatConversation: vi.fn(),
  markChatRead: vi.fn(async () => 0),
  conversationText: vi.fn(() => "Team Chat"),
  chatReceiptUrl: vi.fn(() => "https://worker.dev/api/chat/receipts/key"),
  normaliseWorkerUrl: vi.fn((url: string) => url),
  openChatSocket: vi.fn(() => ({ close: vi.fn(), onopen: null, onclose: null, onerror: null, onmessage: null })),
}));

const MESSAGE = {
  id: 1,
  room: "main",
  userId: 4,
  author: "RAJU",
  role: "staff",
  kind: "text" as const,
  body: "Baki stock?",
  receiptId: null,
  createdAt: "2026-11-06T09:42:00.000Z",
};

const RECEIPT = {
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
  status: "pending" as const,
  decidedBy: null,
  deciderName: null,
  decisionNote: null,
  decidedAt: null,
  messageId: 2,
  createdAt: "2026-11-06T09:45:00.000Z",
};

function renderPage() {
  return render(
    <DbProvider url="postgresql://user:pass@localhost:5432/test">
      <TeamChat />
    </DbProvider>,
  );
}

describe("Team Chat screen (desktop)", () => {
  beforeEach(() => {
    vi.mocked(getChatWorkerUrl).mockResolvedValue("");
    vi.mocked(getSecret).mockResolvedValue(null);
    vi.mocked(chatMessages).mockResolvedValue([]);
    vi.mocked(chatReceipts).mockResolvedValue({ receipts: [], pending: 0 });
  });

  it("asks for the worker address when there is none", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Settings → Team Chat/)).toBeTruthy();
    });
  });

  it("shows the room and sends a message", async () => {
    vi.mocked(getChatWorkerUrl).mockResolvedValue("https://worker.dev");
    vi.mocked(getSecret).mockResolvedValue(JSON.stringify({ token: "t", expiresAt: Date.now() + 60_000 }));
    vi.mocked(chatMessages).mockResolvedValue([MESSAGE]);
    vi.mocked(chatReceipts).mockResolvedValue({ receipts: [RECEIPT], pending: 1 });
    vi.mocked(chatSend).mockResolvedValue({ message: { ...MESSAGE, id: 5, body: "Kal 6 baje" } });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Baki stock?");
    expect(screen.getByText("₹450.00")).toBeTruthy();

    const input = screen.getByPlaceholderText("Message the team…");
    await user.type(input, "Kal 6 baje");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Kal 6 baje");
    expect(chatSend).toHaveBeenCalled();
  });

  it("lists the conversations and switches to a private chat", async () => {
    vi.mocked(getChatWorkerUrl).mockResolvedValue("https://worker.dev");
    vi.mocked(getSecret).mockResolvedValue(JSON.stringify({ token: "t", expiresAt: Date.now() + 60_000 }));
    vi.mocked(chatConversations).mockResolvedValue([
      { id: 1, room: "main", kind: "group", other: null, unread: 0, lastMessageAt: null },
      {
        id: 2,
        room: "dm-1-4",
        kind: "direct",
        other: { id: 4, name: "RAJU", role: "staff" },
        unread: 2,
        lastMessageAt: null,
      },
    ] as never);

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Chats" });
    await waitFor(() => {
      expect(screen.getAllByText("Shop room").length).toBeGreaterThan(0);
    });
    // The private chat shows its unread count.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /RAJU/ }).textContent).toContain("2");
    });
    const privateChat = screen.getByRole("button", { name: /RAJU/ });

    await user.click(privateChat);
    await waitFor(() => {
      expect(chatMessages).toHaveBeenCalledWith("https://worker.dev", "t", "dm-1-4");
    });
  });
});
