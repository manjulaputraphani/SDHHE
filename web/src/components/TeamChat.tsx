/**
 * Team Chat — the web screen (Phase 12 + 13, redesigned in Phase 2).
 *
 * The room is a Cloudflare Durable Object: the history is loaded once over
 * REST and everything after that arrives over the WebSocket. Receipts are
 * attached to a message and wait for an approval (owner / CA).
 *
 * The left column holds the conversations: the shop room (everybody) and the
 * private chats, with a search bar, a preview and the unread count of each.
 * The right column is the approvals panel (collapsible; a tab on mobile).
 *
 * Colours: only the tokens from styles.css — no new colours (Phase 2).
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
  conversationPreview,
  formatChatTime,
  receiptStatusLabel,
  receiptStatusTone,
  withinEditWindow,
} from "../../../src/logic/chat";
import { polishSkipReason } from "../../../src/logic/aiPolish";
import { formatRupees } from "../../../src/logic/units";

import { showToast } from "./notifications/toastStore";
import PushToggle from "./notifications/PushToggle";
import {
  chatDaySections,
  conversationName,
  exportNameFor,
  filterConversations,
  filterMessages,
  formatChatListTimeRow,
  groupMessages,
  initials,
  isOnline,
  messageTick,
  presenceLabel,
  readCount,
  type ViewMessage,
} from "../../../src/logic/chatView";
import {
  IconArrowLeft,
  IconBellOff,
  IconChevronDown,
  IconDownload,
  IconMoreVertical,
  IconPaperclip,
  IconPin,
  IconSearch,
  IconSend,
  IconSmile,
  IconUsers,
} from "./icons";

type Props = { user: User | null };

const BADGE_CLASS: Record<string, string> = {
  warn: "bg-accent-soft text-accent-ink",
  ok: "bg-success-soft text-success-ink",
  bad: "bg-error-soft text-error-ink",
};

const SHARED_ROOM = "main";

/** A handful of emoji for the composer picker — no emoji library. */
const EMOJI = ["☕", "🙏", "👍", "✅", "🧾", "📦", "💰", "😊"];

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

type MobileView = "list" | "room" | "approvals";

/**
 * How much of the window the keyboard covers right now (px).
 *
 * On iOS Safari the layout viewport does not shrink when the keyboard
 * opens — only the visual viewport does. The chat shell follows that, so
 * the composer stays visible above the keyboard and the page does not
 * jump. On md+ the keyboard overlays nothing, so the offset stays 0.
 */
function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        setOffset(0);
        return;
      }
      setOffset(Math.max(0, Math.round(window.innerHeight - vv.height)));
    };
    update();
    vv.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return offset;
}

