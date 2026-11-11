/**
 * Chat room — the 1:1 / group chat screen (Phase 2).
 *
 * Full WhatsApp-style chat:
 * - Message bubbles (mine right, theirs left) with sender names
 * - Delivery / read ticks (✓ sent, ✓✓ grey, ✓✓ blue when read)
 * - Typing indicator (live via WebSocket)
 * - Date separators ("Today", "Yesterday")
 * - Notification sound on incoming message
 * - Auto-scroll to the newest message
 * - Message info panel (1:1: Read / Delivered times)
 *
 * Backend: the SAME Cloudflare Worker WebSocket protocol (Durable Object).
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  Modal,
  Alert,
  Image,
} from "react-native";

import { api, type ChatMessage, type ChatPin, type ChatReceipt } from "../../../lib/api";
import { useAuth } from "../../_layout";
import { playNotificationSound } from "../../../lib/notificationSound";
import { membersOf } from "../../../lib/chatPrivacy";
import {
  REACTION_EMOJIS,
  formatRupees,
  groupReactions,
  isOnline,
  mentionIdsFor,
  polishSkipReason,
  presenceLabel,
  receiptStatusLabel,
  receiptStatusTone,
  withinEditWindow,
} from "../../../lib/chatView";

// ---- helpers (same as the web app's logic) ----

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours() % 12 || 12).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const weeks = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${weeks[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Which tick does this message get? (same rules as web) */
function tickFor(message: ChatMessage, otherId: number | null): "sent" | "delivered" | "read" | null {
  if (!otherId) return null;
  const delivered = message.deliveredBy?.includes(otherId) ?? false;
  const read = message.readBy?.includes(otherId) ?? false;
  if (read) return "read";
  if (delivered) return "delivered";
  return "sent";
}

/**
 * A message row on this screen: a server row plus client-only flags.
 * `pending` = optimistic bubble waiting for the POST (⏱);
 * `failed` = the POST failed (⚠, tap to retry).
 */
type LocalMessage = ChatMessage & { pending?: boolean; failed?: boolean };

/** A client-only id for an optimistic message (module scope — Date.now is safe here). */
function nextTempId(): number {
  return -Date.now();
}

