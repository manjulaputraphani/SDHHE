/**
 * Team Chat — the web screen (Phase 12 + 13).
 *
 * The room is a Cloudflare Durable Object: the history is loaded once over
 * REST and everything after that arrives over the WebSocket. Receipts are
 * attached to a message and wait for an approval (owner / CA).
 *
 * The left column holds the conversations: the shop room (everybody) and the
 * private chats, with the unread count of each.
 *
 * Colours: only the tokens from src/App.css (the web app has the same
 * palette). The layout follows docs/chat-in-app-preview.html.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  chatReceiptUrl,
  uploadChatReceipt,
  type ChatConversation,
  type ChatMember,
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

import { showToast } from "./notifications/toastStore";
import PushToggle from "./notifications/PushToggle";
import {
  exportNameFor,
  groupMessages,
  initials,
  isOnline,
  messageTick,
  presenceLabel,
  readCount,
} from "../../../src/logic/chatView";

type Props = { user: User | null };

const BADGE_CLASS: Record<string, string> = {
  warn: "bg-accent-soft text-accent-ink",
  ok: "bg-success-soft text-success-ink",
  bad: "bg-error-soft text-error-ink",
};

const SHARED_ROOM = "main";

/** The text of a conversation, for the export button. */
export function conversationText(
  room: string,
  title: string,
  messages: ChatMessage[],
): string {
  const lines = [`Team Chat — ${title}`, `Room: ${room}`, ""];
  for (const message of messages) {
    const time = new Date(message.createdAt).toLocaleString("en-IN");
    lines.push(`[${time}] ${message.author}: ${message.body}`);
  }
  return lines.join("\n");
}

