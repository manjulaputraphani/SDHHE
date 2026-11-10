/**
 * Expenses screen — expense list.
 */
import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";

import { api, type ExpenseRow } from "../../lib/api";
import { useAuth } from "../_layout";

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function ExpensesScreen() {
  const { theme } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { expenses: data } = await api.expenses();
      setExpenses(data);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <Text style={[styles.heading, { color: theme.ink }]}>Expenses</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>All categories</Text>
      </View>

      <FlatList
        data={expenses}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={() => <View style={[styles.divider, { backgroundColor: theme.line }]} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, { backgroundColor: theme.surface }]}>
            <View style={[styles.avatar, { backgroundColor: theme.surface3 }]}>
              <Text style={[styles.avatarText, { color: theme.muted }]}>{item.title.trim()[0] ?? "?"}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[styles.itemName, { color: theme.ink }]}>{item.title}</Text>
              <Text style={[styles.meta, { color: theme.muted }]}>{item.category ?? ""}</Text>
            </View>
            <View style={styles.rightCol}>
              <Text style={[styles.price, { color: theme.primary, fontWeight: "700" }]}>{money(item.amountPaise)}</Text>
              <Text style={[styles.status, { color: theme.muted, fontSize: 10 }]}>{item.status}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={{ color: theme.muted, textAlign: "center" }}>No expenses yet.</Text>
          </View>
        )}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "black" },
  subtitle: { fontSize: 12, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, paddingHorizontal: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  avatarText: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, color: "black" },
  itemName: { fontSize: 15, fontWeight: "600", flex: 1, color: "black" },
  rightCol: { alignItems: "flex-end", flex: 1 },
  price: { fontSize: 15, fontWeight: "700", color: "black" },
  status: { fontSize: 10, color: "black" },
  divider: { height: 1 },
  empty: { padding: 40, alignItems: "center" },
});
