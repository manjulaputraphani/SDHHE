/**
 * Dashboard — the home screen.
 *
 * Shows the shop name, today's stats and recent items. The full parity with
 * the web dashboard comes in Phase 3.
 */
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useCallback, useState } from "react";

import { api } from "../../lib/api";
import { useAuth } from "../_layout";

type Stats = {
  todaySalesPaise?: number;
  monthSalesPaise?: number;
  monthProfitPaise?: number;
  monthExpensesPaise?: number;
  unpaidBills?: number;
};

function money(paise: number | undefined): string {
  if (paise == null) return "₹0.00";
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function HomeScreen() {
  const { theme, user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.stats() as Stats;
      setStats(s);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading) void load();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />
      }
    >
      <View style={styles.header}>
        <Text style={[styles.shop, { color: theme.ink }]}>SDHHE</Text>
        <Text style={[styles.name, { color: theme.muted }]}>{user?.name}</Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
        <Text style={[styles.heading, { color: theme.ink }]}>Today</Text>
        <View style={styles.statRow}>
          <Stat label="Sales" value={money(stats?.todaySalesPaise)} theme={theme} />
        </View>
        <View style={styles.statRow}>
          <Stat label="This month" value={money(stats?.monthSalesPaise)} theme={theme} />
          <Stat label="Month expenses" value={money(stats?.monthExpensesPaise)} theme={theme} />
        </View>
        <View style={styles.statRow}>
          <Stat label="Month profit" value={money(stats?.monthProfitPaise)} theme={theme} />
          <Stat label="Credit given" value={money(stats?.unpaidBills ?? 0)} theme={theme} />
        </View>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useAuth>["theme"] }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 11, color: theme.muted }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: "700", color: theme.primary }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingTop: 48 },
  header: { marginBottom: 16 },
  shop: { fontSize: 20, fontWeight: "700", letterSpacing: 1.6 },
  name: { fontSize: 12, marginTop: 2 },
  card: {
    borderRadius: 14,
    padding: 16,
    elevation: 2,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  heading: { fontSize: 15, fontWeight: "600", marginBottom: 12 },
  statRow: { flexDirection: "row", gap: 16, marginBottom: 12 },
});