export default function TeamChat({ user }: Props) {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [room, setRoom] = useState<string>(SHARED_ROOM);
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
  const [showNewChat, setShowNewChat] = useState(false);
  /** The owner renames the group (Phase 14). */
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<number | null>(null);
  /** Who is typing right now (Phase 14). */
  const [typing, setTyping] = useState<string | null>(null);
  /** The reader is scrolled up — show the jump-to-bottom button. */
  const [atBottom, setAtBottom] = useState(true);
  const [missed, setMissed] = useState(0);
  /** Who of the team is online (the heartbeat, Phase 1). */
  const [nowTick, setNowTick] = useState(() => Date.now());
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef(0);
  const atBottomRef = useRef(true);
  const socketRef = useRef<WebSocket | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const canApprove = canApproveReceipts(user?.permissions);

  const scrollToBottom = useCallback(() => {
    // jsdom has no scrollIntoView — the guard keeps the tests quiet.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, []);

  /** The conversations and the people who may be chatted with. */
  const loadConversations = useCallback(async () => {
    try {
      const [list, people] = await Promise.all([api.chatConversations(), api.chatMembers()]);
      setConversations(list.conversations);
      setMembers(people.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /** The history and the receipts of the open conversation. */
  const load = useCallback(async () => {
    try {
      const [history, pending] = await Promise.all([
        api.chatMessages(room),
        api.chatReceipts(undefined, room),
      ]);
      setMessages(history.messages);
      setReceipts(pending.receipts);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [room, scrollToBottom]);

  useEffect(() => {
    setMessages([]);
    setReceipts([]);
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
    // The presence heartbeat: every 30 seconds (Phase 1).
    const beat = window.setInterval(() => {
      setNowTick(Date.now());
      void api.chatHeartbeat(room).catch(() => undefined);
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 30_000);
    void api.chatHeartbeat(room).catch(() => undefined);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearInterval(beat);
    };
  }, [room]);

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
          `${scheme}://${window.location.host}/api/chat/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(chatToken)}`,
        );
        socketRef.current = socket;
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
            messageIds?: number[];
            userId?: number;
            name?: string;
            title?: string;
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
            if (!atBottomRef.current) {
              setMissed((count) => count + 1);
            } else {
              scrollToBottom();
              // It is on screen — that is a "read".
              void api.markChatRead(room, frame.message.id).catch(() => undefined);
            }
            // The message reached this device — tell the sender.
            void api.markChatDelivered(frame.message.id).catch(() => undefined);
          }
          if (frame.type === "delivered" || frame.type === "read") {
            const ids = (frame.messageIds ?? []) as number[];
            const key = frame.type === "read" ? "readBy" : "deliveredBy";
            setMessages((prev) =>
              prev.map((message) => {
                if (!ids.includes(message.id)) return message;
                const list = (message[key] ?? []) as number[];
                if (list.includes(frame.userId!)) return message;
                return { ...message, [key]: [...list, frame.userId!] };
              }),
            );
          }
          if (frame.type === "rename") {
            // Read the name from the list (the database), never a local copy.
            void loadConversations();
            void load();
          }
          if (frame.type === "typing" && frame.name) {
            setTyping(frame.name);
            if (typingTimer.current) window.clearTimeout(typingTimer.current);
            typingTimer.current = window.setTimeout(() => setTyping(null), 3000);
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
  }, [token, room, scrollToBottom, loadConversations]);

  /** Is the reader at the bottom of the room? (the jump button depends on it) */
  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    atBottomRef.current = atBottom;
    setAtBottom(atBottom);
    if (atBottom) setMissed(0);
  }, []);

  /** Jump back to the newest message. */
  const jumpToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
    atBottomRef.current = true;
    setAtBottom(true);
    setMissed(0);
  }, []);

  /** Save the new name of the group (the owner only). */
  const saveName = useCallback(async () => {
    const title = newName.trim();
    setRenaming(false);
    if (!title) return;
    try {
      await api.renameChatConversation(room, title);
      // The list is the single source of the name — no second copy.
      setConversations((prev) =>
        prev.map((entry) => (entry.room === room ? { ...entry, title } : entry)),
      );
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [newName, room, loadConversations]);

  /** Tell the others that I am typing. */
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "typing",
        userId: user?.id ?? 0,
        name: user?.name ?? "",
      }),
    );
  }, [user?.id, user?.name]);

  /** Open a conversation and mark it as read. */
  async function openRoom(next: string) {
    setRoom(next);
    setError(null);
    try {
      await api.markChatRead(next);
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startChat(member: ChatMember) {
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api.startChatConversation(member.id);
      await loadConversations();
      setShowNewChat(false);
      await openRoom(conversation.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The message is shown right away (the socket would send it again).
      const { message } = await api.sendChatMessage({ kind: "text", body: text, room });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setDraft("");
      scrollToBottom();
      showToast("Message sent", "success", 2500);
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
      showToast("Receipt sent for approval", "success");
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
      showToast(
        `Approval sent — receipt #${receipt.id} ${decision === "approve" ? "approved" : "rejected"}`,
        "success",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeciding(null);
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
    link.download = exportNameFor(room, activeConversation?.title ?? null);
    link.click();
    URL.revokeObjectURL(url);
  }

  const pending = receipts.filter((r) => r.status === "pending");
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const activeConversation = conversations.find((c) => c.room === room);
  // The people whose ticks count: the other member of a private chat, or
  // everybody else in the shop room.
  /** Is the other member of a private chat online? */
  const otherOnline = useMemo(() => {
    if (activeConversation?.kind !== "direct") return false;
    const member = members.find((entry) => entry.id === activeConversation.other?.id);
    return isOnline(member?.lastSeenAt, nowTick);
  }, [activeConversation, members, nowTick]);
  /** How many of the team are online (a heartbeat in the last minute). */
  const onlineCount = useMemo(
    () => members.filter((member) => isOnline(member.lastSeenAt, nowTick)).length + 1,
    [members, nowTick],
  );
  const otherMemberIds = useMemo(() => {
    if (activeConversation?.kind === "direct") {
      return activeConversation.other ? [activeConversation.other.id] : [];
    }
    return members.map((member) => member.id);
  }, [activeConversation, members]);
  const groups = useMemo(
    () => groupMessages(messages, user?.id ?? null),
    [messages, user?.id],
  );
  const roomName =
    activeConversation?.kind === "direct"
      ? activeConversation.other?.name ?? room
      : activeConversation?.title?.trim() || "Shop room";
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
        <div className="flex items-center gap-2">
          <PushToggle />
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
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        {/* ---------------- conversations ---------------- */}
        <aside className="card space-y-2 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Chats</h2>
            <button className="btn-mini" onClick={() => setShowNewChat(true)}>
              New chat
            </button>
          </div>
          <div className="space-y-1">
            {conversations.map((conversation) => {
              const name =
                conversation.kind === "direct"
                  ? conversation.other?.name ?? conversation.room
                  : conversation.title?.trim() || "Shop room";
              const active = conversation.room === room;
              return (
                <button
                  key={conversation.room}
                  onClick={() => void openRoom(conversation.room)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    active
                      ? "bg-surface-3 font-medium text-ink"
                      : "text-muted hover:bg-surface-2"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${
                        isOnline(
                          members.find((entry) => entry.id === conversation.other?.id)?.lastSeenAt,
                          nowTick,
                        )
                          ? "bg-secondary"
                          : "bg-muted/40"
                      }`}
                    />
                    <span className="truncate">{name}</span>
                  </span>
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
          <button className="btn-mini w-full justify-center" onClick={exportConversation}>
            Export this chat
          </button>
        </aside>

        {/* ---------------- the room ---------------- */}
        <div className="relative">
          <div className="card flex min-h-[420px] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
            {renaming ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveName();
                }}
              >
                <input
                  className="input h-8 w-44 py-1 text-sm"
                  value={newName}
                  autoFocus
                  onChange={(event) => setNewName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRenaming(false);
                  }}
                />
                <button type="submit" className="btn-mini">
                  Save
                </button>
              </form>
            ) : (
              <h2 className="text-sm font-semibold text-ink">
                {roomName}
                {user?.role === "owner" && activeConversation?.kind === "group" && (
                  <button
                    type="button"
                    className="ml-2 text-[11px] font-normal text-muted underline"
                    onClick={() => {
                      setNewName(roomName);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                )}
              </h2>
            )}
            {activeConversation?.kind === "direct" && (
              <span className="text-[11px] text-muted">
                {presenceLabel(
                  members.find((entry) => entry.id === activeConversation.other?.id)?.lastSeenAt,
                  new Date(nowTick),
                )}
              </span>
            )}
            {activeConversation?.kind === "group" && (
              <details className="relative">
                <summary className="cursor-pointer text-[11px] text-muted">
                  {members.length + 1} members · {onlineCount} online
                </summary>
                <div className="absolute left-0 top-5 z-20 w-56 space-y-1 rounded-xl border border-line bg-surface p-2 shadow-lg">
                  {members.map((member) => (
                    <p key={member.id} className="flex items-center gap-2 text-xs text-ink">
                      <span
                        aria-hidden="true"
                        className={`size-2 rounded-full ${
                          isOnline(member.lastSeenAt, nowTick) ? "bg-secondary" : "bg-muted/50"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{member.name}</span>
                      <span className="text-[10px] text-muted">
                        {isOnline(member.lastSeenAt, nowTick) ? "Online" : "Offline"}
                      </span>
                    </p>
                  ))}
                </div>
              </details>
            )}
            {typing && (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <span className="flex gap-0.5" aria-hidden="true">
                  <span className="size-1 animate-pulse rounded-full bg-muted" />
                  <span className="size-1 animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
                  <span className="size-1 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
                </span>
                {typing} is typing…
              </span>
            )}
          </div>
          <div
            ref={listRef}
            className="max-h-[52vh] flex-1 space-y-1 overflow-y-auto bg-bg p-4"
            onScroll={onScroll}
          >
            {groups.length === 0 && (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="text-sm font-medium text-ink">No messages yet</p>
                  <p className="mt-1 text-xs text-muted">
                    Say hello to the team — everyone in this chat sees it right away.
                  </p>
                </div>
              </div>
            )}
            {groups.map((group) => {
              const last = group.messages[group.messages.length - 1]!;
              const tick = group.mine ? messageTick(last, otherMemberIds) : null;
              const counts = readCount(last, otherMemberIds);
              // Who read it and when (Phase 1).
              const readers = (last.readBy ?? [])
                .map((id) => {
                  const member = members.find((entry) => entry.id === id);
                  return {
                    userId: id,
                    name: member?.name ?? `#${id}`,
                    initials: initials(member?.name ?? "?"),
                    readAt: last.createdAt,
                  };
                })
                .filter(() => true);
              const pending = otherMemberIds
                .filter((id) => !(last.readBy ?? []).includes(id))
                .map((id) => members.find((entry) => entry.id === id)?.name ?? `#${id}`);
              return (
                <div
                  key={group.key}
                  className={`flex items-end gap-2 ${group.mine ? "justify-end" : "justify-start"}`}
                >
                  {!group.mine && (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-muted">
                      {initials(group.author)}
                    </span>
                  )}
                  <div className={`flex max-w-[78%] flex-col ${group.mine ? "items-end" : "items-start"}`}>
                    {!group.mine && (
                      <span className="mb-0.5 px-1 text-[11px] font-medium text-muted">
                        {group.author}
                      </span>
                    )}
                    {group.messages.map((message, index) => {
                      const receipt = message.receiptId ? receiptById.get(message.receiptId) : undefined;
                      const isFirst = index === 0;
                      const isLast = index === group.messages.length - 1;
                      if (message.kind === "system") {
                        return (
                          <p
                            key={message.id}
                            className="my-1 rounded-full border border-line bg-surface-2 px-3 py-0.5 text-center text-[11px] text-muted"
                          >
                            {message.body}
                          </p>
                        );
                      }
                      if (message.kind === "receipt" && receipt) {
                        return (
                          <div key={message.id} className="card space-y-2 p-3">
                            <p className="text-sm font-semibold text-ink">{receipt.title}</p>
                            <p className="text-lg font-semibold text-ink">
                              {formatRupees(receipt.amountPaise)}
                            </p>
                            {receipt.note && <p className="text-xs text-muted">{receipt.note}</p>}
                            {receipt.mime.startsWith("image/") ? (
                              <img
                                src={chatReceiptUrl(receipt.r2Key)}
                                alt={receipt.filename}
                                className="max-h-56 w-full rounded-xl border border-line object-cover"
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
                            <span className={`badge ${BADGE_CLASS[receiptStatusTone(receipt.status)] ?? ""}`}>
                              {receiptStatusLabel(receipt.status)}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={message.id}
                          className={`rounded-2xl px-3.5 py-2 text-sm ${
                            group.mine
                              ? `bg-primary text-on-primary ${isLast ? "rounded-br-md" : "rounded-br-2xl"}`
                              : `border border-line bg-surface text-ink ${isFirst ? "rounded-bl-md" : "rounded-bl-2xl"}`
                          } ${isFirst ? "" : "mt-0.5"}`}
                        >
                          {message.body}
                        </div>
                      );
                    })}
                    <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted">
                      {formatChatTime(last.createdAt)}
                      {tick && (
                        <span
                          className={tick === "read" ? "text-accent-ink" : "text-muted"}
                          title={
                            tick === "read"
                              ? "Read by everybody"
                              : tick === "delivered"
                                ? "Delivered to everybody"
                                : "Sent"
                          }
                        >
                          {tick === "sent" ? "✓" : "✓✓"}
                        </span>
                      )}
                      {/* Who has read it — only on the newest message I sent. */}
                      {group.mine &&
                        (activeConversation?.kind === "direct" ? (
                          <span title="Seen">
                            {readers.length > 0
                              ? `Seen ${formatChatTime(readers[0]!.readAt)}`
                              : ""}
                          </span>
                        ) : (
                          readers.length > 0 && (
                            <details className="relative">
                              <summary
                                className="flex cursor-pointer items-center"
                                aria-label={`Read by ${readers.length} of ${counts.total}`}
                              >
                                {readers.slice(0, 3).map((reader, index) => (
                                  <span
                                    key={reader.userId}
                                    className={`grid size-4 place-items-center rounded-full border border-surface bg-surface-3 text-[8px] font-semibold text-muted ${
                                      index > 0 ? "-ml-1.5" : ""
                                    }`}
                                  >
                                    {reader.initials}
                                  </span>
                                ))}
                                {readers.length > 3 && (
                                  <span className="-ml-1.5 grid size-4 place-items-center rounded-full border border-surface bg-surface-3 text-[8px] font-semibold text-muted">
                                    +{readers.length - 3}
                                  </span>
                                )}
                              </summary>
                              <div className="absolute right-0 top-5 z-20 w-48 space-y-0.5 rounded-lg border border-line bg-surface p-2 text-[11px] shadow-lg">
                                <p className="font-medium text-ink">Read by</p>
                                {readers.map((reader) => (
                                  <p key={reader.userId} className="text-muted">
                                    {reader.name} {formatChatTime(reader.readAt)}
                                  </p>
                                ))}
                                {pending.length > 0 && (
                                  <>
                                    <p className="pt-1 font-medium text-ink">Delivered, not read</p>
                                    {pending.map((name) => (
                                      <p key={name} className="text-muted">
                                        {name}
                                      </p>
                                    ))}
                                  </>
                                )}
                              </div>
                            </details>
                          )
                        ))}
                    </span>
                  </div>
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
              placeholder="Message…"
              value={draft}
              onChange={(e) => {
                setDraft(e.currentTarget.value);
                sendTyping();
              }}
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

          {/* Jump to the newest message (with the number of missed ones). */}
          {!atBottom && (
            <button
              type="button"
              onClick={jumpToBottom}
              className="absolute bottom-24 right-6 z-10 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-lg"
            >
              {missed > 0 && (
                <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-accent-ink">
                  {missed}
                </span>
              )}
              New messages ↓
            </button>
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

      {showNewChat && (
        <div className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Start a private chat</h2>
            <button className="btn-mini" onClick={() => setShowNewChat(false)}>
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <button
                key={member.id}
                className="btn-mini"
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
