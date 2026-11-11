/**
 * Activity screen — web parity.
 *
 * The audit feed grouped by day with a per-actor filter, event dots and
 * Load more paging (25 rows at a time, /api/activity?limit=&offset=).
 */
import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type ActivityRow } from "../lib/api";
import { useAuth } from "./_layout";

const PAGE = 25;

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date.getDate()).padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hours = date.getHours() % 12 || 12;
  return `${String(hours).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

/** Web dot() — the colour per event family, mapped to the theme palette. */
function dotColour(event: string): string {
  if (event.startsWith("sale")) return "#4c8ac2";
  if (event.startsWith("purchase")) return "#8a7bb8";
  if (event.startsWith("expense")) return "#d0874f";
  if (event.startsWith("user")) return "#5a9e6f";
  if (event.startsWith("investment")) return "#c2705f";
  if (event.startsWith("item")) return "#b8a04a";
  return "#888888";
}

export default function ActivityScreen() {
  const { theme } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (mode: "replace" | "more") => {
      setBusy(true);
      try {
        const { activity: page } = await api.activity(PAGE, mode === "more" ? rows.length : 0);
        setHasMore(page.length >= PAGE);
        setRows((prev) => (mode === "more" ? [...prev, ...page] : page));
      } catch {
        // Offline — keep whatever we have.
      } finally {
        setLoading(false);
        setBusy(false);
      }
    },
    [rows.length],
  );

  useFocusEffect(
    useCallback(() => {
      void load("replace");
    }, [load]),
  );

  const actors = [...new Set(rows.map((row) => row.actor))].sort();
  const shown = filter ? rows.filter((row) => row.actor === filter) : rows;

  /** Day → rows, in order (web `days`). */
  const days: [string, ActivityRow[]][] = [];
  for (const row of shown) {
    const day = formatDay(row.at);
    const last = days[days.length - 1];
    if (last && last[0] === day) last[1].push(row);
    else days.push([day, [row]]);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load("replace").then(() => setRefreshing(false));
          }}
          tintColor={theme.muted}
        />
      }
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={theme.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: theme.ink }}>Activity</Text>
          <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>{shown.length} events · who did what, when</Text>
        </View>
      </View>

      {/* Actor filter (web <select>) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
        <TouchableOpacity
          style={[
            styles.chip,
            filter === "" ? { backgroundColor: theme.primary, borderColor: theme.primary } : { backgroundColor: theme.surface2, borderColor: theme.line },
          ]}
          onPress={() => setFilter("")}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: filter === "" ? theme.onPrimary : theme.ink }}>All members</Text>
        </TouchableOpacity>
        {actors.map((actor) => (
          <TouchableOpacity
            key={actor}
            style={[
              styles.chip,
              filter === actor
                ? { backgroundColor: theme.primary, borderColor: theme.primary }
                : { backgroundColor: theme.surface2, borderColor: theme.line },
            ]}
            onPress={() => setFilter(actor)}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: filter === actor ? theme.onPrimary : theme.ink }}>{actor}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {days.map(([day, dayRows]) => (
        <View key={day}>
          <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 1, color: theme.muted, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
            {day.toUpperCase()}
          </Text>
          <View style={[styles.dayCard, { backgroundColor: theme.surface }]}>
            {dayRows.map((row) => (
              <View key={row.id} style={[styles.event, { borderBottomColor: theme.line }]}>
                <View style={[styles.dot, { backgroundColor: dotColour(row.event) }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, color: theme.ink }}>{row.summary}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Text style={{ fontSize: 11, color: theme.muted }}>{formatTime(row.at)}</Text>
                    <View style={[styles.actorPill, { backgroundColor: theme.surface2 }]}>
                      <Text style={{ fontSize: 10, color: theme.muted }}>{row.actor}</Text>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}

      {shown.length === 0 && <Text style={{ paddingHorizontal: 16, fontSize: 13, color: theme.muted }}>No activity yet.</Text>}

      {hasMore && (
        <TouchableOpacity style={[styles.moreBtn, { borderColor: theme.line }]} disabled={busy} onPress={() => void load("more")}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.ink }}>{busy ? "Loading…" : "Load more"}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", padding: 16 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  dayCard: { marginHorizontal: 12, borderRadius: 14, overflow: "hidden" },
  event: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  actorPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  moreBtn: {
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
});
