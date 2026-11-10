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
} from "react-native";

import { api, type ChatMessage } from "../../../lib/api";
import { useAuth } from "../../_layout";
import { playNotificationSound } from "../../../lib/notificationSound";
import { membersOf } from "../../../lib/chatPrivacy";
import { isOnline, presenceLabel } from "../../../lib/chatView";

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
  }, [room, user?.id, loadHistory]);

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

  // Flatten into rows (date chips + bubbles).
  const rows = useMemo(() => {
    const result: (ChatMessage | { isDay: true; key: string; label: string })[] = [];
    for (const section of daySections) {
      result.push({ isDay: true, key: section.key, label: section.label });
      for (const item of section.items) result.push(item as ChatMessage);
    }
    return result;
  }, [daySections]);

  // Row indexes of the current search matches (for the ↑ / ↓ jump, web jumpMark).
  const matchIndices = useMemo(() => {
    const needle = roomQuery.trim().toLowerCase();
    if (!needle) return [];
    const indices: number[] = [];
    rows.forEach((row, index) => {
      if ("isDay" in row) return;
      const m = row as ChatMessage;
      if (m.body.toLowerCase().includes(needle) || m.author.toLowerCase().includes(needle)) {
        indices.push(index);
      }
    });
    return indices;
  }, [rows, roomQuery]);

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
              <Pressable
                style={[styles.bubble, { backgroundColor: mine ? theme.primary : theme.surface, maxWidth: "80%" }]}
                onLongPress={mine ? () => setShowInfo(true) : undefined}
              >
                <Text style={{ color: mine ? theme.onPrimary : theme.ink, fontSize: 15, lineHeight: 21 }}>{message.body}</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                  <Text style={{ color: mine ? theme.onPrimary : theme.muted, fontSize: 10, opacity: 0.7 }}>{timeLabel(message.createdAt)}</Text>
                  {mine && tick && (
                    <Text style={{ fontSize: 10, color: tick === "read" ? theme.readTick : theme.onPrimary, opacity: tick === "read" ? 1 : 0.7 }}>{tick === "sent" ? "✓" : "✓✓"}</Text>
                  )}
                </View>
              </Pressable>
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
          <Ionicons name="send" size={18} color={draft.trim() ? theme.onPrimary : theme.muted} />
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </KeyboardAvoidingView>
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  infoCard: { borderRadius: 16, padding: 20, width: "100%", maxWidth: 340, elevation: 8, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
});
