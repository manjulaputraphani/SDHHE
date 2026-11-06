/**
 * Team Chat — the desktop screen (Phase 12).
 *
 * The room lives in the Cloudflare Worker: the live messages come over a
 * WebSocket, the receipt files come from R2 and the approvals are decided
 * there. The worker address is in Settings → Team Chat; the bearer token was
 * fetched when the member signed in.
 *
 * Colours: only the tokens from src/App.css. The layout follows
 * docs/chat-in-app-preview.html.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getChatWorkerUrl } from "../db/settings";
import { getAuditActor } from "../db/activity";
import { getCurrentPermissions } from "../db/permissions";
import { useDb } from "../lib/db-context";
import { getSecret, SECRET_KEYS } from "../lib/secrets";
import {
  chatConversations,
  chatDecide,
  chatMembers,
  chatMessages,
  chatReceipts,
  chatReceiptUrl,
  chatSend,
  chatUpload,
  conversationText,
  markChatRead,
  openChatSocket,
  normaliseWorkerUrl,
  startChatConversation,
  type ChatConversation,
  type ChatFrame,
  type ChatMember,
} from "../lib/chatClient";
import type { ChatMessage, ReceiptRequest } from "../db/chat";
import {
  canApproveReceipts,
  formatChatDayLabel,
  formatChatTime,
  receiptStatusLabel,
  receiptStatusTone,
} from "../logic/chat";
import { formatRupees } from "../logic/units";

type StoredToken = { token: string; expiresAt: number };

const TONE_CLASS: Record<string, string> = {
  warn: "badge-warn",
  ok: "badge-ok",
  bad: "badge-bad",
};

export default function TeamChat() {
  const db = useDb();
  const [workerUrl, setWorkerUrl] = useState("");
  const [token, setToken] = useState("");
  const [room, setRoom] = useState("main");
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRequest[]>([]);
  const [presence, setPresence] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canApprove = canApproveReceipts(getCurrentPermissions());
  const scrollToBottom = useCallback(() => {
    // jsdom has no scrollIntoView — the guard keeps the tests quiet.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, []);

  /** Where the chat lives and who we are there. */
  useEffect(() => {
    let cancelled = false;
    async function setup() {
      const url = await getChatWorkerUrl(db);
      const stored = await getSecret(SECRET_KEYS.CHAT_TOKEN);
      if (cancelled) return;
      setWorkerUrl(normaliseWorkerUrl(url));
      if (!stored) return;
      try {
        const parsed = JSON.parse(stored) as StoredToken;
        if (parsed.expiresAt && parsed.expiresAt * 1000 <= Date.now()) return;
        setToken(parsed.token);
      } catch {
        // A token we cannot read is treated as missing.
      }
    }
    void setup().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  /** The conversations, the members and the history of the open room. */
  const load = useCallback(async () => {
    if (!workerUrl || !token) return;
    try {
      const [list, people, history, pending] = await Promise.all([
        chatConversations(workerUrl, token),
        chatMembers(workerUrl, token),
        chatMessages(workerUrl, token, room),
        chatReceipts(workerUrl, token, room),
      ]);
      setConversations(list);
      setMembers(people);
      setMessages(history);
      setReceipts(pending.receipts);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workerUrl, token, room, scrollToBottom]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The live room. */
  useEffect(() => {
    if (!workerUrl || !token) return;
    let closed = false;
    let socket: WebSocket | null = null;

    const open = () => {
      socket = openChatSocket(
        workerUrl,
        token,
        (frame: ChatFrame) => {
          if (frame.type === "message" && frame.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === frame.message!.id) ? prev : [...prev, frame.message!],
            );
            scrollToBottom();
          }
          if (frame.type === "receipt" && frame.receipt && frame.message) {
            setMessages((prev) =>
              prev.some((m) => m.id === frame.message!.id) ? prev : [...prev, frame.message!],
            );
            setReceipts((prev) => [frame.receipt!, ...prev.filter((r) => r.id !== frame.receipt!.id)]);
            scrollToBottom();
          }
          if (frame.type === "presence" && frame.users) {
            setPresence(frame.users.map((u) => (u as { name: string }).name));
          }
          if (frame.type === "hello" && frame.presence) {
            setPresence(frame.presence.map((u) => (u as { name: string }).name));
          }
        },
        () => {
          setConnected(false);
          if (!closed) window.setTimeout(open, 5000);
        },
        room,
      );
      socket.onopen = () => setConnected(true);
      socket.onerror = () => setConnected(false);
    };

    open();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [workerUrl, token, room, scrollToBottom]);

  /** Open a conversation and mark it as read. */
  async function openRoom(next: string) {
    setRoom(next);
    setError(null);
    try {
      await markChatRead(workerUrl, token, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Start (or open) the private chat with a member. */
  async function startChat(member: ChatMember) {
    setBusy(true);
    setError(null);
    try {
      const conversation = await startChatConversation(workerUrl, token, member.id);
      setShowNewChat(false);
      await openRoom(conversation.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Save the conversation as a text file. */
  function exportConversation() {
    const active = conversations.find((c) => c.room === room);
    const name = active?.kind === "direct" ? active.other?.name ?? room : "Shop room";
    const text = conversationText(room, name, messages);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat-${room.replace(/[^a-z0-9-]/gi, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || !workerUrl || !token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The message is shown right away (the socket would send it again).
      const { message } = await chatSend(workerUrl, token, { kind: "text", body: text, room });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setDraft("");
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy || !workerUrl || !token) return;
    const rupees = Number(amount);
    if (!title.trim()) {
      setError("Give the receipt a title");
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError("Enter the amount in rupees");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stored = await chatUpload(workerUrl, token, file);
      const { message, receipt } = await chatSend(workerUrl, token, {
        kind: "receipt",
        body: title.trim(),
        room,
        receipt: {
          ...stored,
          title: title.trim(),
          amountPaise: Math.round(rupees * 100),
          note: note.trim() || undefined,
        },
      });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (receipt) {
        setReceipts((prev) => [receipt, ...prev.filter((r) => r.id !== receipt.id)]);
      }
      setFile(null);
      setTitle("");
      setAmount("");
      setNote("");
      setShowReceiptForm(false);
      setNotice("Receipt sent — it is waiting for approval.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(receipt: ReceiptRequest, decision: "approve" | "reject") {
    if (!workerUrl || !token) return;
    setDeciding(receipt.id);
    setError(null);
    try {
      await chatDecide(workerUrl, token, receipt.id, decision);
      setNotice(`Receipt #${receipt.id} ${decision === "approve" ? "approved" : "rejected"}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeciding(null);
    }
  }

  if (!workerUrl) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Team Chat</h1>
        <p className="text-sm text-muted">
          The chat runs on the Cloudflare Worker. Set its address in Settings → Team Chat, then sign in
          again.
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Team Chat</h1>
        <p className="text-sm text-muted">
          Sign out and sign in again to connect to the chat.
        </p>
      </div>
    );
  }

  const pending = receipts.filter((r) => r.status === "pending");
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const activeConversation = conversations.find((c) => c.room === room);
  const roomName =
    activeConversation?.kind === "direct" ? activeConversation.other?.name ?? room : "Shop room";
  let lastDay = "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Team Chat</h1>
          <p className="text-sm text-muted">Talk about the shop and send receipts for approval.</p>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted" data-testid="chat-status">
          <span
            className={`size-2 rounded-full ${connected ? "bg-secondary" : "bg-muted"}`}
            aria-hidden="true"
          />
          {connected ? "Live" : "Reconnecting…"}
          {presence.length > 0 && <span>· {presence.join(", ")} online</span>}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* ---------------- conversations ---------------- */}
        <aside className="card space-y-2 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Chats</h2>
            <button className="btn-ghost text-xs" onClick={() => setShowNewChat(true)}>
              New chat
            </button>
          </div>
          <div className="space-y-1">
            {conversations.map((conversation) => {
              const name =
                conversation.kind === "direct"
                  ? conversation.other?.name ?? conversation.room
                  : "Shop room";
              const active = conversation.room === room;
              return (
                <button
                  key={conversation.room}
                  type="button"
                  onClick={() => void openRoom(conversation.room)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    active ? "bg-surface-3 font-medium text-ink" : "text-muted hover:bg-surface-2"
                  }`}
                >
                  <span className="truncate">{name}</span>
                  {conversation.unread > 0 && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-ink">
                      {conversation.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {activeConversation?.kind === "direct" && (
            <p className="px-1 text-[11px] text-muted">
              A private chat — only you and {activeConversation.other?.name} can read it.
            </p>
          )}
          <button className="btn-ghost w-full text-xs" onClick={exportConversation}>
            Export this chat
          </button>
        </aside>

        {/* ---------------- the room ---------------- */}
        <div className="card flex min-h-[420px] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <h2 className="text-sm font-semibold text-ink">{roomName}</h2>
            {activeConversation?.kind === "direct" && (
              <span className="badge badge-warn">Private</span>
            )}
          </div>
          <div className="max-h-[52vh] flex-1 space-y-3 overflow-y-auto bg-bg p-4">
            {messages.length === 0 && (
              <p className="text-sm text-muted">No messages yet — say hello to the team.</p>
            )}
            {messages.map((message) => {
              const day = formatChatDayLabel(message.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              const mine = message.userId !== null && message.userId === currentUserId();
              const receipt = message.receiptId ? receiptById.get(message.receiptId) : undefined;

              return (
                <div key={message.id} className="space-y-2">
                  {showDay && (
                    <p className="mx-auto w-fit rounded-full border border-line bg-surface-2 px-3 py-0.5 text-[11px] text-muted">
                      {day}
                    </p>
                  )}
                  {message.kind === "system" ? (
                    <p className="mx-auto w-fit rounded-full border border-line bg-surface-2 px-3 py-0.5 text-xs text-muted">
                      {message.body}
                    </p>
                  ) : (
                    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[85%] space-y-1">
                        {message.kind === "receipt" && receipt ? (
                          <div className="card space-y-2 p-3">
                            <p className="text-sm font-semibold text-ink">{receipt.title}</p>
                            <p className="text-lg font-semibold text-ink">
                              {formatRupees(receipt.amountPaise)}
                            </p>
                            {receipt.note && <p className="text-xs text-muted">{receipt.note}</p>}
                            {receipt.mime.startsWith("image/") ? (
                              <img
                                src={chatReceiptUrl(workerUrl, receipt.r2Key)}
                                alt={receipt.filename}
                                className="max-h-56 w-full rounded-lg border border-line object-cover"
                              />
                            ) : (
                              <a
                                href={chatReceiptUrl(workerUrl, receipt.r2Key)}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink"
                              >
                                {receipt.filename}
                              </a>
                            )}
                            <span className={`badge ${TONE_CLASS[receiptStatusTone(receipt.status)] ?? ""}`}>
                              {receiptStatusLabel(receipt.status)}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={`rounded-xl px-3 py-2 text-sm ${
                              mine ? "bg-primary text-on-primary" : "border border-line bg-surface text-ink"
                            }`}
                          >
                            {message.body}
                          </div>
                        )}
                        <p className={`text-[11px] text-muted ${mine ? "text-right" : ""}`}>
                          {message.author} · {formatChatTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="flex items-center gap-2 border-t border-line bg-surface p-3">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setShowReceiptForm((open) => !open)}
            >
              Attach receipt
            </button>
            <input
              className="input flex-1"
              placeholder="Message the team…"
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              disabled={busy}
              maxLength={2000}
            />
            <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>

          {showReceiptForm && (
            <form onSubmit={sendReceipt} className="space-y-3 border-t border-line bg-surface-2 p-3">
              <p className="text-sm font-medium text-ink">Send a receipt for approval</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="input"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
                />
                <input
                  className="input"
                  placeholder="Title (e.g. Transport bill)"
                  value={title}
                  onChange={(e) => setTitle(e.currentTarget.value)}
                />
                <input
                  className="input"
                  placeholder="Amount in ₹"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.currentTarget.value)}
                />
                <input
                  className="input"
                  placeholder="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.currentTarget.value)}
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary text-xs" disabled={busy || !file}>
                  {busy ? "Sending…" : "Send receipt"}
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => setShowReceiptForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ---------------- approvals ---------------- */}
        <aside className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-ink">Receipt approvals</h2>
          {pending.length === 0 && (
            <p className="text-sm text-muted">Nothing is waiting for a decision.</p>
          )}
          {pending.map((receipt) => (
            <div key={receipt.id} className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-sm font-semibold text-ink">{receipt.title}</p>
              <p className="text-sm text-ink">{formatRupees(receipt.amountPaise)}</p>
              <p className="text-xs text-muted">
                {receipt.submitterName} · {formatChatTime(receipt.createdAt)}
              </p>
              {receipt.mime.startsWith("image/") && (
                <img
                  src={chatReceiptUrl(workerUrl, receipt.r2Key)}
                  alt={receipt.filename}
                  className="max-h-40 w-full rounded-lg border border-line object-cover"
                />
              )}
              {canApprove ? (
                <div className="flex gap-2">
                  <button
                    className="btn-ghost text-xs"
                    disabled={deciding === receipt.id}
                    onClick={() => void decide(receipt, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    disabled={deciding === receipt.id}
                    onClick={() => void decide(receipt, "reject")}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <span className="badge badge-warn">Waiting for an owner</span>
              )}
            </div>
          ))}
        </aside>
      </div>

      {showNewChat && (
        <div className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Start a private chat</h2>
            <button className="btn-ghost text-xs" onClick={() => setShowNewChat(false)}>
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() => void startChat(member)}
              >
                {member.name}
              </button>
            ))}
            {members.length === 0 && <p className="text-sm text-muted">Nobody else to chat with.</p>}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded bg-success-soft px-3 py-2 text-sm text-success-ink">{notice}</p>
      )}
    </div>
  );
}

/** The signed-in member's id (the audit actor) — used to align own messages. */
function currentUserId(): number | null {
  const actor = getAuditActor();
  return actor.userId;
}
