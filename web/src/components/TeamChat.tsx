/**
 * Team Chat — the web screen (Phase 12).
 *
 * The room is a Cloudflare Durable Object: the history is loaded once over
 * REST and everything after that arrives over the WebSocket. Receipts are
 * attached to a message and wait for an approval (owner / CA).
 *
 * Colours: only the tokens from src/App.css (the web app has the same
 * palette). The layout follows docs/chat-in-app-preview.html.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  chatReceiptUrl,
  uploadChatReceipt,
  type ChatMessage,
  type ChatReceipt,
  type ChatUser,
  type User,
} from "../api";
import {
  canApproveReceipts,
  formatChatDayLabel,
  formatChatTime,
  receiptStatusLabel,
  receiptStatusTone,
} from "../../../src/logic/chat";
import { formatRupees } from "../../../src/logic/units";

type Props = { user: User | null };

const BADGE_CLASS: Record<string, string> = {
  warn: "bg-accent-soft text-accent-ink",
  ok: "bg-success-soft text-success-ink",
  bad: "bg-error-soft text-error-ink",
};

export default function TeamChat({ user }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [receipts, setReceipts] = useState<ChatReceipt[]>([]);
  const [presence, setPresence] = useState<ChatUser[]>([]);
  const [token, setToken] = useState<string | null>(null);
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
  const canApprove = canApproveReceipts(user?.permissions);

  const scrollToBottom = useCallback(() => {
    // jsdom has no scrollIntoView — the guard keeps the tests quiet.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, []);

  /** The history and the receipts waiting for a decision. */
  const load = useCallback(async () => {
    try {
      const [history, pending] = await Promise.all([api.chatMessages(), api.chatReceipts()]);
      setMessages(history.messages);
      setReceipts(pending.receipts);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [scrollToBottom]);

  useEffect(() => {
    void load();
  }, [load]);

  // The live room: a chat token (the session exchanged for one) opens the socket.
  // The token runs out with the sign-on (an hour of inactivity), so it is
  // refreshed every half hour and the socket is opened again with the new one.
  useEffect(() => {
    let stopped = false;

    async function refresh() {
      try {
        const { token: fresh } = await api.chatToken();
        if (!stopped) setToken(fresh);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 30 * 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const chatToken = token;
    let socket: WebSocket | null = null;
    let closed = false;

    async function open() {
      try {
        if (closed) return;
        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        socket = new WebSocket(
          `${scheme}://${window.location.host}/api/chat/ws?token=${encodeURIComponent(chatToken)}`,
        );
        socket.onopen = () => setConnected(true);
        socket.onclose = () => {
          // A socket that was closed because the screen went away must not
          // mark the room as offline (React mounts the effect twice in dev).
          if (closed) return;
          setConnected(false);
          window.setTimeout(() => void open(), 5000);
        };
        socket.onerror = () => {
          if (!closed) setConnected(false);
        };
        socket.onmessage = (event) => {
          let frame: {
            type?: string;
            message?: ChatMessage;
            receipt?: ChatReceipt;
            users?: ChatUser[];
            presence?: ChatUser[];
          };
          try {
            frame = JSON.parse(String(event.data));
          } catch {
            return;
          }
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
            setReceipts((prev) => {
              const without = prev.filter((r) => r.id !== frame.receipt!.id);
              return [frame.receipt!, ...without];
            });
            scrollToBottom();
          }
          if (frame.type === "presence" && frame.users) setPresence(frame.users);
          if (frame.type === "hello" && frame.presence) setPresence(frame.presence);
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    void open();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [token, scrollToBottom]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The message is shown right away (the socket would send it again).
      const { message } = await api.sendChatMessage({ kind: "text", body: text });
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
    if (!file || busy) return;
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
      const stored = await uploadChatReceipt(file);
      const { message, receipt } = await api.sendChatMessage({
        kind: "receipt",
        body: title.trim(),
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

  async function decide(receipt: ChatReceipt, decision: "approve" | "reject") {
    setDeciding(receipt.id);
    setError(null);
    try {
      await api.decideChatReceipt(receipt.id, decision);
      setNotice(`Receipt #${receipt.id} ${decision === "approve" ? "approved" : "rejected"}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeciding(null);
    }
  }

  const pending = receipts.filter((r) => r.status === "pending");
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  let lastDay = "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Team Chat</h1>
          <p className="text-sm text-muted">
            Talk about the shop and send receipts for approval.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted" data-testid="chat-status">
          <span
            className={`size-2 rounded-full ${connected ? "bg-secondary" : "bg-muted"}`}
            aria-hidden="true"
          />
          {connected ? "Live" : "Reconnecting…"}
          {presence.length > 0 && (
            <span>
              · {presence.map((member) => member.name).join(", ")} online
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---------------- the room ---------------- */}
        <div className="card flex min-h-[420px] flex-col overflow-hidden">
          <div className="max-h-[52vh] flex-1 space-y-3 overflow-y-auto bg-bg p-4">
            {messages.length === 0 && (
              <p className="text-sm text-muted">No messages yet — say hello to the team.</p>
            )}
            {messages.map((message) => {
              const day = formatChatDayLabel(message.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              const mine = message.userId !== null && message.userId === user?.id;
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
                                src={chatReceiptUrl(receipt.r2Key)}
                                alt={receipt.filename}
                                className="max-h-56 w-full rounded-lg border border-line object-cover"
                              />
                            ) : (
                              <a
                                href={chatReceiptUrl(receipt.r2Key)}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink"
                              >
                                {receipt.filename}
                              </a>
                            )}
                            <span
                              className={`badge ${BADGE_CLASS[receiptStatusTone(receipt.status)] ?? ""}`}
                            >
                              {receiptStatusLabel(receipt.status)}
                            </span>
                          </div>
                        ) : (
                          <div
                            className={`rounded-xl px-3 py-2 text-sm ${
                              mine
                                ? "bg-primary text-on-primary"
                                : "border border-line bg-surface text-ink"
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
              className="btn-mini"
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
            <button type="submit" className="btn" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>

          {showReceiptForm && (
            <form
              onSubmit={sendReceipt}
              className="space-y-3 border-t border-line bg-surface-2 p-3"
            >
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
                <button type="submit" className="btn" disabled={busy || !file}>
                  {busy ? "Sending…" : "Send receipt"}
                </button>
                <button type="button" className="btn-mini" onClick={() => setShowReceiptForm(false)}>
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
                  src={chatReceiptUrl(receipt.r2Key)}
                  alt={receipt.filename}
                  className="max-h-40 w-full rounded-lg border border-line object-cover"
                />
              )}
              {canApprove ? (
                <div className="flex gap-2">
                  <button
                    className="btn-mini ok"
                    disabled={deciding === receipt.id}
                    onClick={() => void decide(receipt, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-mini danger"
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
          {receipts.filter((r) => r.status !== "pending").length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">
                Decided receipts ({receipts.filter((r) => r.status !== "pending").length})
              </summary>
              <div className="mt-2 space-y-2">
                {receipts
                  .filter((r) => r.status !== "pending")
                  .map((receipt) => (
                    <div key={receipt.id} className="rounded-lg border border-line bg-surface-2 p-2">
                      <p className="text-sm text-ink">{receipt.title}</p>
                      <p className="text-xs text-muted">{formatRupees(receipt.amountPaise)}</p>
                      <span className={`badge ${BADGE_CLASS[receiptStatusTone(receipt.status)] ?? ""}`}>
                        {receiptStatusLabel(receipt.status)}
                        {receipt.deciderName ? ` · ${receipt.deciderName}` : ""}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </aside>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success-ink">{notice}</p>
      )}
    </section>
  );
}
