/**
 * Chats — the conversation list.
 *
 * Mobile parity with the web chat list (web/src/components/TeamChat.tsx, the
 * `isMobile` branch): large "Chats" title with search / new-chat actions,
 * a search bar, web-style rows (2-letter initials or group icon, online dot,
 * green time + pill when unread) and the web empty states.
 */
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api } from "../../lib/api";
import { setUnreadFromConversations } from "../../lib/unreadStore";
import { useAuth } from "../_layout";
import { formatChatListTime, initials, isOnline } from "../../lib/chatView";

type Conversation = {
  id: number;
  room: string;
  kind: "group" | "direct";
  title: string | null;
  other: { id: number; name: string; role: string } | null;
  unread: number;
  lastMessageAt: string | null;
  lastMessage?: { id?: number; userId?: number | null; author?: string; body?: string; kind?: string; createdAt?: string } | null;
};

type Member = { id: number; name: string; role: string; lastSeenAt?: string | null };

function conversationName(c: Conversation): string {
  if (c.kind === "direct") return c.other?.name ?? c.room;
  return c.title?.trim() || (c.room === "main" ? "Shop room" : c.room);
}

function conversationPreview(c: Conversation): string {
  if (!c.lastMessage) return "No messages yet";
  const text = c.lastMessage.body?.replace(/\s+/g, " ").trim() ?? "";
  return c.lastMessage.kind === "receipt" ? (text ? `Receipt: ${text}` : "Receipt") : text;
}

/** Web `filterConversations` — matches the name only. */
function matches(c: Conversation, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return conversationName(c).toLowerCase().includes(needle);
}

function IconButton({
  name,
  label,
  onPress,
  theme,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  theme: { muted: string; surface2: string };
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={styles.iconBtn}
    >
      <Ionicons name={name} size={20} color={theme.muted} />
    </TouchableOpacity>
  );
}

