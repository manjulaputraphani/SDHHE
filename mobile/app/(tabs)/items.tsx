/**
 * Items screen — inventory list with stock levels.
 *
 * WhatsApp-style list: item name, stock left, unit, WAC cost.
 * Pull-to-refresh for live data.
 */
import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";

import { api, type ItemRow } from "../../lib/api";
import { useAuth } from "../_layout";

export default function ItemsScreen() {
  const { theme } = useAuth();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { items: data } = await api.items();
      setItems(data);
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
        <Text style={[styles.heading, { color: theme.ink }]}>Items</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>Stock left & unit cost</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={() => <View style={[styles.divider, { backgroundColor: theme.line }]} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, { backgroundColor: theme.surface }]}>
            <View style={[styles.avatar, { backgroundColor: theme.surface3 }]}>
              <Text style={[styles.avatarText, { color: theme.muted }]}>{item.name.trim()[0] ?? "?"}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[styles.itemName, { color: theme.ink }]}>{item.name}</Text>
              <Text style={[styles.meta, { color: theme.muted }]}>{item.unit}</Text>
            </View>
            <View style={styles.rightCol}>
              <Text style={[styles.qty, { color: theme.ink, fontWeight: "600" }]}>{item.stockRemaining}</Text>
              <Text style={[styles.qtyLabel, { color: theme.muted }]}>{item.unit}</Text>
              <Text style={[styles.price, { color: theme.primary, fontWeight: "700" }]}>{formatMoney(item.wacCostPerUnitPaise)}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={{ color: theme.muted, textAlign: "center" }}>No items yet.</Text>
          </View>
        )}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
      />
    </View>
  );
}

function formatMoney(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
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
  metaRow: { flexDirection: "row", gap: 8 },
  itemName: { fontSize: 15, fontWeight: "600", flex: 1, color: "black" },
  rightCol: { alignItems: "flex-end", flex: 1 },
  qty: { fontSize: 15, fontWeight: "600", color: "black" },
  qtyLabel: { fontSize: 11, color: "black" },
  price: { fontSize: 15, fontWeight: "700", color: "black" },
  divider: { height: 1 },
  empty: { padding: 40, alignItems: "center" },
});
