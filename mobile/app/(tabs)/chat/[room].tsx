/**
 * Chat room — the 1:1 / group chat screen.
 *
 * Shows messages, sends new ones, and connects the WebSocket chat protocol
 * from the existing Durable Object backend.
 */
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Pressable } from "react-native";

import { api } from "../../../lib/api";
import { useAuth } from "../../_layout";

type ChatMessage = {
  id: number;
  room: string;
  userId: number | null;
  author: string;
  kind: "text" | "receipt" | "system";
  body: string;
  createdAt: string;
  deliveredBy?: number[];
  readBy?: number[];
};

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours() % 12 || 12).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getHours() < 12 ? "AM" : "PM"} ${hh}:${mm}`;
}

export default function ChatRoomScreen() {
  const { theme, user } = useAuth();
  const { room } = useLocalSearchParams<{ room: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const { messages: history } = await api.chatMessages(room);
      setMessages(history);
    } catch {
      // Offline — keep the socket messages we already have.
    } finally {
      setLoading(false);
    }
  }, [room]);

  // Load history on mount.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Connect the WebSocket chat protocol (same Durable Object backend).
  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;

    async function connect() {
      try {
        const { token } = await api.chatToken();
        if (closed) return;
        const scheme = Platform.OS === "android" ? "wss" : "wss";
        socket = new WebSocket(`wss://sdhhe-api.blvphani.workers.dev/api/chat/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`);
        socket.onmessage = (event) => {
          try {
            const frame = JSON.parse(String(event.data));
            if (frame.type === "message" && frame.message) {
              const msg = frame.message as ChatMessage;
              setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
              // The message reached this device — confirm delivery.
              if (msg.userId !== user?.id) {
                void api.markChatDelivered(msg.id).catch(() => undefined);
              }
            }
            if (frame.type === "delivered" || frame.type === "read") {
              const ids = (frame.messageIds ?? []) as number[];
              const key = frame.type === "read" ? "readBy" : "deliveredBy";
              setMessages((prev) =>
                prev.map((m) => {
                  if (!ids.includes(m.id)) return m;
                  const list = (m[key] ?? []) as number[];
                  if (list.includes(frame.userId)) return m;
                  return { ...m, [key]: [...list, frame.userId] } as ChatMessage;
                }),
              );
            }
          } catch {
            // Malformed frame — ignore.
          }
        };
        socket.onclose = () => {
          if (!closed) setTimeout(() => void connect(), 5000);
        };
      } catch {
        // Server not reachable — will retry.
      }
    }

    void connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }, [room, user?.id]);

  // Mark the room as read when this screen is open.
  useEffect(() => {
    void api.markChatRead(room).catch(() => undefined);
  }, [room]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      const { message } = await api.sendChatMessage({ kind: "text", body: text, room });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message as ChatMessage]));
    } catch {
      // Server not reachable — will retry on next send.
    }
  }

  const otherMemberId = 1; // In a 1:1 chat the other person is the receiver.

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: 80 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item: message }: { item: ChatMessage }) => {
          const mine = message.userId === user?.id;
          const showTick = mine && (message.deliveredBy?.length ?? 0) > 0;
          const isRead = message.readBy?.length ?? 0 > 0;
          return (
            <View style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
              <View style={[styles.bubble, { backgroundColor: mine ? theme.primary : theme.surface }]}>
                <Text style={{ color: mine ? theme.onPrimary : theme.ink, fontSize: 15 }}>{message.body}</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                  <Text style={{ color: mine ? theme.onPrimary : theme.muted, fontSize: 10, opacity: 0.7 }}>{timeLabel(message.createdAt)}</Text>
                  {mine && (showTick || isRead) && <Text style={{ fontSize: 10, color: isRead ? theme.readTick : theme.onPrimary, opacity: isRead ? 1 : 0.7 }}>✓✓</Text>}
                </View>
              </View>
            </View>
          );
        }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.composer, { borderTopColor: theme.line, backgroundColor: theme.surface2 }]}>
        <TextInput
          style={[styles.composerInput, { color: theme.ink, backgroundColor: theme.surface }]}
          placeholder="Message…"
          placeholderTextColor={theme.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <TouchableOpacity style={[styles.sendButton, { backgroundColor: theme.primary }]} onPress={() => void send()} disabled={!draft.trim()}>
          <Text style={{ color: theme.onPrimary, fontWeight: "700" }}>Send</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  bubbleRow: { flexDirection: "row", marginTop: 6, paddingHorizontal: 8 },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 4,
  },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
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
  sendButton: { borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
});
