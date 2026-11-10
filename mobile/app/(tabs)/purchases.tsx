/**
 * Purchases screen — purchase order list.
 */
import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";

import { api, type PurchaseRow } from "../../lib/api";
import { useAuth } from "../_layout";

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function PurchasesScreen() {
  const { theme } = useAuth();
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { purchases: data } = await api.purchases();
      setPurchases(data);
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
        <Text style={[styles.heading, { color: theme.ink }]}>Purchases</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>Pending & received</Text>
      </View>

      <FlatList
        data={purchases}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={() => <View style={[styles.divider, { backgroundColor: theme.line }]} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, { backgroundColor: theme.surface }]}>
            <View style={[styles.avatar, { backgroundColor: theme.surface3 }]}>
              <Text style={[styles.avatarText, { color: theme.muted }]}>{item.itemName.trim()[0] ?? "?"}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[styles.itemName, { color: theme.ink }]}>{item.itemName}</Text>
              <Text style={[styles.meta, { color: theme.muted }]}>{item.supplierName ?? ""}</Text>
            </View>
            <View style={styles.rightCol}>
              <Text style={[styles.qty, { color: theme.ink, fontWeight: "600" }]}>{item.qtyRemaining}</Text>
              <Text style={[styles.qtyLabel, { color: theme.muted }]}>{item.unit}</Text>
              <Text style={[styles.price, { color: theme.primary, fontWeight: "700" }]}>{money(item.amountPaise)}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={{ color: theme.muted, textAlign: "center" }}>No purchases yet.</Text>
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
  qty: { fontSize: 15, fontWeight: "600", color: "black" },
  qtyLabel: { fontSize: 11, color: "black" },
  price: { fontSize: 15, fontWeight: "700", color: "black" },
  divider: { height: 1 },
  empty: { padding: 40, alignItems: "center" },
});