export default function ChatsScreen() {
  const { theme } = useAuth();
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [newOpen, setNewOpen] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (loadingRef.current) return; // poll never stacks on a slow fetch
    loadingRef.current = true;
    try {
      const [{ conversations }, { members: people }] = await Promise.all([
        api.chatConversations(),
        api.chatMembers().catch(() => ({ members: [] as Member[] })),
      ]);
      setConversations(conversations);
      setMembers(people);
      // Feed the global Chats-tab badge at the same time (Dashboard sees it).
      setUnreadFromConversations(conversations);
      setError(null);
    } catch (err) {
      // Surface the reason on screen (session expired / offline / permissions)
      // — the silent catch left us debugging an empty list blind.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Load on mount AND on every focus — coming back from a room clears its
  // unread pill and re-sorts the list (web refetches on room close too).
  // Also poll every 15s while the list is on screen: a new message then pops
  // the unread badge + re-sorts without you leaving the screen (the web gets
  // this live via its WebSocket; here the room socket covers the room itself).
  useFocusEffect(
    useCallback(() => {
      void load();
      const poll = setInterval(() => void load(), 15_000);
      return () => clearInterval(poll);
    }, [load]),
  );

  // Refresh the online dots every 30s (web uses a 1s tick; 30s is enough here).
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => conversations.filter((c) => matches(c, query)),
    [conversations, query],
  );

  async function startChat(member: Member) {
    if (creating) return;
    setCreating(true);
    setNewError(null);
    try {
      const { conversation } = await api.startConversation(member.id);
      setNewOpen(false);
      router.push({
        pathname: "/chat/[room]",
        params: { room: conversation.room, title: member.name },
      });
    } catch (err) {
      setNewError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* ---- title + actions (web .chatlist-header) ---- */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <View
            style={[
              {
                width: 42,
                height: 42,
                borderRadius: 13,
                backgroundColor: theme.primary,
                alignItems: "center",
                justifyContent: "center",
              },
            ]}
          >
            <Ionicons name="chatbubbles" size={21} color={theme.onPrimary} />
          </View>
          <View>
            <Text
              style={[
                styles.title,
                { color: theme.ink, fontFamily: Platform.OS === "ios" ? "Georgia" : undefined, fontSize: 22 },
              ]}
            >
              Chats
            </Text>
            <Text style={{ fontSize: 11, color: theme.muted, marginTop: 1 }}>Team messages — live</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            name="search"
            label="Search chats"
            theme={theme}
            onPress={() => setSearchOpen((open) => !open)}
          />
          <IconButton
            name="create-outline"
            label="New chat"
            theme={theme}
            onPress={() => {
              setNewError(null);
              setNewOpen(true);
            }}
          />
        </View>
      </View>

      {/* ---- search bar ---- */}
      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={14} color={theme.muted} style={styles.searchIcon} />
          <TextInput
            style={[
              styles.searchInput,
              { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface },
            ]}
            placeholder="Search chats"
            placeholderTextColor={theme.muted}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
          />
        </View>
      ) : null}

      {error ? (
        <TouchableOpacity
          style={[styles.empty, { backgroundColor: theme.errorSoft, borderRadius: 10, marginHorizontal: 12 }]}
          onPress={() => void load()}
        >
          <Text style={{ color: theme.errorInk, fontSize: 13, textAlign: "center" }}>
            Couldn&apos;t load chats: {error} — tap to retry
          </Text>
        </TouchableOpacity>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void load()} />
        }
        renderItem={({ item: conversation }) => {
          const name = conversationName(conversation);
          const direct = conversation.kind === "direct";
          const online =
            direct &&
            isOnline(
              members.find((m) => m.id === conversation.other?.id)?.lastSeenAt,
              nowTick,
            );
          const unread = conversation.unread > 0;
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() =>
                router.push({
                  pathname: "/chat/[room]",
                  params: { room: conversation.room, title: name },
                })
              }
            >
              <View style={[styles.avatar, { backgroundColor: theme.surface3 }]}>
                {direct ? (
                  <Text style={[styles.avatarText, { color: theme.muted }]}>
                    {initials(name)}
                  </Text>
                ) : (
                  <Ionicons name="people" size={16} color={theme.muted} />
                )}
                {direct && (
                  <View
                    style={[
                      styles.onlineDot,
                      {
                        backgroundColor: online ? theme.secondary : theme.muted,
                        opacity: online ? 1 : 0.4,
                        borderColor: theme.bg,
                      },
                    ]}
                  />
                )}
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowTop}>
                  <Text
                    numberOfLines={1}
                    style={[styles.name, { color: theme.ink, fontWeight: unread ? "600" : "400" }]}
                  >
                    {name}
                  </Text>
                  <Text
                    style={[
                      styles.time,
                      { color: unread ? theme.badgeContact : theme.muted },
                    ]}
                  >
                    {formatChatListTime(conversation.lastMessageAt)}
                  </Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.preview,
                      { color: unread ? theme.ink : theme.muted, fontWeight: unread ? "600" : "400" },
                    ]}
                  >
                    {conversationPreview(conversation)}
                  </Text>
                  {unread && (
                    <View style={[styles.badge, { backgroundColor: theme.badgeContact }]}>
                      <Text style={[styles.badgeText, { color: theme.badgeText }]}>
                        {conversation.unread > 99 ? "99+" : conversation.unread}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={() => (
          <Text style={[styles.empty, { color: theme.muted }]}>
            {query.trim()
              ? "No chat matches that search."
              : "No chats yet — start one with New chat."}
          </Text>
        )}
      />

      {/* ---- New chat sheet ---- */}
      <Modal visible={newOpen} transparent animationType="fade" onRequestClose={() => setNewOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setNewOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}
            onPress={() => undefined}
          >
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: theme.ink }]}>New chat</Text>
              <TouchableOpacity onPress={() => setNewOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>
            {newError ? <Text style={{ color: theme.errorInk, fontSize: 13, marginBottom: 8 }}>{newError}</Text> : null}
            <View style={{ maxHeight: 360 }}>
              {members.length === 0 ? (
                <Text style={{ color: theme.muted, fontSize: 13, paddingVertical: 12 }}>
                  No other members yet.
                </Text>
              ) : (
                members.map((member) => (
                  <TouchableOpacity
                    key={member.id}
                    style={[styles.memberRow, { borderColor: theme.line }]}
                    onPress={() => void startChat(member)}
                    disabled={creating}
                  >
                    <View style={[styles.memberAvatar, { backgroundColor: theme.surface3 }]}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.muted }}>
                        {initials(member.name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14, color: theme.ink }}>
                        {member.name}
                      </Text>
                      <Text style={{ fontSize: 11, color: theme.muted, textTransform: "capitalize" }}>
                        {member.role}
                      </Text>
                    </View>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.muted} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  title: { fontSize: 24, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" },
  searchIcon: { position: "absolute", left: 28, zIndex: 1 },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    height: 36,
    paddingHorizontal: 30,
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 8, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 2,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "600" },
  onlineDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  rowTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 },
  name: { fontSize: 14, flexShrink: 1 },
  time: { fontSize: 10, flexShrink: 0 },
  preview: { fontSize: 12, flex: 1 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 5,
  },
  badgeText: { fontSize: 10, fontWeight: "600" },
  empty: { fontSize: 12, textAlign: "center", paddingVertical: 16, paddingHorizontal: 12 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 14,
    padding: 14,
    elevation: 8,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 15, fontWeight: "600" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },
});