/** True from the md breakpoint up (768px) — tablet and desktop. */
function useIsMd(): boolean {
  const [isMd, setIsMd] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsMd(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMd;
}

/** Is this a touch device? On a phone the return key makes a new line —
 *  WhatsApp behaviour — and the send button sends (no accidental sends). */
function useIsCoarse(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
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
  /** The owner renames the group (Phase 14) — from the ⋮ menu (Phase 2). */
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  /** The owner makes groups (Phase 14): the list button, the header menu. */
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  /** The people ticked for a new group (the owner is always part of it). */
  const [groupPicks, setGroupPicks] = useState<number[]>([]);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showRemoveMember, setShowRemoveMember] = useState(false);
  /** The members of the open group — the popup and the owner's menu. */
  const [groupMembers, setGroupMembers] = useState<ChatMember[]>([]);
  /** The polish preview (Phase 15): waiting for the AI, a suggestion, or a failure. */
  const [polishCard, setPolishCard] = useState<
    | { state: "waiting" }
    | { state: "ready"; suggested: string; original: string; keptOriginal: boolean }
    | { state: "failed"; original: string }
    | null
  >(null);
  /** The message being edited in the composer (Phase 17 / T-16.2). */
  const [editing, setEditing] = useState<{ id: number } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  /** T-16.2: the long-pressed message whose action row is open. */
  const [actionsMessage, setActionsMessage] = useState<number | null>(null);
  /** T-16.2: the message whose delete is being confirmed. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  /** T-16.2: the message whose seen-by info is open. */
  const [infoMessage, setInfoMessage] = useState<ViewMessage | null>(null);

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
  // ---- Phase 2: the redesigned screen state ----
  /** The search bar above the chat list. */
  const [listQuery, setListQuery] = useState("");
  /** The search inside the open room (the magnifier in the header). */
  const [showRoomSearch, setShowRoomSearch] = useState(false);
  const [roomQuery, setRoomQuery] = useState("");
  /** The ⋮ menu in the room header (Rename, Export, Mute, Pin). */
  const [menuOpen, setMenuOpen] = useState(false);
  /** The member list popup in the room header. */
  const [showMembers, setShowMembers] = useState(false);
  /** On mobile only one panel is the screen at a time. */
  const [mobileView, setMobileView] = useState<MobileView>("list");
  /** The approvals panel is collapsible — and the choice is remembered (T-16.3). */
  const [approvalsOpen, setApprovalsOpen] = useState(() => {
    try {
      return localStorage.getItem("sdhhe:approvals-open") !== "0";
    } catch {
      return true;
    }
  });

  /** Open or close the approvals panel — remembered per user, best effort. */
  function toggleApprovals(next: boolean) {
    setApprovalsOpen(next);
    try {
      localStorage.setItem("sdhhe:approvals-open", next ? "1" : "0");
    } catch {
      // Private mode — the choice lasts for this tab only.
    }
  }
  /** The on-screen keyboard's height — the shell shrinks to fit (iOS). */
  const keyboardOffset = useKeyboardOffset();
  /** Tablet (md+) shows the list and the room side by side. */
  const isMd = useIsMd();
  /** A phone keyboard: the return key makes a new line, the button sends. */
  const isCoarse = useIsCoarse();
  /** Pinned / muted chats — a local preference of this browser only. */
  const [pinned, setPinned] = useState<string[]>([]);
  const [muted, setMuted] = useState<string[]>([]);
  /** Skeleton loaders while the first load is on its way. */
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRoom, setLoadingRoom] = useState(true);

  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef(0);
  const atBottomRef = useRef(true);
  const socketRef = useRef<WebSocket | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /** T-16.2: a long press on a bubble opens its action row (phone). */
  const pressTimer = useRef<number | undefined>(undefined);

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
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /** The members of the open group (the shop room keeps the whole team). */
  const loadGroupMembers = useCallback(async (target: string) => {
    try {
      setGroupMembers((await api.chatGroupMembers(target)).members);
    } catch {
      // Not (or no longer) a member — the list of rooms is the source.
      setGroupMembers([]);
    }
  }, []);

  useEffect(() => {
    if (room !== SHARED_ROOM) void loadGroupMembers(room);
    else setGroupMembers([]);
  }, [room, loadGroupMembers]);

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
    } finally {
      setLoadingRoom(false);
    }
  }, [room, scrollToBottom]);

  useEffect(() => {
    setMessages([]);
    setReceipts([]);
    setLoadingRoom(true);
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
        socket.onclose = (event) => {
          // A socket that was closed because the screen went away must not
          // mark the room as offline (React mounts the effect twice in dev).
          if (closed) return;
          setConnected(false);
          // Code 1008: the owner removed this member (or archived the group)
          // while they were in the room — no reconnect, back to the list.
          if (event.code === 1008) {
            showToast(
              event.reason === "archived"
                ? "This group was archived"
                : "You were removed from this group",
              "info",
              4000,
            );
            void loadConversations();
            if (room !== SHARED_ROOM) {
              setRoom(SHARED_ROOM);
              setMobileView("list");
            }
            return;
          }
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
          if (frame.type === "update" && frame.message) {
            // Somebody edited their message — swap in the fixed text.
            const updated = frame.message as ChatMessage;
            setMessages((prev) =>
              prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
            );
            void loadConversations();
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
          if (frame.type === "members") {
            // The owner added or removed somebody — reload the lists.
            void loadConversations();
            void loadGroupMembers(room);
          }
          if (frame.type === "settings") {
            // A room setting changed (AI polish) — reload the lists.
            void loadConversations();
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
            // An approver sees the new receipt at once (T-16.3).
            if (canApprove) toggleApprovals(true);
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
  }, [token, room, scrollToBottom, loadConversations, loadGroupMembers]);

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

  /** Create a group with the people the owner ticked (the owner is always in). */
  async function createGroup() {
    const title = groupTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await api.createChatGroup(title, groupPicks);
      setShowNewGroup(false);
      setGroupTitle("");
      setGroupPicks([]);
      await loadConversations();
      await openRoom(conversation.room);
      showToast(`Group "${conversation.title ?? title}" created`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Add one member to the open group (the owner only). */
  async function addToGroup(member: ChatMember) {
    setBusy(true);
    setError(null);
    try {
      await api.addChatGroupMember(room, member.id);
      await loadGroupMembers(room);
      showToast(`${member.name} joined the group`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Remove one member from the open group (the owner only). */
  async function removeFromGroup(member: ChatMember) {
    setBusy(true);
    setError(null);
    try {
      await api.removeChatGroupMember(room, member.id);
      await loadGroupMembers(room);
      showToast(`${member.name} left the group`, "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Retire the open group — it leaves every list (the owner only). */
  async function archiveGroup() {
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      await api.archiveChatGroup(room);
      setShowRemoveMember(false);
      setShowAddMembers(false);
      showToast("Group archived", "success");
      await loadConversations();
      await openRoom(SHARED_ROOM);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Switch AI polish on or off for the open group (the owner only, T-15.1). */
  async function togglePolish() {
    setMenuOpen(false);
    const next = !activeConversation?.aiPolish;
    setBusy(true);
    setError(null);
    try {
      await api.setChatGroupPolish(room, next);
      // The list is the single source of the flag — update it at once.
      setConversations((prev) =>
        prev.map((entry) => (entry.room === room ? { ...entry, aiPolish: next } : entry)),
      );
      await loadConversations();
      showToast(
        next ? "AI polish on — messages get a suggestion before sending" : "AI polish off",
        "info",
        3000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
    setMobileView("room");
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

  /** Send the draft (the composer's Enter key and the send button both call this).
   *  In a room with AI polish on, the member first confirms a suggestion (Phase 15). */
  async function submitDraft() {
    // An edit in the composer saves instead of sending (T-16.2).
    if (editing) {
      await saveEdit();
      return;
    }
    const text = draft.trim();
    if (!text || busy) return;
    // A suggestion card is already open — its buttons send, Enter does nothing.
    if (polishCard) return;
    if (activeConversation?.kind === "group" && activeConversation.aiPolish) {
      // Tiny and emoji-only texts skip the AI; a receipt never comes through here.
      if (polishSkipReason(text)) {
        await sendMessage(text, false);
        return;
      }
      setPolishCard({ state: "waiting" });
      setError(null);
      try {
        const result = await api.polishChatMessage(room, text);
        if (result.polished == null) {
          setPolishCard({ state: "failed", original: text });
        } else {
          setPolishCard({
            state: "ready",
            suggested: result.polished,
            original: text,
            keptOriginal: Boolean(result.keptOriginal),
          });
        }
      } catch {
        // No answer in time or a network error — the member decides.
        setPolishCard({ state: "failed", original: text });
      }
      return;
    }
    await sendMessage(text, false);
  }

  /** Put a text message into the room (the composer and the polish card share this). */
  async function sendMessage(text: string, aiPolished: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The message is shown right away (the socket would send it again).
      const { message } = await api.sendChatMessage({ kind: "text", body: text, room, aiPolished });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setDraft("");
      setPolishCard(null);
      scrollToBottom();
      showToast("Message sent", "success", 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Save the edit that lives in the composer (T-16.2: own text, 15 minutes). */
  async function saveEdit() {
    if (!editing || savingEdit) return;
    const text = editDraft.trim();
    if (!text) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const { message } = await api.editChatMessage(editing.id, text);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      cancelEdit();
      // The preview line in the chat list may have changed too.
      void loadConversations();
      showToast("Message edited", "success", 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  /** Start editing one of my own text messages — in the composer (T-16.2). */
  function startEdit(message: ViewMessage) {
    if (message.kind !== "text" || message.deleted || message.userId !== user?.id) return;
    if (!withinEditWindow(new Date(message.createdAt).getTime())) {
      showToast("This message is older than 15 minutes — it can no longer be edited", "warning");
      return;
    }
    setActionsMessage(null);
    setEditing({ id: message.id });
    setEditDraft(message.body);
    composerRef.current?.focus();
  }

  function cancelEdit() {
    setEditing(null);
    setEditDraft("");
  }

  /** Delete my own message (the owner may delete any) — confirmed (T-16.2). */
  async function confirmDelete() {
    const id = confirmDeleteId;
    if (id == null) return;
    setConfirmDeleteId(null);
    setActionsMessage(null);
    setBusy(true);
    setError(null);
    try {
      const { message } = await api.deleteChatMessage(id);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      showToast("Message deleted", "info", 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Copy a message — the line breaks travel too (T-16.2). */
  async function copyMessage(message: ViewMessage) {
    setActionsMessage(null);
    try {
      await navigator.clipboard.writeText(message.body);
      showToast("Copied", "success", 1500);
    } catch {
      showToast("Copy is not available here", "warning");
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    await submitDraft();
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
    setMenuOpen(false);
    const active = conversations.find((c) => c.room === room);
    const name = active ? conversationName(active) : room;
    const text = conversationText(room, name, messages);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportNameFor(room, activeConversation?.title ?? null);
    link.click();
    URL.revokeObjectURL(url);
  }

  function togglePin() {
    setMenuOpen(false);
    setPinned((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room],
    );
    showToast(
      pinned.includes(room) ? "Chat unpinned" : "Chat pinned to the top",
      "info",
      2000,
    );
  }

  function toggleMute() {
    setMenuOpen(false);
    setMuted((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room],
    );
    showToast(
      muted.includes(room) ? "Notifications on for this chat" : "Chat muted",
      "info",
      2000,
    );
  }

  const pending = receipts.filter((r) => r.status === "pending");
  /**
   * The approvals panel exists only for approvers with something to decide
   * (T-16.3): staff never see it, and 0 pending means no panel at all — the
   * chat takes the full width.
   */
  const showApprovals = canApprove && pending.length > 0;
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const activeConversation = conversations.find((c) => c.room === room);
  /** The owner may make groups — and this open room is one they made. */
  const isOwnerGroup =
    user?.role === "owner" &&
    activeConversation?.kind === "group" &&
    room !== SHARED_ROOM;
  /** The people of the open room: the group roster, or the whole team. */
  const roster = useMemo(
    () => (activeConversation?.kind === "group" && room !== SHARED_ROOM ? groupMembers : members),
    [activeConversation, room, groupMembers, members],
  );
  /** The candidate list of the owner's menu (not in the group yet). */
  const groupOutsiders = useMemo(
    () => members.filter((member) => !groupMembers.some((entry) => entry.id === member.id)),
    [members, groupMembers],
  );
  /** The people the owner may remove from a group (no owner of the shop). */
  const groupRemovable = useMemo(
    () => groupMembers.filter((member) => member.role !== "owner" && member.id !== user?.id),
    [groupMembers, user?.id],
  );
  // The people whose ticks count: the other member of a private chat, or
  // everybody else in the shop room.
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
  // ---- Phase 2: the list with its search, pinned chats first ----
  const visibleConversations = useMemo(() => {
    const pinnedFirst = [...conversations].sort((a, b) => {
      const pa = pinned.includes(a.room) ? 0 : 1;
      const pb = pinned.includes(b.room) ? 0 : 1;
      return pa - pb;
    });
    return filterConversations(pinnedFirst, listQuery);
  }, [conversations, pinned, listQuery]);
  // ---- Phase 2: the room search filters the open conversation ----
  const visibleMessages = useMemo(
    () => (roomQuery.trim() ? filterMessages(messages, roomQuery) : messages),
    [messages, roomQuery],
  );
  const sections = useMemo(
    () => chatDaySections(visibleMessages, new Date(nowTick)),
    [visibleMessages, nowTick],
  );
  const roomName = activeConversation
    ? conversationName(activeConversation)
    : room === SHARED_ROOM
      ? "Shop room"
      : room;

  return (
    <section
      className="chat-shell relative flex flex-col"
      style={
        keyboardOffset > 0
          ? {
              height: `calc(100dvh - 3.5rem - 3rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - ${keyboardOffset}px)`,
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-2 pb-2 md:gap-3 md:pb-3">
        <div>
          <h1 className="page-title text-base font-semibold tracking-tight md:text-2xl">Team Chat</h1>
          <p className="hidden text-sm text-muted sm:block">
            Talk about the shop and send receipts for approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PushToggle />
          {showApprovals && (
            <button
              type="button"
              aria-label="Receipt approvals"
              title="Open the receipt approvals"
              className={`btn-mini relative ${approvalsOpen ? "bg-surface-3 font-semibold" : ""}`}
              onClick={() => {
                const next = !approvalsOpen;
                toggleApprovals(next);
                // Below lg the panel is a slide-over — opening it must switch
                // the view to it (on lg this is a harmless no-op).
                if (next) setMobileView("approvals");
              }}
            >
              🧾 Approvals
              <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-bg">
                {pending.length}
              </span>
            </button>
          )}
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

      {/* Mobile: the list is the screen; a chat opens full-screen, the
          approvals become a tab (Phase 2). On md the list and the room sit
          side by side (the tab bar still switches the approvals slide-over);
          on lg all three panels sit side by side and this tab bar is hidden. */}
      {(mobileView !== "list" || isMd) && (
        <div className="mb-2 flex gap-2 lg:hidden">
          <button
            type="button"
            className={`btn-mini ${mobileView === "approvals" ? "" : "bg-surface-3 font-semibold"}`}
            onClick={() => setMobileView("room")}
          >
            Chat
          </button>
          {/* The approvals tab exists only for approvers with pending receipts
              (T-16.3) — staff never see it. */}
          {showApprovals && (
            <button
              type="button"
              className={`btn-mini ${mobileView === "approvals" ? "bg-surface-3 font-semibold" : ""}`}
              onClick={() => setMobileView("approvals")}
            >
              Approvals{pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
          )}
        </div>
      )}

      <div
        className={`relative grid min-h-0 flex-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)] ${
          showApprovals && approvalsOpen
            ? "lg:grid-cols-[300px_minmax(0,1fr)_340px]"
            : "lg:grid-cols-[300px_minmax(0,1fr)]"
        }`}
      >
        {/* ---------------- conversations ---------------- */}
        <aside
          className={`${
            mobileView === "list" ? "flex" : "hidden md:flex"
          } card min-h-0 flex-col space-y-2 p-3`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Chats</h2>
            <div className="flex items-center gap-1.5">
              {user?.role === "owner" && (
                <button className="btn-mini" onClick={() => setShowNewGroup(true)}>
                  New group
                </button>
              )}
              <button className="btn-mini" onClick={() => setShowNewChat(true)}>
                New chat
              </button>
            </div>
          </div>
          <div className="relative">
            <IconSearch
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              className="input input-icon h-9"
              placeholder="Search chats"
              aria-label="Search chats"
              value={listQuery}
              onChange={(event) => setListQuery(event.currentTarget.value)}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {loadingList &&
              [0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-2.5 px-2 py-2">
                  <span className="skeleton size-10 shrink-0 rounded-full" />
                  <span className="flex-1 space-y-1.5">
                    <span className="skeleton block h-3 w-2/3" />
                    <span className="skeleton block h-2.5 w-1/2" />
                  </span>
                </div>
              ))}
            {!loadingList && visibleConversations.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-muted">
                {listQuery.trim()
                  ? "No chat matches that search."
                  : "No chats yet — start one with New chat."}
              </p>
            )}
            {!loadingList &&
              visibleConversations.map((conversation) => {
                const name = conversationName(conversation);
                const active = conversation.room === room;
                const direct = conversation.kind === "direct";
                const online = isOnline(
                  members.find((entry) => entry.id === conversation.other?.id)?.lastSeenAt,
                  nowTick,
                );
                const preview = conversationPreview(
                  conversation.lastMessage ?? null,
                  conversation.kind === "group",
                );
                return (
                  <button
                    key={conversation.room}
                    onClick={() => void openRoom(conversation.room)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 ${
                      active ? "bg-surface-3" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-muted">
                      {direct ? initials(name) : <IconUsers size={16} />}
                      {direct && (
                        <span
                          aria-hidden="true"
                          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface ${
                            online ? "bg-secondary" : "bg-muted/40"
                          }`}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={`truncate text-sm ${
                            conversation.unread > 0 ? "font-semibold text-ink" : "text-ink"
                          }`}
                        >
                          {name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted">
                          {formatChatListTimeRow(conversation.lastMessageAt, new Date(nowTick))}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-xs ${
                            conversation.unread > 0 ? "font-medium text-ink" : "text-muted"
                          }`}
                        >
                          {preview || "No messages yet"}
                        </span>
                        {conversation.unread > 0 && (
                          <span className="badge bg-accent-soft px-1.5 text-[10px] text-accent-ink">
                            {conversation.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </aside>

        {/* ---------------- the room ---------------- */}
        <div
          className={`relative ${
            mobileView === "room" ? "flex" : "hidden md:flex"
          } min-h-0 flex-1 flex-col`}
        >
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative z-10 flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
            <button
              type="button"
              aria-label="Back to chats"
              className="tap-44 grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-ink md:hidden"
              onClick={() => setMobileView("list")}
            >
              <IconArrowLeft size={17} />
            </button>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-muted">
              {activeConversation?.kind === "direct" ? (
                initials(roomName)
              ) : (
                <IconUsers size={16} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {renaming ? (
                <form
                  className="flex w-full items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveName();
                  }}
                >
                  <input
                    className="input h-8 min-w-0 flex-1 py-1"
                    aria-label="Rename chat"
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
                <span className="flex min-w-0 items-center gap-1.5">
                  <h2 className="truncate text-sm font-semibold text-ink">{roomName}</h2>
                  {activeConversation?.kind === "group" && activeConversation.aiPolish && (
                    <span
                      className="badge shrink-0 bg-accent-soft px-1.5 text-[10px] text-accent-ink"
                      data-testid="ai-polish-chip"
                    >
                      ✨ AI polish on
                    </span>
                  )}
                </span>
              )}
              <p className="truncate text-[11px] text-muted">
                {typing
                  ? `${typing} is typing…`
                  : activeConversation?.kind === "direct"
                    ? `${presenceLabel(
                        members.find((entry) => entry.id === activeConversation.other?.id)
                          ?.lastSeenAt,
                        new Date(nowTick),
                      )} · Private — only you and ${activeConversation.other?.name ?? "them"} can read it`
                    : activeConversation?.kind === "group" && room !== SHARED_ROOM
                      ? `${roster.length} members · ${presence.length || onlineCount} online`
                      : `${members.length + 1} members · ${onlineCount} online`}
              </p>
            </div>
            <button
              type="button"
              aria-label="Search messages"
              title="Search in this chat"
              className={`tap-44 grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-3 ${
                showRoomSearch ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
              }`}
              onClick={() => {
                setShowRoomSearch((open) => !open);
                if (showRoomSearch) setRoomQuery("");
              }}
            >
              <IconSearch size={16} />
            </button>
            {activeConversation?.kind !== "direct" && (
              <button
                type="button"
                aria-label="Members"
                title="Members"
                className={`tap-44 hidden size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-3 sm:grid ${
                  showMembers ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
                }`}
                onClick={() => setShowMembers((open) => !open)}
              >
                <IconUsers size={16} />
              </button>
            )}
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="Chat menu"
                title="Chat menu"
                className={`tap-44 grid size-8 place-items-center rounded-full transition-colors hover:bg-surface-3 ${
                  menuOpen ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
                }`}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <IconMoreVertical size={16} />
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-10 z-20 w-48 space-y-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
                  {user?.role === "owner" && activeConversation?.kind === "group" && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                      onClick={() => {
                        setMenuOpen(false);
                        setNewName(roomName);
                        setRenaming(true);
                      }}
                    >
                      Rename
                    </button>
                  )}
                  {user?.role === "owner" && activeConversation?.kind === "group" && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                      onClick={() => void togglePolish()}
                      disabled={busy}
                    >
                      AI polish messages — {activeConversation.aiPolish ? "on" : "off"}
                    </button>
                  )}
                  {isOwnerGroup && (
                    <>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                        onClick={() => {
                          setMenuOpen(false);
                          setShowAddMembers(true);
                        }}
                      >
                        Add members
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                        onClick={() => {
                          setMenuOpen(false);
                          setShowRemoveMember(true);
                        }}
                      >
                        Remove member
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-error-ink transition-colors hover:bg-surface-2"
                        onClick={() => void archiveGroup()}
                        disabled={busy}
                      >
                        Archive group
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                    onClick={exportConversation}
                  >
                    <IconDownload size={13} /> Export chat
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                    onClick={toggleMute}
                  >
                    <IconBellOff size={13} /> {muted.includes(room) ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                    onClick={togglePin}
                  >
                    <IconPin size={13} /> {pinned.includes(room) ? "Unpin chat" : "Pin chat"}
                  </button>
                  </div>
                </>
              )}
            </div>
            {showMembers && activeConversation?.kind !== "direct" && (
              <>
                <button
                  type="button"
                  aria-label="Close members"
                  className="absolute inset-0 z-10 cursor-default"
                  onClick={() => setShowMembers(false)}
                />
                <div className="absolute left-3 right-3 top-14 z-20 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-lg sm:left-auto sm:right-3 sm:w-56">
                {roster.map((member) => (
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
              </>
            )}
          </div>
          {showRoomSearch && (
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
              <IconSearch size={14} className="shrink-0 text-muted" />
              <input
                className="input h-8 flex-1"
                placeholder="Search in this chat…"
                aria-label="Search in this chat"
                value={roomQuery}
                autoFocus
                onChange={(event) => setRoomQuery(event.currentTarget.value)}
              />
              {roomQuery.trim() && (
                <span className="shrink-0 text-[11px] text-muted">
                  {visibleMessages.length} match{visibleMessages.length === 1 ? "" : "es"}
                </span>
              )}
              <button
                type="button"
                className="btn-mini shrink-0"
                onClick={() => {
                  setRoomQuery("");
                  setShowRoomSearch(false);
                }}
              >
                Close
              </button>
            </div>
          )}
          <div
            ref={listRef}
            className="relative z-0 min-h-0 flex-1 space-y-1 overflow-y-auto bg-bg p-4"
            onScroll={onScroll}
          >
            {loadingRoom &&
              [0, 1, 2, 3].map((i) => (
                <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                  <span className="skeleton block h-9 w-2/3 max-w-[70%] rounded-2xl" />
                </div>
              ))}
            {!loadingRoom && sections.length === 0 && (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {roomQuery.trim() ? "No messages match that search" : "No messages yet"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {roomQuery.trim()
                      ? "Try a different word."
                      : "Say hello to the team — everyone in this chat sees it right away."}
                  </p>
                </div>
              </div>
            )}
            {!loadingRoom &&
              sections.map((section) => (
                <div key={section.key}>
                  <p className="my-2 text-center">
                    <span className="rounded-full border border-line bg-surface-2 px-3 py-0.5 text-[11px] text-muted">
                      {section.label}
                    </span>
                  </p>
                  {groupMessages(section.messages, user?.id ?? null).map((group) => {
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
                    const pendingReaders = otherMemberIds
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
                        <div className={`flex max-w-[80%] flex-col md:max-w-[65%] ${group.mine ? "items-end" : "items-start"}`}>
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
                            // T-16.2: the actions each message offers. Edit = own
                            // text within 15 minutes; Delete = own (owner: any),
                            // receipts only while pending; Copy + Info always.
                            const editable =
                              message.kind === "text" &&
                              !message.deleted &&
                              message.userId === user?.id &&
                              withinEditWindow(new Date(message.createdAt).getTime());
                            const deletable =
                              !message.deleted &&
                              (message.userId === user?.id || user?.role === "owner") &&
                              (message.kind !== "receipt" || receipt?.status === "pending");
                            return (
                              <div
                                key={message.id}
                                className="group/msg relative max-w-[80%] md:max-w-[65%]"
                                onPointerDown={() => {
                                  // A long press opens the action row on a phone.
                                  pressTimer.current = window.setTimeout(
                                    () => setActionsMessage(message.id),
                                    450,
                                  );
                                }}
                                onPointerUp={() => window.clearTimeout(pressTimer.current)}
                                onPointerLeave={() => window.clearTimeout(pressTimer.current)}
                              >
                                <div
                                  tabIndex={0}
                                  aria-label={`${group.author}: ${message.body}`}
                                  className={`chat-bubble outline-none rounded-2xl px-3.5 py-2 text-sm ${
                                    group.mine
                                      ? `bg-primary text-on-primary ${isLast ? "rounded-br-md" : "rounded-br-2xl"}`
                                      : `border border-line bg-surface text-ink ${isFirst ? "rounded-bl-md" : "rounded-bl-2xl"}`
                                  } ${isFirst ? "" : "mt-0.5"}`}
                                >
                                  {message.deleted ? (
                                    <span className="italic opacity-70">
                                      🚫 This message was deleted
                                    </span>
                                  ) : (
                                    <span>{message.body}</span>
                                  )}
                                  {!message.deleted && message.aiPolished && (
                                    <span title="Polished by AI" aria-label="Polished by AI" className="ml-0.5 text-[10px]">
                                      ✨
                                    </span>
                                  )}
                                  {!message.deleted && message.editedAt && (
                                    <span className="ml-1 text-[9px] italic opacity-70">edited</span>
                                  )}
                                  <span
                                    className={`chat-time ml-2 inline-block align-baseline text-[10px] ${
                                      group.mine ? "text-on-primary/70" : "text-muted"
                                    }`}
                                  >
                                    {formatChatTime(message.createdAt)}
                                  </span>
                                </div>
                                {/* The action row: hover on desktop, long-press on a
                                    phone (T-16.2). Clicking the bubble does nothing. */}
                                {!message.deleted && message.kind === "text" && (
                                  <div
                                    className={`${
                                      actionsMessage === message.id ? "flex" : "hidden"
                                    } group-hover/msg:flex ${
                                      group.mine ? "justify-end" : "justify-start"
                                    } mt-0.5 gap-0.5`}
                                  >
                                    <button
                                      type="button"
                                      aria-label="Copy message"
                                      title="Copy"
                                      className="grid size-7 place-items-center rounded-lg border border-line bg-surface-2 text-[12px] transition-colors hover:bg-surface-3"
                                      onClick={() => void copyMessage(message)}
                                    >
                                      📋
                                    </button>
                                    {editable && (
                                      <button
                                        type="button"
                                        aria-label="Edit message"
                                        title="Edit"
                                        className="grid size-7 place-items-center rounded-lg border border-line bg-surface-2 text-[12px] transition-colors hover:bg-surface-3"
                                        onClick={() => startEdit(message)}
                                      >
                                        ✏️
                                      </button>
                                    )}
                                    {deletable && (
                                      <button
                                        type="button"
                                        aria-label="Delete message"
                                        title="Delete"
                                        className="grid size-7 place-items-center rounded-lg border border-line bg-surface-2 text-[12px] transition-colors hover:bg-surface-3"
                                        onClick={() => {
                                          setActionsMessage(null);
                                          setConfirmDeleteId(message.id);
                                        }}
                                      >
                                        🗑
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      aria-label="Message info"
                                      title="Info"
                                      className="grid size-7 place-items-center rounded-lg border border-line bg-surface-2 text-[12px] transition-colors hover:bg-surface-3"
                                      onClick={() => {
                                        setActionsMessage(null);
                                        setInfoMessage(message);
                                      }}
                                    >
                                      ⓘ
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted">
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
                                      {pendingReaders.length > 0 && (
                                        <>
                                          <p className="pt-1 font-medium text-ink">Delivered, not read</p>
                                          {pendingReaders.map((name) => (
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
                </div>
              ))}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={send}
            className="relative z-10 border-t border-line bg-surface px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            {/* Editing lives in the composer, full width (T-16.2). */}
            {editing && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink">
                <span>✏️ Editing message — Enter saves, Esc cancels</span>
                <button
                  type="button"
                  aria-label="Cancel editing"
                  className="tap-44 -mr-2 grid size-7 place-items-center rounded-full transition-colors hover:bg-accent/15"
                  onClick={cancelEdit}
                >
                  ✕
                </button>
              </div>
            )}
            {/* The AI polish card (Phase 15): the member confirms before sending. */}
            {polishCard && (
              <div
                className="mb-2 rounded-xl bg-accent-soft px-3 py-2.5 text-accent-ink"
                role="note"
                aria-label="AI polish suggestion"
              >
                {polishCard.state === "waiting" && (
                  <p className="text-xs font-medium">✨ Polishing…</p>
                )}
                {polishCard.state === "failed" && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">AI not available — send original?</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-mini"
                        disabled={busy}
                        onClick={() => void sendMessage(polishCard.original, false)}
                      >
                        Send original
                      </button>
                      <button type="button" className="btn-mini" onClick={() => setPolishCard(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {polishCard.state === "ready" && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold">
                      ✨ {polishCard.keptOriginal ? "Kept original — numbers changed" : "Suggested"}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{polishCard.suggested}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-mini bg-primary font-semibold text-on-primary"
                        disabled={busy}
                        onClick={() => void sendMessage(polishCard.suggested, !polishCard.keptOriginal)}
                      >
                        Send suggested
                      </button>
                      <button
                        type="button"
                        className="btn-mini"
                        disabled={busy}
                        onClick={() => void sendMessage(polishCard.original, false)}
                      >
                        Send original
                      </button>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => {
                          setDraft(polishCard.suggested);
                          setPolishCard(null);
                          composerRef.current?.focus();
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex w-full items-end gap-2 rounded-[20px] border border-line bg-surface-2 px-2 py-2 transition-colors focus-within:border-primary">
              <button
                type="button"
                aria-label="Attach receipt"
                title="Attach receipt"
                className="tap-44 grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-ink"
                onClick={() => setShowReceiptForm((open) => !open)}
              >
                <IconPaperclip size={17} />
              </button>
              <details className="group/emoji relative shrink-0">
                <summary
                  className="tap-44 grid size-9 cursor-pointer list-none place-items-center rounded-full text-muted transition-colors hover:bg-surface-3 hover:text-ink [&::-webkit-details-marker]:hidden"
                  aria-label="Emoji"
                >
                  <IconSmile size={17} />
                </summary>
                <div className="absolute bottom-11 left-0 z-20 hidden w-44 flex-wrap gap-1 rounded-xl border border-line bg-surface p-2 shadow-lg group-open/emoji:flex">
                  {EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="grid size-8 place-items-center rounded-lg text-base transition-colors hover:bg-surface-2"
                      onClick={() => {
                        setDraft((current) => current + emoji);
                        composerRef.current?.focus();
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </details>
              <textarea
                ref={composerRef}
                className="chat-composer flex-1 px-3.5 py-2.5 text-sm"
                rows={1}
                placeholder={editing ? "Edit your message…" : "Message…"}
                aria-label="Message"
                value={editing ? editDraft : draft}
                onChange={(e) => {
                  if (editing) setEditDraft(e.currentTarget.value);
                  else {
                    setDraft(e.currentTarget.value);
                    sendTyping();
                  }
                }}
                onKeyDown={(e) => {
                  // Editing: Enter saves, Esc cancels (T-16.2).
                  if (editing) {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                    return;
                  }
                  // Enter sends, Shift+Enter makes a new line — but on a
                  // touch phone the return key ALWAYS makes a new line
                  // (WhatsApp behaviour): the send button sends.
                  if (e.key === "Enter" && !e.shiftKey && !isCoarse) {
                    e.preventDefault();
                    void submitDraft();
                  }
                  // Escape closes the AI polish card (the draft stays).
                  if (e.key === "Escape" && polishCard) {
                    e.preventDefault();
                    setPolishCard(null);
                  }
                }}
                disabled={busy}
                maxLength={2000}
              />
              <button
                type="submit"
                aria-label={editing ? "Save edit" : "Send"}
                disabled={busy || !(editing ? editDraft.trim() : draft.trim())}
                className="tap-44 grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-all duration-150 hover:bg-primary-hover disabled:bg-surface-3 disabled:text-muted"
              >
                <IconSend size={16} />
              </button>
            </div>
          </form>

          {showReceiptForm && (
            <form
              onSubmit={sendReceipt}
              className="relative z-10 space-y-3 border-t border-line bg-surface-2 p-3"
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
              className="absolute right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-lg"
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

        {/* ---------------- approvals (T-16.3: approvers only, only while pending) ---------------- */}
        {showApprovals && (approvalsOpen || mobileView === "approvals") && (
        <aside
          className={`${
            mobileView === "approvals"
              ? "flex md:absolute md:inset-y-0 md:right-0 md:z-20 md:w-80 md:shadow-2xl"
              : "hidden"
          } card min-h-0 flex-col space-y-3 p-4 lg:static lg:inset-auto lg:z-auto lg:w-auto lg:shadow-none lg:flex`}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Receipt approvals</h2>
            <span className="flex items-center gap-1.5">
              <span className="badge bg-accent-soft text-accent-ink">{pending.length} pending</span>
              <button
                type="button"
                aria-label="Collapse approvals"
                className="hidden size-7 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink lg:grid"
                onClick={() => toggleApprovals(false)}
              >
                <IconChevronDown size={14} className="rotate-90" />
              </button>
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
            </div>
        </aside>
        )}
      </div>

      {showNewChat && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 p-4">
          <div className="card w-full max-w-md space-y-2 p-4">
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
        </div>
      )}

      {showNewGroup && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 p-4">
          <div className="card w-full max-w-md space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">New group</h2>
              <button className="btn-mini" onClick={() => setShowNewGroup(false)}>
                Close
              </button>
            </div>
            <input
              className="input h-9"
              placeholder="Group name (e.g. Purchase team)"
              aria-label="Group name"
              value={groupTitle}
              onChange={(event) => setGroupTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createGroup();
              }}
            />
            <div className="space-y-1">
              <p className="text-xs text-muted">Pick the members — you are part of the group too.</p>
              <div className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`btn-mini ${groupPicks.includes(member.id) ? "bg-accent-soft text-accent-ink font-semibold" : ""}`}
                    aria-pressed={groupPicks.includes(member.id)}
                    onClick={() =>
                      setGroupPicks((prev) =>
                        prev.includes(member.id)
                          ? prev.filter((id) => id !== member.id)
                          : [...prev, member.id],
                      )
                    }
                  >
                    {groupPicks.includes(member.id) ? "✓ " : ""}
                    {member.name}
                  </button>
                ))}
                {members.length === 0 && <p className="text-sm text-muted">Nobody to add yet.</p>}
              </div>
            </div>
            <button className="btn w-full" disabled={busy || !groupTitle.trim()} onClick={() => void createGroup()}>
              Create group
            </button>
          </div>
        </div>
      )}

      {showAddMembers && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 p-4">
          <div className="card w-full max-w-md space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Add members to {roomName}</h2>
              <button className="btn-mini" onClick={() => setShowAddMembers(false)}>
                Done
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {groupOutsiders.map((member) => (
                <button
                  key={member.id}
                  className="btn-mini"
                  disabled={busy}
                  onClick={() => void addToGroup(member)}
                >
                  + {member.name}
                </button>
              ))}
              {groupOutsiders.length === 0 && (
                <p className="text-sm text-muted">Everybody is already in this group.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {showRemoveMember && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 p-4">
          <div className="card w-full max-w-md space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Remove a member</h2>
              <button className="btn-mini" onClick={() => setShowRemoveMember(false)}>
                Done
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {groupRemovable.map((member) => (
                <button
                  key={member.id}
                  className="btn-mini"
                  disabled={busy}
                  onClick={() => void removeFromGroup(member)}
                >
                  {member.name}
                </button>
              ))}
              {groupRemovable.length === 0 && (
                <p className="text-sm text-muted">There is nobody to remove.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId != null && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 p-4">
          <div className="card w-full max-w-sm space-y-3 p-4">
            <h2 className="text-sm font-semibold text-ink">Delete this message?</h2>
            <p className="text-xs text-muted">
              The team will see "This message was deleted" instead of the text.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-mini bg-error-soft text-error-ink"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
              <button type="button" className="btn-mini" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {infoMessage && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-bg/60 p-4">
          <div className="card w-full max-w-sm space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Message info</h2>
              <button type="button" className="btn-mini" onClick={() => setInfoMessage(null)}>
                Close
              </button>
            </div>
            <p className="text-xs text-muted">
              {infoMessage.author} · sent {formatChatTime(infoMessage.createdAt)}
            </p>
            <p className="text-xs text-muted">
              Seen by:{" "}
              {(infoMessage.readBy ?? []).length > 0
                ? (infoMessage.readBy ?? [])
                    .map((id) => members.find((m) => m.id === id)?.name ?? `#${id}`)
                    .join(", ")
                : "nobody yet"}
            </p>
            <p className="text-xs text-muted">
              Delivered to:{" "}
              {(infoMessage.deliveredBy ?? []).length > 0
                ? (infoMessage.deliveredBy ?? [])
                    .map((id) => members.find((m) => m.id === id)?.name ?? `#${id}`)
                    .join(", ")
                : "nobody yet"}
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success-ink">{notice}</p>
      )}
    </section>
  );
}
