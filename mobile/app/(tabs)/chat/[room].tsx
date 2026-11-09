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
} from "react-native";

import { api, type ChatMessage } from "../../../lib/api";
import { useAuth } from "../../_layout";
import { playNotificationSound } from "../../../lib/notificationSound";
import { membersOf } from "../../../lib/chatPrivacy";

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

export default function ChatRoomScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();
  const { room, title } = useLocalSearchParams<{ room: string; title?: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [infoData, setInfoData] = useState<{ readAt: string | null; deliveredAt: string | null } | null>(null);
  const [connected, setConnected] = useState(false);
  const listRef = useRef<FlatList>(null);
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
      const { messages: history } = await api.chatMessages(room);
      setMessages(history);
    } catch {
      // Offline — keep whatever the socket already gave us.
    } finally {
      setLoading(false);
    }
  }, [room]);

  // Mark the room as read when this screen opens.
  useEffect(() => {
    void api.markChatRead(room).catch(() => undefined);
  }, [room]);

  // Load message info when the info panel opens (1:1: Read / Delivered times).
  useEffect(() => {
    if (!showInfo || !messages.length) return;
    const lastMine = [...messages].reverse().find((m) => m.userId === user?.id);
    if (!lastMine) return;
    void api
      .chatMessageInfo(lastMine.id)
      .then((info) => {
        const receipt = info.receipts.find((r) => r.userId === otherId) ?? null;
        setInfoData({ deliveredAt: receipt?.deliveredAt ?? null, readAt: receipt?.readAt ?? null });
      })
      .catch(() => undefined);
  }, [showInfo, messages.length, otherId, user?.id]);

  // WebSocket: the same Durable Object protocol as the web app.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;

    async function connect() {
      try {
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
  }, [room, user?.id]);

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    socketRef.current?.send(JSON.stringify({ type: "typing", userId: user?.id ?? 0, name: user?.name ?? "" }));
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      const { message } = await api.sendChatMessage({ kind: "text", body: text, room });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message as ChatMessage]));
    } catch (err) {
      // Show the error as a system message so the user knows.
      const errorMessage = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { id: -Date.now(), room: "", userId: null, author: "", kind: "system", body: `Error: ${errorMessage}`, receiptId: null, createdAt: new Date().toISOString(), role: "" }]);
    }
  }

  // Group messages by day for the date separators.
  const daySections = useMemo(() => {
    const sections: { key: string; label: string; items: ChatMessage[] }[] = [];
    for (const message of messages) {
      const key = new Date(message.createdAt).toISOString().slice(0, 10);
      const last = sections[sections.length - 1];
      if (last && last.key === key) {
        last.items.push(message);
      } else {
        sections.push({ key, label: dayLabel(message.createdAt), items: [message] });
      }
    }
    return sections;
  }, [messages]);

  // Flatten into rows (date chips + bubbles).
  const rows = useMemo(() => {
    const result: (ChatMessage | { isDay: true; key: string; label: string })[] = [];
    for (const section of daySections) {
      result.push({ isDay: true, key: section.key, label: section.label });
      for (const item of section.items) result.push(item as ChatMessage);
    }
    return result;
  }, [daySections]);

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* ---- Chat header ---- */}
      <View style={[styles.chatHeader, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={{ fontSize: 22, color: theme.primary }}>←</Text>
        </TouchableOpacity>

        <TouchableOpacity style={{ gap: 2, flex: 1, flexDirection: "row", alignItems: "center" }} onPress={() => setShowInfo(true)}>
          <View style={[styles.headerAvatar, { backgroundColor: theme.surface3 }]}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.muted }}>{initials(title ?? room)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" }}>
              {title ?? room}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.muted }}>
              {typing ? typing : connected ? "online" : "connecting…"}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowInfo(true)} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <Text style={{ color: theme.accent }}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* ---- Message info modal (1:1: Read / Delivered times) ---- */}
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

      {/* ---- Message list ---- */}
      <FlatList
        ref={listRef}
        data={rows as unknown[]}
        keyExtractor={(item, index) => {
          const m = item as ChatMessage | { isDay: true; key: string };
          return "isDay" in m ? m.key + index : String(m.id);
        }}
        contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          if ("isDay" in item) {
            return (
              <View style={styles.daySeparator}>
                <Text style={[styles.dayChip, { backgroundColor: theme.surface2, color: theme.muted }]}>{item.label}</Text>
              </View>
            );
          }
          const message = item as ChatMessage;
          if (message.kind === "system") {
            return (
              <View style={styles.daySeparator}>
                <Text style={[styles.dayChip, { backgroundColor: theme.surface2, color: theme.muted }]}>{message.body}</Text>
              </View>
            );
          }
          const mine = message.userId === user?.id;
          const tick = mine ? tickFor(message, otherId) : null;
          return (
            <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
              {!mine && (
                <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.accentInk }}>{initials(message.author)}</Text>
                </View>
              )}
              <View style={[styles.bubble, { backgroundColor: mine ? theme.primary : theme.surface, maxWidth: "80%" }]}>
                <Text style={{ color: mine ? theme.onPrimary : theme.ink, fontSize: 15, lineHeight: 21 }}>{message.body}</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                  <Text style={{ color: mine ? theme.onPrimary : theme.muted, fontSize: 10, opacity: 0.7 }}>{timeLabel(message.createdAt)}</Text>
                  {mine && tick && (
                    <Text style={{ fontSize: 10, color: tick === "read" ? theme.readTick : theme.onPrimary, opacity: tick === "read" ? 1 : 0.7 }}>{tick === "sent" ? "✓" : "✓✓"}</Text>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />

      {/* ---- Typing indicator ---- */}
      {typing && (
        <View style={{ padding: 6, paddingLeft: 16 }}>
          <Text style={{ color: theme.muted, fontSize: 12 }}>{typing}</Text>
        </View>
      )}

      {/* ---- Composer ---- */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.composer, { borderTopColor: theme.line, backgroundColor: theme.surface2 }]}>
        <TextInput
          style={[styles.composerInput, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.surface }]}
          placeholder="Message…"
          placeholderTextColor={theme.muted}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            sendTyping();
          }}
          multiline
        />
        <TouchableOpacity style={[styles.sendButton, { backgroundColor: draft.trim() ? theme.primary : theme.surface3 }]} onPress={() => void send()} disabled={!draft.trim()}>
          <Text style={{ color: draft.trim() ? theme.onPrimary : theme.muted, fontWeight: "700" }}>➤</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  chatHeader: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 12,
    marginTop: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
  },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  infoCard: { borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, elevation: 8, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});
