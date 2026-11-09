/** Stock — placeholder (inventory comes in Phase 3). */
import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "../_layout";

export default function StockScreen() {
  const { theme } = useAuth();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.title, { color: theme.ink }]}>Stock</Text>
      <Text style={{ color: theme.muted, marginTop: 8 }}>Coming in Phase 3 — inventory, items and stock check.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, marginTop: 32 },
  title: { fontSize: 24, fontWeight: "700" },
});
