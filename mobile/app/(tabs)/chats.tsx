/**
 * Chats — the conversation list screen.
 *
 * Shows every conversation the signed-in member is in, with unread badges.
 * Tapping opens the chat detail screen.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";

import { api } from "../../lib/api";
import { useAuth } from "../_layout";

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

function conversationName(c: Conversation): string {
  if (c.kind === "direct") return c.other?.name ?? c.room;
  return c.title?.trim() || (c.room === "main" ? "Shop room" : c.room);
}

function conversationPreview(c: Conversation): string {
  if (!c.lastMessage) return "No messages yet";
  const text = c.lastMessage.body?.replace(/\s+/g, " ").trim() ?? "";
  return c.lastMessage.kind === "receipt" ? (text ? `Receipt: ${text}` : "Receipt") : text;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const d = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);
  const hh = String(date.getHours() % 12 || 12).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ampm = date.getHours() < 12 ? "AM" : "PM";
  if (d <= 0) return `${hh}:${mm} ${ampm}`;
  if (d === 1) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function ChatsScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { conversations } = await api.chatConversations();
      setConversations(conversations);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.heading, { color: theme.ink }]}>Chats</Text>
      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.line }} />}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
        renderItem={({ item: conversation }) => (
          <TouchableOpacity style={[styles.row, { backgroundColor: conversation.unread ? theme.accentSoft : theme.surface }]} onPress={() => router.push(`/(tabs)/chat/${encodeURIComponent(conversation.room)}`)}>
            <View style={[styles.avatar, { backgroundColor: theme.surface3 }]}>
              <Text style={[styles.avatarText, { color: theme.muted }]}>{(conversationName(conversation).trim()[0] ?? "?").toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text numberOfLines={1} style={[styles.name, { color: theme.ink, fontWeight: conversation.unread > 0 ? "700" : "500" }]}>
                  {conversationName(conversation)}
                </Text>
                <Text style={{ fontSize: 10, color: theme.muted }}>{formatTime(conversation.lastMessageAt)}</Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text numberOfLines={1} style={{ fontSize: 13, color: conversation.unread ? theme.ink : theme.muted, flex: 1 }}>
                  {conversationPreview(conversation)}
                </Text>
                {conversation.unread > 0 && (
                  <View style={[styles.badge, { backgroundColor: theme.badgeContact }]}>
                    <Text style={[styles.badgeText, { color: theme.badgeText }]}>{conversation.unread > 99 ? "99+" : conversation.unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={{ color: theme.muted, textAlign: "center" }}>No chats yet.</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  heading: { fontSize: 24, fontWeight: "700", padding: 16, marginTop: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, paddingHorizontal: 16 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "600" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, justifyContent: "center", alignItems: "center", paddingHorizontal: 5 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  name: { fontSize: 15, fontWeight: "500" },
  empty: { padding: 40, alignItems: "center" },
});