export default function ChatRoomScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();
  const { room, title } = useLocalSearchParams<{ room: string; title?: string }>();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState<string | null>(null);
  /** The send that just failed — backs the ⚠ bubble's Retry / Discard. */
  const [failedSend, setFailedSend] = useState<{
    tempId: number;
    text: string;
    aiPolished: boolean;
    replyToId?: number;
    mentions: number[];
    error: string;
  } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  /** Which message the Message-info panel is open for (was: always the last own one). */
  const [infoFor, setInfoFor] = useState<ChatMessage | null>(null);
  const [infoData, setInfoData] = useState<{ readAt: string | null; deliveredAt: string | null } | null>(null);
  const [connected, setConnected] = useState(false);
  // Web-parity header: menu, in-chat search, member info.
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [roomQuery, setRoomQuery] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<{ id: number; name: string; role: string; lastSeenAt?: string | null }[]>([]);
  const [roster, setRoster] = useState<{ id: number; name: string; role: string; lastSeenAt?: string | null }[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const searchPos = useRef(0);
  const listRef = useRef<FlatList>(null);
  // ---- message-level parity (phase 2) ----
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  /** The message whose long-press action sheet is open. */
  const [actionFor, setActionFor] = useState<ChatMessage | null>(null);
  /** The message whose inline emoji picker is open. */
  const [reactPickerFor, setReactPickerFor] = useState<number | null>(null);
  /** Transient "Copied ✓" flash after a clipboard copy. */
  const [copied, setCopied] = useState(false);
  // ---- receipt send (composer attach → upload → receipt message) ----
  const [receipts, setReceipts] = useState<ChatReceipt[]>([]);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [receiptFile, setReceiptFile] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [receiptTitle, setReceiptTitle] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  /** The message just flashed by a reply/pin jump. */
  const [flashId, setFlashId] = useState<number | null>(null);
  const [pins, setPins] = useState<ChatPin[]>([]);
  // ---- unread divider + jump FAB (client-only, web newSinceScroll) ----
  const [atBottom, setAtBottom] = useState(true);
  const [newIds, setNewIds] = useState<number[]>([]);
  /** Ref mirror of atBottom — the WS handler runs outside React renders. */
  const atBottomRef = useRef(true);
  // ---- AI polish (owner turned it on for this group) ----
  const [aiPolishEnabled, setAiPolishEnabled] = useState(false);
  const [polish, setPolish] = useState<
    | null
    | { stage: "waiting"; original: string }
    | { stage: "ready"; original: string; suggested: string; keptOriginal?: boolean }
    | { stage: "failed"; original: string }
  >(null);
  const socketRef = useRef<WebSocket | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  // The other person of this 1:1 chat (for the ticks).
  const otherId = useMemo(() => {
    const dm = membersOf(room);
    if (!dm || !user) return null;
    return dm.userId === user.id ? dm.otherId : dm.userId;
  }, [room, user?.id]);

  // Load history.
  const loadHistory = useCallback(async () => {
    try {
      const [history, receiptList] = await Promise.all([
        api.chatMessages(room),
        api.chatReceipts(room).catch(() => ({ receipts: [] as ChatReceipt[], pending: 0 })),
      ]);
      setMessages(history.messages);
      setReceipts(receiptList.receipts);
    } catch {
      // Offline — keep whatever the socket already gave us.
    } finally {
      setLoading(false);
    }
  }, [room]);

  // Open the room on the NEWEST message. Android hydrates rows progressively:
  // scrollToEnd fired too early (even twice) still lands on the OLDEST
  // messages once more rows render beneath it. So keep scrolling until the
  // list's own scroll state reports we are genuinely at the bottom.
  const initiallyScrolledRoomRef = useRef<string | null>(null);
  const initialScrollTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loading || messages.length === 0) return;
    if (initiallyScrolledRoomRef.current === room) return;
    initiallyScrolledRoomRef.current = room;
    let tries = 0;
    const tick = () => {
      tries += 1;
      // The first few scrolls unconditionally pin the bottom (atBottomRef can
      // still be stale-true before the first scroll event); after that, only
      // retry while the list says we are NOT at the bottom.
      if (tries > 3 && atBottomRef.current) return;
      listRef.current?.scrollToEnd({ animated: false });
      if (tries >= 16) return;
      initialScrollTickRef.current = setTimeout(tick, 250);
    };
    initialScrollTickRef.current = setTimeout(tick, 150);
    return () => {
      if (initialScrollTickRef.current) clearTimeout(initialScrollTickRef.current);
    };
  }, [loading, messages, room]);

  // Mark the room as read when this screen opens.
  useEffect(() => {
    void api.markChatRead(room).catch(() => undefined);
  }, [room]);

  // Members (presence) for the header subtitle + Group/Contact info — same as web.
  useEffect(() => {
    let alive = true;
    const isDm = membersOf(room) !== null;
    void api
      .chatMembers()
      .then((r) => { if (alive) setMembers(r.members); })
      .catch(() => undefined);
    if (!isDm) {
      void api
        .chatGroupMembers(room)
        .then((r) => { if (alive) setRoster(r.members); })
        .catch(() => undefined);
      // The owner's AI-polish toggle for this group (gates the polish card).
      void api
        .chatConversations()
        .then((r) => {
          if (alive) setAiPolishEnabled(Boolean(r.conversations.find((c) => c.room === room)?.aiPolish));
        })
        .catch(() => undefined);
    }
    return () => { alive = false; };
  }, [room]);

  // Refresh presence labels every 30s (web ticks every 1s).
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load message info when the info panel opens (1:1: Read / Delivered times).
  useEffect(() => {
    if (!showInfo || !infoFor) return;
    void api
      .chatMessageInfo(infoFor.id)
      .then((info) => {
        const receipt = info.receipts.find((r) => r.userId === otherId) ?? null;
        setInfoData({ deliveredAt: receipt?.deliveredAt ?? null, readAt: receipt?.readAt ?? null });
      })
      .catch(() => undefined);
  }, [showInfo, infoFor, otherId]);

  // The room's pinned messages (owner pins, at most three) — web loads on room change.
  useEffect(() => {
    let alive = true;
    void api
      .chatPins(room)
      .then((r) => { if (alive) setPins(r.pins); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [room]);

  // WebSocket: the same Durable Object protocol as the web app.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;

    async function connect() {
      try {
        // History comes over REST (same as web TeamChat) — the WS only relays live frames.
        await loadHistory();
        const { token } = await api.chatToken();
        if (closed) return;
        socket = new WebSocket(`wss://sdhhe-api.blvphani.workers.dev/api/chat/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`);
        socketRef.current = socket;
        socket.onopen = () => setConnected(true);
        socket.onclose = () => {
          setConnected(false);
          if (!closed) setTimeout(() => void connect(), 5000);
        };
        socket.onmessage = (event) => {
          try {
            const frame = JSON.parse(String(event.data));
            const f = frame as { type?: string; message?: ChatMessage; messageIds?: number[]; userId?: number; name?: string };
            if (f.type === "message" && f.message) {
              setMessages((prev) => (prev.some((m) => m.id === f.message!.id) ? prev : [...prev, f.message!]));
              if (f.message.userId !== user?.id) {
                void api.markChatDelivered(f.message.id).catch(() => undefined);
                void playNotificationSound();
                // Not at the bottom → remember it for the "New messages" divider.
                if (!atBottomRef.current) {
                  setNewIds((prev) => (prev.includes(f.message!.id) ? prev : [...prev, f.message!.id]));
                }
              }
            }
            if (f.type === "delivered" || f.type === "read") {
              const ids = (f.messageIds ?? []) as number[];
              const key = f.type === "read" ? "readBy" : "deliveredBy";
              setMessages((prev) =>
                prev.map((m) => {
                  if (!ids.includes(m.id)) return m;
                  const list = (m[key] ?? []) as number[];
                  if (list.includes(f.userId as number)) return m;
                  return { ...m, [key]: [...list, f.userId as number] } as ChatMessage;
                }),
              );
            }
            if (f.type === "typing" && f.name) {
              setTyping(`${f.name} is typing…`);
              if (typingTimer.current) clearTimeout(typingTimer.current);
              typingTimer.current = setTimeout(() => setTyping(null), 3000);
            }
            if (f.type === "reaction") {
              const rf = f as { messageId?: number; reactions?: ChatMessage["reactions"] };
              if (typeof rf.messageId === "number") {
                setMessages((prev) =>
                  prev.map((m) => (m.id === rf.messageId ? { ...m, reactions: rf.reactions ?? [] } : m)),
                );
              }
            }
            if (f.type === "update" && f.message) {
              setMessages((prev) => prev.map((m) => (m.id === f.message!.id ? f.message! : m)));
            }
            if (f.type === "pins") {
              void api.chatPins(room).then((r) => setPins(r.pins)).catch(() => undefined);
            }
            if (f.type === "receipt") {
              const ff = f as { receipt?: ChatReceipt; message?: ChatMessage };
              if (ff.message) {
                setMessages((prev) => (prev.some((m) => m.id === ff.message!.id) ? prev : [...prev, ff.message!]));
              }
              if (ff.receipt) {
                setReceipts((prev) => [ff.receipt!, ...prev.filter((r) => r.id !== ff.receipt!.id)]);
              }
            }
          } catch {
            // Malformed frame — ignore.
          }
        };
      } catch {
        // Server not reachable — retries.
      }
    }

    void connect();
    return () => {
      closed = true;
      socketRef.current?.close();
    };
  }, [room, user?.id, loadHistory]);

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    socketRef.current?.send(JSON.stringify({ type: "typing", userId: user?.id ?? 0, name: user?.name ?? "" }));
  }

  async function send() {
    // Editing swaps the send button into "Save edit" (web: composer swap).
    if (editing) {
      const text = editDraft.trim();
      if (!text) return;
      try {
        const { message } = await api.editChatMessage(editing.id, text);
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
        setEditing(null);
        setEditDraft("");
      } catch (err) {
        // Keep the composer in edit mode so nothing is lost.
        Alert.alert("Couldn't edit", err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const text = draft.trim();
    if (!text) return;
    setDraft("");

    // AI polish (owner on): ask first, the card offers Suggested / Original.
    if (aiPolishEnabled && isGroup && polishSkipReason(text) === null) {
      setPolish({ stage: "waiting", original: text });
      try {
        const res = await api.polishChatMessage(room, text);
        if (res.skipped) {
          setPolish(null);
          await sendText(text, false);
        } else if (res.polished) {
          setPolish({ stage: "ready", original: text, suggested: res.polished, keptOriginal: res.keptOriginal });
        } else {
          setPolish({ stage: "failed", original: text });
        }
      } catch {
        setPolish({ stage: "failed", original: text });
      }
      return;
    }

    await sendText(text, false);
  }

  /** The actual POST (aiPolished marks the ✨ badge — web sendMessage). */
  async function sendText(text: string, aiPolished: boolean) {
    const tempId = nextTempId();
    const replyToId = replyingTo?.id;
    const mentions = mentionIdsFor(text, members);
    // Optimistic, WhatsApp-style: the bubble appears the instant Send is
    // tapped (⏱) — the server row replaces it when the POST lands.
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        room,
        userId: user?.id ?? null,
        author: user?.name ?? "",
        role: user?.role ?? "",
        kind: "text",
        body: text,
        receiptId: null,
        createdAt: new Date().toISOString(),
        replyToId,
        pending: true,
      },
    ]);
    setReplyingTo(null);
    await deliverText(text, aiPolished, tempId, replyToId, mentions);
  }

  /** POST the message and settle the optimistic bubble (id < 0) it belongs to. */
  async function deliverText(
    text: string,
    aiPolished: boolean,
    tempId: number,
    replyToId?: number,
    mentions?: number[],
  ) {
    try {
      const { message } = await api.sendChatMessage({
        kind: "text",
        body: text,
        room,
        replyToId,
        mentions: mentions?.length ? mentions : undefined,
        aiPolished: aiPolished || undefined,
      });
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        // The WS echo may have landed the real row first — never show both.
        return withoutTemp.some((m) => m.id === message.id) ? withoutTemp : [...withoutTemp, message];
      });
    } catch (err) {
      // Keep the bubble (⚠) so nothing is lost — tap it to retry or discard.
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      setFailedSend({
        tempId,
        text,
        aiPolished,
        replyToId,
        mentions: mentions ?? [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Retry the last failed send — the ⚠ bubble goes back to ⏱. */
  function retryFailedSend() {
    if (!failedSend) return;
    const { tempId, text, aiPolished, replyToId, mentions } = failedSend;
    setFailedSend(null);
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: true, failed: false } : m)));
    void deliverText(text, aiPolished, tempId, replyToId, mentions);
  }

  /** Discard the failed bubble (user chose not to retry). */
  function discardFailedSend() {
    if (!failedSend) return;
    const { tempId } = failedSend;
    setFailedSend(null);
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
  }

  /** Toggle my reaction on a message (one per member — a new emoji replaces the old). */
  async function toggleReaction(message: ChatMessage, emoji: string) {
    const mine = (message.reactions ?? []).find((r) => r.userId === user?.id);
    const optimistic = (message.reactions ?? []).filter((r) => r.userId !== user?.id);
    if (mine && mine.emoji === emoji) {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, reactions: optimistic } : m)));
      void api.unreactChatMessage(message.id).catch(() => undefined);
    } else {
      const next = [...optimistic, { emoji, userId: user?.id ?? 0, name: user?.name ?? "" }];
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, reactions: next } : m)));
      void api.reactChatMessage(message.id, emoji).catch(() => undefined);
    }
    setReactPickerFor(null);
    setActionFor(null);
  }

  /** Owner pins/unpins in a group room (max three) — web toggleMessagePin. */
  async function togglePin(message: ChatMessage) {
    setActionFor(null);
    const already = pins.some((p) => p.messageId === message.id);
    try {
      if (already) {
        await api.unpinChatMessage(message.id);
        setPins((prev) => prev.filter((p) => p.messageId !== message.id));
      } else {
        const { pins: next } = await api.pinChatMessage(room, message.id);
        setPins(next);
        Alert.alert("Pinned", "At most three messages stay pinned.");
      }
    } catch (err) {
      Alert.alert("Couldn't pin", err instanceof Error ? err.message : String(err));
    }
  }

  /** Soft-delete my message (or any, as owner) — the team sees a tombstone. */
  function confirmDelete(message: ChatMessage) {
    setActionFor(null);
    Alert.alert(
      "Delete this message?",
      "The team will see “This message was deleted” instead of the text.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void api
              .deleteChatMessage(message.id)
              .then(({ message: updated }) =>
                setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))),
              )
              .catch((err) => Alert.alert("Couldn't delete", err instanceof Error ? err.message : String(err)));
          },
        },
      ],
    );
  }

  /** Jump to a message (reply quote / pin chip) and flash it — web scrollToMessage. */
  function scrollToMessage(messageId: number) {
    const index = rows.findIndex((row) => !("isDay" in row) && (row as ChatMessage).id === messageId);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
    setFlashId(messageId);
    setTimeout(() => setFlashId((current) => (current === messageId ? null : current)), 1600);
  }

  /** Start editing my message (15-minute window) — the composer swaps. */
  function startEdit(message: ChatMessage) {
    setActionFor(null);
    setReplyingTo(null);
    setEditing(message);
    setEditDraft(message.body);
  }

  // ---- receipt send (web sendReceipt: upload the file, then post the message) ----

  /** Pick a receipt photo from the gallery (Expo ImagePicker, SDK 58 API). */
  async function pickReceiptFile(fromCamera: boolean) {
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setReceiptError("Camera permission is needed to photograph a receipt");
        return;
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setReceiptError("Photo library permission is needed to attach a receipt");
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.85 };
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setReceiptFile({
      uri: asset.uri,
      name: asset.fileName ?? `receipt-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    });
    setReceiptError(null);
  }

  /** Upload the file, then send the receipt message (web: uploadChatReceipt → sendChatMessage). */
  async function sendReceipt() {
    if (!receiptFile || receiptBusy) return;
    const rupees = Number(receiptAmount);
    if (!receiptTitle.trim()) {
      setReceiptError("Give the receipt a title");
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setReceiptError("Enter the amount in rupees");
      return;
    }
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      const stored = await api.uploadChatReceipt(receiptFile);
      const { message, receipt } = await api.sendChatMessage({
        kind: "receipt",
        body: receiptTitle.trim(),
        room,
        receipt: {
          ...stored,
          title: receiptTitle.trim(),
          amountPaise: Math.round(rupees * 100),
          note: receiptNote.trim() || undefined,
        },
      });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (receipt) setReceipts((prev) => [receipt, ...prev.filter((r) => r.id !== receipt.id)]);
      setShowReceiptForm(false);
      setReceiptFile(null);
      setReceiptTitle("");
      setReceiptAmount("");
      setReceiptNote("");
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : String(err));
    } finally {
      setReceiptBusy(false);
    }
  }

  // Web `filterMessages` — the in-chat search matches body + author.
  const visibleMessages = useMemo(() => {
    const needle = roomQuery.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter(
      (m) => m.body.toLowerCase().includes(needle) || m.author.toLowerCase().includes(needle),
    );
  }, [messages, roomQuery]);

  // Group messages by day for the date separators.
  const daySections = useMemo(() => {
    const sections: { key: string; label: string; items: ChatMessage[] }[] = [];
    for (const message of visibleMessages) {
      const key = new Date(message.createdAt).toISOString().slice(0, 10);
      const last = sections[sections.length - 1];
      if (last && last.key === key) {
        last.items.push(message);
      } else {
        sections.push({ key, label: dayLabel(message.createdAt), items: [message] });
      }
    }
    return sections;
  }, [visibleMessages]);

  // Flatten into rows (date chips + bubbles). Plain derivation — the React
  // Compiler memoizes it; a manual useMemo here trips preserve-manual-memoization.
  const result: (ChatMessage | { isDay: true; key: string; label: string })[] = [];
  for (const section of daySections) {
    result.push({ isDay: true, key: section.key, label: section.label });
    for (const item of section.items) result.push(item as ChatMessage);
  }
  const rows = result;

  // Row indexes of the current search matches (for the ↑ / ↓ jump, web jumpMark).
  const matchIndices: number[] = [];
  {
    const needle = roomQuery.trim().toLowerCase();
    if (needle) {
      rows.forEach((row, index) => {
        if ("isDay" in row) return;
        const m = row as ChatMessage;
        if (m.body.toLowerCase().includes(needle) || m.author.toLowerCase().includes(needle)) {
          matchIndices.push(index);
        }
      });
    }
  }

  function jumpMark(direction: number) {
    if (matchIndices.length === 0) return;
    searchPos.current = (searchPos.current + direction + matchIndices.length) % matchIndices.length;
    const index = matchIndices[searchPos.current]!;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
  }

  // ---- header values (same rules as the web ChatHeader) ----
  const isDm = membersOf(room) !== null;
  const isGroup = !isDm;
  const displayName = title ?? room;
  const otherMember = isDm ? members.find((m) => m.id === otherId) : null;
  const onlineCount = (isDm ? members : roster).filter((m) => isOnline(m.lastSeenAt, nowTick)).length;
  const memberCount = isDm
    ? 2
    : room === "main"
      ? members.length + 1
      : roster.length || members.length + 1;
  const presence = isDm
    ? presenceLabel(otherMember?.lastSeenAt, new Date(nowTick))
    : `${memberCount} members · ${onlineCount} online`;
  const subtitle = typing ? typing : !connected ? "connecting…" : presence;
  // Group info's rows (direct: just the other person).
  const infoMembers = isDm
    ? members.filter((m) => m.id === otherId)
    : roster.length
      ? roster
      : members;
  const infoSubtitle = isDm ? presence : `Group · ${memberCount} members`;

  // @mention autocomplete (web: trailing @token → up to 6 member chips).
  const mentionToken = editing
    ? null
    : (/@([^\s@]*)$/.exec(draft)?.[1]?.toLowerCase() ?? null);
  const mentionCandidates =
    mentionToken === null
      ? []
      : (isGroup && roster.length ? roster : members)
          .filter((m) => m.name.toLowerCase().startsWith(mentionToken))
          .slice(0, 6);

  function pickMention(name: string) {
    setDraft((prev) => prev.replace(/@[^\s@]*$/, `@${name} `));
  }

  // The first message that arrived while scrolled up → the divider sits above it.
  const firstNew = newIds.length ? Math.min(...newIds) : null;

  /** FlatList onScroll — track the bottom for the divider + jump FAB. */
  function handleScroll(event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const bottom = distanceFromBottom < 80;
    if (bottom !== atBottomRef.current) {
      atBottomRef.current = bottom;
      setAtBottom(bottom);
      if (bottom) setNewIds([]); // reaching the bottom wipes the divider (web behaviour)
    }
  }

  /** FAB: jump to the newest message. */
  function jumpToLatest() {
    listRef.current?.scrollToEnd({ animated: true });
    atBottomRef.current = true;
    setAtBottom(true);
    setNewIds([]);
  }

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* ---- Chat header — web ChatHeader spec: 56px, back / who / call video menu ---- */}
      <View style={[styles.chatHeader, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
        <TouchableOpacity
          style={styles.headerIcon}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={theme.muted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerWho}
          onPress={() => setShowMembers(true)}
          accessibilityRole="button"
          accessibilityLabel="Open info"
          activeOpacity={0.7}
        >
          <View style={[styles.headerAvatar, { backgroundColor: theme.surface3 }]}>
            {isGroup ? (
              <Ionicons name="people" size={18} color={theme.muted} />
            ) : (
              <Text style={{ fontSize: 14, fontWeight: "600", color: theme.muted }}>{initials(displayName)}</Text>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink }}>
              {displayName}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.muted }}>
              {subtitle}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Voice call"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            onPress={() => Alert.alert("Voice calls aren't available yet")}
          >
            <Ionicons name="call" size={19} color={theme.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Video call"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            onPress={() => Alert.alert("Video calls aren't available yet")}
          >
            <Ionicons name="videocam" size={19} color={theme.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Chat menu"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
            onPress={() => setMenuOpen((open) => !open)}
          >
            <Ionicons name="ellipsis-vertical" size={19} color={theme.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ---- ⋮ menu (web .chat-header__menu — Mute/Clear omitted: no prefs store yet) ---- */}
      {menuOpen && (
        <>
          <Pressable style={[StyleSheet.absoluteFill, { zIndex: 30 }]} onPress={() => setMenuOpen(false)} />
          <View
            style={[
              styles.headerMenu,
              { backgroundColor: theme.surface, borderColor: theme.line, shadowColor: theme.shadow },
            ]}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setRoomQuery("");
                setShowSearch(true);
              }}
            >
              <Ionicons name="search" size={16} color={theme.ink} />
              <Text style={[styles.menuText, { color: theme.ink }]}>Search in chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setShowMembers(true);
              }}
            >
              <Ionicons name="people" size={16} color={theme.ink} />
              <Text style={[styles.menuText, { color: theme.ink }]}>
                {isGroup ? "Group info" : "Contact info"}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ---- In-chat search (web: filter + "N matches" + ↑ / ↓ + Close) ---- */}
      {showSearch && (
        <View style={[styles.searchBar, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
          <Ionicons name="search" size={14} color={theme.muted} />
          <TextInput
            style={[styles.searchInput, { color: theme.ink }]}
            placeholder="Search in this chat…"
            placeholderTextColor={theme.muted}
            value={roomQuery}
            autoFocus
            autoCorrect={false}
            onChangeText={(value) => {
              setRoomQuery(value);
              searchPos.current = 0;
            }}
          />
          {roomQuery.trim() ? (
            <Text style={{ fontSize: 11, color: theme.muted, flexShrink: 0 }}>
              {matchIndices.length} match{matchIndices.length === 1 ? "" : "es"}
            </Text>
          ) : null}
          {roomQuery.trim() ? (
            <>
              <TouchableOpacity
                style={styles.jumpBtn}
                accessibilityLabel="Previous match"
                onPress={() => jumpMark(-1)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Ionicons name="chevron-up" size={16} color={theme.muted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.jumpBtn}
                accessibilityLabel="Next match"
                onPress={() => jumpMark(1)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Ionicons name="chevron-down" size={16} color={theme.muted} />
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            accessibilityLabel="Close search"
            onPress={() => {
              setRoomQuery("");
              setShowSearch(false);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontSize: 12, color: theme.primary, fontWeight: "600" }}>Close</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Pinned messages bar (owner pins, max 3) — tap jumps + flashes ---- */}
      {pins.length > 0 && (
        <View style={[styles.pinBar, { backgroundColor: theme.surface2, borderBottomColor: theme.line }]}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: theme.accentInk }}>📌</Text>
          {pins.map((pin) => (
            <TouchableOpacity
              key={pin.id}
              style={[styles.pinChip, { backgroundColor: theme.surface, borderColor: theme.line }]}
              onPress={() => scrollToMessage(pin.messageId)}
              activeOpacity={0.7}
            >
              <Text numberOfLines={1} style={{ fontSize: 11, color: theme.ink }}>
                {pin.author}: {pin.body}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ---- Message info (1:1: Read / Delivered times) ---- */}
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <Pressable style={[styles.modalBackdrop]} onPress={() => setShowInfo(false)}>
          <View style={[styles.infoCard, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: theme.ink }}>Message info</Text>
              <TouchableOpacity onPress={() => setShowInfo(false)}>
                <Text style={{ color: theme.primary, fontSize: 14 }}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={{ marginTop: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: theme.ink }}>Read</Text>
                <Text style={{ fontSize: 13, color: theme.muted }}>{infoData?.readAt ? timeLabel(infoData.readAt) : "—"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: theme.ink }}>Delivered</Text>
                <Text style={{ fontSize: 13, color: theme.muted }}>{infoData?.deliveredAt ? timeLabel(infoData.deliveredAt) : "—"}</Text>
              </View>
              <Text style={{ fontSize: 11, color: theme.muted }}>
                The notification text is never shown outside the app — these times update when the receiver confirms.
              </Text>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ---- Group / Contact info (web GroupInfo — members + presence) ---- */}
      <Modal visible={showMembers} transparent animationType="fade" onRequestClose={() => setShowMembers(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowMembers(false)}>
          <Pressable
            style={[styles.infoCard, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}
            onPress={() => undefined}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: theme.ink }}>
                {isGroup ? "Group info" : "Contact info"}
              </Text>
              <TouchableOpacity onPress={() => setShowMembers(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            <View style={{ alignItems: "center", marginTop: 14, marginBottom: 12 }}>
              <View style={[styles.infoAvatar, { backgroundColor: theme.surface3 }]}>
                {isGroup ? (
                  <Ionicons name="people" size={26} color={theme.muted} />
                ) : (
                  <Text style={{ fontSize: 20, fontWeight: "600", color: theme.muted }}>{initials(displayName)}</Text>
                )}
              </View>
              <Text style={{ fontSize: 16, fontWeight: "600", color: theme.ink, marginTop: 8 }} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{infoSubtitle}</Text>
            </View>

            <View style={{ maxHeight: 300 }}>
              {infoMembers.length === 0 ? (
                <Text style={{ fontSize: 13, color: theme.muted, paddingVertical: 8 }}>No members found.</Text>
              ) : (
                infoMembers.map((member) => {
                  const online = isOnline(member.lastSeenAt, nowTick);
                  return (
                    <View key={member.id} style={[styles.memberRow, { borderColor: theme.line }]}>
                      <View style={[styles.memberAvatar, { backgroundColor: theme.surface3 }]}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.muted }}>
                          {initials(member.name)}
                        </Text>
                        <View
                          style={[
                            styles.memberDot,
                            { backgroundColor: online ? theme.secondary : theme.muted, borderColor: theme.surface, opacity: online ? 1 : 0.4 },
                          ]}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14, color: theme.ink }}>
                          {member.name}
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                          <Text style={{ fontSize: 11, color: theme.muted, textTransform: "capitalize" }}>
                            {member.role}
                          </Text>
                          <Text style={{ fontSize: 11, color: theme.muted }}>
                            {" · "}{presenceLabel(member.lastSeenAt, new Date(nowTick))}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ---- Long-press action sheet (web hover/hold action row) ---- */}
      <Modal visible={actionFor !== null} transparent animationType="fade" onRequestClose={() => setActionFor(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setActionFor(null)}>
          <Pressable
            style={[styles.actionSheet, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}
            onPress={() => undefined}
          >
            {actionFor && (
              <>
                <Text numberOfLines={2} style={[styles.actionPreview, { color: theme.muted }]}>
                  {actionFor.author}: {actionFor.body}
                </Text>

                <ActionButton
                  icon="arrow-undo"
                  label="Reply"
                  theme={theme}
                  onPress={() => {
                    setReplyingTo(actionFor);
                    setActionFor(null);
                  }}
                />
                <ActionButton
                  icon="happy-outline"
                  label="React"
                  theme={theme}
                  onPress={() => {
                    setReactPickerFor(actionFor.id);
                    setActionFor(null);
                  }}
                />
                <ActionButton
                  icon="copy-outline"
                  label="Copy"
                  theme={theme}
                  onPress={() => {
                    const text = actionFor.body;
                    setActionFor(null);
                    void Clipboard.setStringAsync(text).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    });
                  }}
                />
                {actionFor.userId === user?.id &&
                  !actionFor.deleted &&
                  actionFor.kind === "text" &&
                  withinEditWindow(new Date(actionFor.createdAt).getTime()) && (
                    <ActionButton
                      icon="pencil-outline"
                      label="Edit"
                      theme={theme}
                      onPress={() => startEdit(actionFor)}
                    />
                  )}
                {!actionFor.deleted && (actionFor.userId === user?.id || user?.role === "owner") && (
                  <ActionButton
                    icon="trash-outline"
                    label="Delete"
                    danger
                    theme={theme}
                    onPress={() => confirmDelete(actionFor)}
                  />
                )}
                {user?.role === "owner" && isGroup && !actionFor.deleted && (
                  <ActionButton
                    icon={pins.some((p) => p.messageId === actionFor.id) ? "bookmark-outline" : "bookmark"}
                    label={pins.some((p) => p.messageId === actionFor.id) ? "Unpin" : "Pin"}
                    theme={theme}
                    onPress={() => void togglePin(actionFor)}
                  />
                )}
                <ActionButton
                  icon="information-circle-outline"
                  label="Info"
                  theme={theme}
                  onPress={() => {
                    setInfoFor(actionFor);
                    setShowInfo(true);
                    setActionFor(null);
                  }}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ---- Message list ---- */}
      <FlatList
        ref={listRef}
        data={rows as unknown[]}
        keyExtractor={(item, index) => {
          const m = item as ChatMessage | { isDay: true; key: string };
          return "isDay" in m ? m.key + index : String(m.id);
        }}
        contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
        onContentSizeChange={() => {
          // Follow the newest message — but never yank the reader while
          // they were scrolling up (atBottomRef tracks it).
          if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onScrollToIndexFailed={(info) =>
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
        }
        renderItem={({ item }) => {
          if ("isDay" in item) {
            return (
              <View style={styles.daySeparator}>
                <Text style={[styles.dayChip, { backgroundColor: theme.surface2, color: theme.muted }]}>{item.label}</Text>
              </View>
            );
          }
          const message = item as LocalMessage;
          if (message.kind === "system") {
            return (
              <View style={styles.daySeparator}>
                <Text style={[styles.dayChip, { backgroundColor: theme.surface2, color: theme.muted }]}>{message.body}</Text>
              </View>
            );
          }
          const mine = message.userId === user?.id;
          const tick = mine ? tickFor(message, otherId) : null;
          // Receipt messages render as an approval card (web: receiptById lookup).
          const receiptRow = message.receiptId ? receipts.find((r) => r.id === message.receiptId) : undefined;
          const chips = groupReactions(message.reactions, user?.id);
          const quoted = message.replyToId
            ? messages.find((m) => m.id === message.replyToId) ?? null
            : null;
          const flash = flashId === message.id;
          const showNewDivider = firstNew === message.id;

          if (message.deleted) {
            return (
              <View>
                {showNewDivider && <NewMessagesChip theme={theme} />}
                <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                  <View style={[styles.bubble, { backgroundColor: theme.surface2, maxWidth: "80%" }]}>
                    <Text style={{ color: theme.muted, fontSize: 14, fontStyle: "italic", opacity: 0.8 }}>
                      🚫 This message was deleted
                    </Text>
                  </View>
                </View>
              </View>
            );
          }

          // Receipt message = approval card (web: photo/amount/note/status badge).
          if (message.kind === "receipt") {
            const tone = receiptRow ? receiptStatusTone(receiptRow.status) : null;
            const badgeBg = tone === "ok" ? theme.successSoft : tone === "bad" ? theme.errorSoft : theme.accentSoft;
            const badgeInk = tone === "ok" ? theme.successInk : tone === "bad" ? theme.errorInk : theme.accentInk;
            const url = receiptRow ? api.chatReceiptUrl(receiptRow.r2Key) : null;
            const isImage = receiptRow ? receiptRow.mime.startsWith("image/") : false;
            return (
              <View>
                {showNewDivider && <NewMessagesChip theme={theme} />}
                <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                  {!mine && (
                    <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: theme.accentInk }}>{initials(message.author)}</Text>
                    </View>
                  )}
                  <View style={[styles.receiptCard, { backgroundColor: theme.surface, borderColor: flash ? theme.accent : theme.line }]}>
                    {receiptRow ? (
                      <>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name="receipt-outline" size={16} color={theme.accentInk} />
                          <Text style={{ fontSize: 14, fontWeight: "600", color: theme.ink, flex: 1 }} numberOfLines={1}>
                            {receiptRow.title}
                          </Text>
                          <View style={[styles.receiptBadge, { backgroundColor: badgeBg }]}>
                            <Text style={{ fontSize: 10, fontWeight: "700", color: badgeInk }}>
                              {receiptStatusLabel(receiptRow.status)}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 18, fontWeight: "700", color: theme.ink, marginTop: 6 }}>
                          {formatRupees(receiptRow.amountPaise)}
                        </Text>
                        {receiptRow.note ? (
                          <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{receiptRow.note}</Text>
                        ) : null}
                        {url && isImage ? (
                          <Image
                            source={{ uri: url }}
                            style={styles.receiptImage}
                            resizeMode="cover"
                          />
                        ) : receiptRow ? (
                          <Text style={{ fontSize: 12, color: theme.accentInk, marginTop: 4 }} numberOfLines={1}>
                            📄 {receiptRow.filename}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      // The receipt row hasn't loaded yet (or is from an old room snapshot).
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="receipt-outline" size={16} color={theme.muted} />
                        <Text style={{ fontSize: 14, color: theme.ink }}>{message.body}</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 4, marginTop: 6 }}>
                      <Text style={{ color: theme.muted, fontSize: 10, opacity: 0.7 }}>{timeLabel(message.createdAt)}</Text>
                      {mine && tick && (
                        <Text style={{ fontSize: 10, color: tick === "read" ? theme.readTick : theme.onPrimary, opacity: tick === "read" ? 1 : 0.7 }}>
                          {tick === "sent" ? "✓" : "✓✓"}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            );
          }

          return (
            <View>
              {showNewDivider && <NewMessagesChip theme={theme} />}
              <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
              {!mine && (
                <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.accentInk }}>{initials(message.author)}</Text>
                </View>
              )}
              <View style={{ maxWidth: "80%", alignItems: mine ? "flex-end" : "flex-start" }}>
                <Pressable
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: mine ? theme.primary : theme.surface,
                      borderColor: message.failed ? theme.errorInk : flash ? theme.accent : "transparent",
                      borderWidth: message.failed || flash ? 2 : 0,
                    },
                  ]}
                  onLongPress={message.kind === "text" && message.id > 0 ? () => setActionFor(message) : undefined}
                  onPress={
                    message.failed
                      ? () =>
                          Alert.alert("Couldn't send", failedSend?.error ?? "The message was not delivered.", [
                            { text: "Discard", style: "destructive", onPress: discardFailedSend },
                            { text: "Retry", onPress: retryFailedSend },
                          ])
                      : undefined
                  }
                >
                  {/* Reply quote — tap to jump to the original (web: border-l-2 accent). */}
                  {quoted && (
                    <Pressable
                      style={[styles.quote, { borderColor: theme.accent, backgroundColor: mine ? "rgba(255,255,255,0.14)" : theme.accentSoft }]}
                      onPress={() => scrollToMessage(quoted.id)}
                    >
                      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: mine ? theme.onPrimary : theme.accentInk, opacity: 0.9 }}>
                        {quoted.author || "Message"}
                      </Text>
                      <Text numberOfLines={1} style={{ fontSize: 11, color: mine ? theme.onPrimary : theme.ink, opacity: 0.7 }}>
                        {quoted.body || "…"}
                      </Text>
                    </Pressable>
                  )}
                  <Text style={{ color: mine ? theme.onPrimary : theme.ink, fontSize: 15, lineHeight: 21 }}>
                    {message.body}
                    {message.aiPolished ? " ✨" : ""}
                    {message.editedAt ? (
                      <Text style={{ fontSize: 9, fontStyle: "italic", opacity: 0.7 }}> edited</Text>
                    ) : null}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                    <Text style={{ color: mine ? theme.onPrimary : theme.muted, fontSize: 10, opacity: 0.7 }}>{timeLabel(message.createdAt)}</Text>
                    {mine && message.pending && <Ionicons name="time-outline" size={12} color={theme.onPrimary} style={{ opacity: 0.7 }} />}
                    {mine && message.failed && <Ionicons name="alert-circle" size={13} color={theme.errorInk} />}
                    {mine && !message.pending && !message.failed && tick && (
                      <Text style={{ fontSize: 10, color: tick === "read" ? theme.readTick : theme.onPrimary, opacity: tick === "read" ? 1 : 0.7 }}>{tick === "sent" ? "✓" : "✓✓"}</Text>
                    )}
                  </View>
                </Pressable>

                {/* Reaction pills — mine gets the accent (web groupReactions). */}
                {chips.length > 0 && (
                  <View style={styles.pillRow}>
                    {chips.map((chip) => (
                      <TouchableOpacity
                        key={chip.emoji}
                        activeOpacity={0.7}
                        onPress={() => void toggleReaction(message, chip.emoji)}
                        style={[
                          styles.pill,
                          {
                            borderColor: chip.mine ? theme.accent : theme.line,
                            backgroundColor: chip.mine ? theme.accentSoft : theme.surface2,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 11, color: chip.mine ? theme.accentInk : theme.ink }}>
                          {chip.emoji} {chip.count}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Inline emoji picker (web: 6 round buttons under the bubble). */}
                {reactPickerFor === message.id && (
                  <View style={[styles.pickerRow, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                    {REACTION_EMOJIS.map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        style={styles.pickerBtn}
                        onPress={() => void toggleReaction(message, emoji)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={{ fontSize: 18 }}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
              </View>
            </View>
          );
        }}
      />

      {/* ---- Jump FAB: "New messages ↓" while scrolled up (web pill) ---- */}
      {!atBottom && newIds.length > 0 && (
        <TouchableOpacity
          style={[styles.jumpFab, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}
          onPress={jumpToLatest}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: theme.accentInk }}>
            New messages ↓ ({newIds.length})
          </Text>
        </TouchableOpacity>
      )}

      {/* ---- "Copied ✓" flash after a clipboard copy ---- */}
      {copied && (
        <View style={styles.copiedChipWrap}>
          <View style={[styles.copiedChip, { backgroundColor: theme.successSoft }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.successInk }}>Copied ✓</Text>
          </View>
        </View>
      )}

      {/* ---- Typing indicator ---- */}
      {typing && (
        <View style={{ padding: 6, paddingLeft: 16 }}>
          <Text style={{ color: theme.muted, fontSize: 12 }}>{typing}</Text>
        </View>
      )}

      {/* ---- Reply draft bar (web: bg-accent-soft, "↩ Replying to X" + ✕) ---- */}
      {replyingTo && !editing && (
        <View style={[styles.replyBar, { backgroundColor: theme.accentSoft, borderColor: theme.line }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: theme.accentInk }}>
              ↩ Replying to {replyingTo.author}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.muted }}>
              {replyingTo.body}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={18} color={theme.accentInk} />
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Editing banner (web: "✏️ Editing message" + ✕) ---- */}
      {editing && (
        <View style={[styles.replyBar, { backgroundColor: theme.surface3, borderColor: theme.line }]}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontWeight: "600", color: theme.ink }}>
            ✏️ Editing message
          </Text>
          <TouchableOpacity
            onPress={() => {
              setEditing(null);
              setEditDraft("");
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={theme.muted} />
          </TouchableOpacity>
        </View>
      )}

      {/* ---- @mention chips (web: up to 6, tap inserts "@Name ") ---- */}
      {mentionCandidates.length > 0 && (
        <View style={[styles.mentionRow, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {mentionCandidates.map((member) => (
            <TouchableOpacity
              key={member.id}
              style={[styles.mentionChip, { backgroundColor: theme.surface, borderColor: theme.line }]}
              onPress={() => pickMention(member.name)}
              activeOpacity={0.7}
            >
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.ink }}>
                @{member.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ---- AI polish card (web: Polishing… / Suggested / failed) ---- */}
      {polish && (
        <View style={[styles.polishCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          {polish.stage === "waiting" ? (
            <Text style={{ fontSize: 13, color: theme.muted }}>✨ Polishing…</Text>
          ) : null}

          {polish.stage === "failed" ? (
            <>
              <Text style={{ fontSize: 13, color: theme.ink }}>AI not available — send original?</Text>
              <View style={styles.polishActions}>
                <TouchableOpacity
                  style={[styles.polishBtn, { backgroundColor: theme.primary }]}
                  onPress={() => {
                    const original = polish.original;
                    setPolish(null);
                    void sendText(original, false);
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.onPrimary }}>Send original</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.polishBtn, { backgroundColor: theme.surface3 }]} onPress={() => setPolish(null)}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.ink }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          {polish.stage === "ready" ? (
            <>
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.accentInk }}>
                ✨ {polish.keptOriginal ? "Kept original — numbers changed" : "Suggested"}
              </Text>
              <Text style={{ fontSize: 13, color: theme.ink, marginVertical: 6 }}>{polish.suggested}</Text>
              <View style={styles.polishActions}>
                <TouchableOpacity
                  style={[styles.polishBtn, { backgroundColor: theme.primary }]}
                  onPress={() => {
                    const suggested = polish.suggested;
                    setPolish(null);
                    void sendText(suggested, true);
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.onPrimary }}>Send suggested</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.polishBtn, { backgroundColor: theme.surface3 }]}
                  onPress={() => {
                    const original = polish.original;
                    setPolish(null);
                    void sendText(original, false);
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.ink }}>Send original</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.polishBtn, { backgroundColor: theme.surface3 }]}
                  onPress={() => {
                    setDraft(polish.suggested);
                    setPolish(null);
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.ink }}>Edit</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </View>
      )}

      {/* ---- Receipt form (web showReceiptForm: attach → upload → approval card) ---- */}
      {showReceiptForm && (
        <View style={[styles.receiptForm, { backgroundColor: theme.surface2, borderTopColor: theme.line }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>Send a receipt for approval</Text>
            <TouchableOpacity
              onPress={() => {
                setShowReceiptForm(false);
                setReceiptError(null);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={20} color={theme.muted} />
            </TouchableOpacity>
          </View>

          {/* File picker: gallery / camera (web: <input type="file">). */}
          {receiptFile ? (
            <View style={[styles.receiptFileRow, { borderColor: theme.line, backgroundColor: theme.surface }]}>
              <Image source={{ uri: receiptFile.uri }} style={styles.receiptFileThumb} resizeMode="cover" />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.ink }}>
                {receiptFile.name}
              </Text>
              <TouchableOpacity onPress={() => setReceiptFile(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color={theme.muted} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                style={[styles.receiptPickBtn, { backgroundColor: theme.surface, borderColor: theme.line }]}
                onPress={() => void pickReceiptFile(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="image-outline" size={16} color={theme.accentInk} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.accentInk }}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.receiptPickBtn, { backgroundColor: theme.surface, borderColor: theme.line }]}
                onPress={() => void pickReceiptFile(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="camera-outline" size={16} color={theme.accentInk} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.accentInk }}>Camera</Text>
              </TouchableOpacity>
            </View>
          )}

          <TextInput
            style={[styles.receiptInput, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.surface }]}
            placeholder="Title (e.g. Transport bill)"
            placeholderTextColor={theme.muted}
            value={receiptTitle}
            onChangeText={setReceiptTitle}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.receiptInput, { flex: 1, color: theme.ink, borderColor: theme.line, backgroundColor: theme.surface }]}
              placeholder="Amount in ₹"
              placeholderTextColor={theme.muted}
              inputMode="decimal"
              keyboardType="decimal-pad"
              value={receiptAmount}
              onChangeText={setReceiptAmount}
            />
          </View>
          <TextInput
            style={[styles.receiptInput, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.surface }]}
            placeholder="Note (optional)"
            placeholderTextColor={theme.muted}
            value={receiptNote}
            onChangeText={setReceiptNote}
          />

          {receiptError ? (
            <Text style={{ fontSize: 12, color: theme.errorInk }}>{receiptError}</Text>
          ) : null}

          <TouchableOpacity
            style={[
              styles.receiptSendBtn,
              {
                backgroundColor:
                  receiptFile && receiptTitle.trim() && Number(receiptAmount) > 0 && !receiptBusy
                    ? theme.primary
                    : theme.surface3,
              },
            ]}
            disabled={!(receiptFile && receiptTitle.trim() && Number(receiptAmount) > 0) || receiptBusy}
            onPress={() => void sendReceipt()}
            activeOpacity={0.8}
          >
            {receiptBusy ? (
              <ActivityIndicator size="small" color={theme.onPrimary} />
            ) : (
              <Text style={{ fontSize: 13, fontWeight: "700", color: theme.onPrimary }}>Send receipt</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Composer ---- */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.composer, { borderTopColor: theme.line, backgroundColor: theme.surface2 }]}>
        {!editing && (
          <TouchableOpacity
            style={[styles.attachBtn, { backgroundColor: showReceiptForm ? theme.accentSoft : "transparent" }]}
            onPress={() => {
              setShowReceiptForm((prev) => !prev);
              setReceiptError(null);
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="attach" size={20} color={showReceiptForm ? theme.accentInk : theme.muted} />
          </TouchableOpacity>
        )}
        <TextInput
          style={[styles.composerInput, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.surface }]}
          placeholder={editing ? "Edit your message…" : "Message…"}
          placeholderTextColor={theme.muted}
          value={editing ? editDraft : draft}
          onChangeText={(text) => {
            if (editing) setEditDraft(text);
            else {
              setDraft(text);
              sendTyping();
            }
          }}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: (editing ? editDraft.trim() : draft.trim()) ? theme.primary : theme.surface3 },
          ]}
          onPress={() => void send()}
          disabled={!(editing ? editDraft.trim() : draft.trim())}
        >
          <Ionicons name={editing ? "checkmark" : "send"} size={18} color={(editing ? editDraft.trim() : draft.trim()) ? theme.onPrimary : theme.muted} />
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </KeyboardAvoidingView>
  );
}

/** The centered "New messages" divider above the first missed message. */
function NewMessagesChip({ theme }: { theme: { accentSoft: string; accentInk: string } }) {
  return (
    <View style={styles.newChipWrap}>
      <View style={[styles.newChip, { backgroundColor: theme.accentSoft }]}>
        <Text style={{ fontSize: 11, fontWeight: "600", color: theme.accentInk }}>New messages</Text>
      </View>
    </View>
  );
}

/** One row of the long-press action sheet. */
function ActionButton({
  icon,
  label,
  onPress,
  theme,
  danger,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  theme: { ink: string; error: string; surface2: string };
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 4, bottom: 4 }}>
      <Ionicons name={icon} size={18} color={danger ? theme.error : theme.ink} />
      <Text style={{ fontSize: 14, color: danger ? theme.error : theme.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  chatHeader: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 6,
    marginTop: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderBottomWidth: 1,
    zIndex: 20,
  },
  headerIcon: {
    width: 40,
    height: 40,
    minWidth: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerWho: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerMenu: {
    position: "absolute",
    right: 8,
    top: 96, // status bar (36) + header (56) + a small gap
    zIndex: 40,
    width: 210,
    padding: 6,
    borderRadius: 14,
    borderWidth: 1,
    elevation: 8,
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  menuText: { fontSize: 13, textAlign: "left" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, height: 32, paddingVertical: 0 },
  jumpBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  infoAvatar: { width: 56, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: { width: 34, height: 34, borderRadius: 17, justifyContent: "center", alignItems: "center" },
  memberDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  daySeparator: { alignItems: "center", marginVertical: 10 },
  dayChip: { fontSize: 11, fontWeight: "500", paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12, overflow: "hidden" },
  bubbleRow: { flexDirection: "row", marginTop: 4, paddingHorizontal: 8 },
  avatar: { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center", marginRight: 6 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 4 },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 32,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  composerInput: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 16,
  },
  sendButton: { borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", minHeight: 40 },
  // ---- phase 2: message-level parity ----
  quote: {
    borderLeftWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
    alignSelf: "stretch",
  },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  pickerRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pickerBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  pinBar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  pinChip: {
    maxWidth: 180,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 10,
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionSheet: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    padding: 8,
    elevation: 8,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  actionPreview: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.3)",
    marginBottom: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  newChipWrap: { alignItems: "center", marginVertical: 8 },
  newChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 },
  mentionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginHorizontal: 10,
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    padding: 6,
  },
  mentionChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 160,
  },
  polishCard: {
    marginHorizontal: 10,
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  polishActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  polishBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  // ---- phase 3: receipts + copy flash ----
  copiedChipWrap: {
    position: "absolute",
    bottom: 96,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  copiedChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  receiptCard: {
    maxWidth: "80%",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  receiptBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  receiptImage: {
    width: "100%",
    height: 140,
    borderRadius: 8,
    marginTop: 8,
    backgroundColor: "rgba(128,128,128,0.15)",
  },
  receiptForm: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  receiptFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  receiptFileThumb: { width: 36, height: 36, borderRadius: 6 },
  receiptPickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  receiptInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 40,
  },
  receiptSendBtn: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  jumpFab: {
    position: "absolute",
    right: 16,
    bottom: 96,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    elevation: 6,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 15,
  },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  infoCard: { borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, elevation: 8, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});
