/** New Bill — placeholder (full billing comes in Phase 4). */
import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "../_layout";

export default function NewBillScreen() {
  const { theme } = useAuth();
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.title, { color: theme.ink }]}>New Bill</Text>
      <Text style={{ color: theme.muted, marginTop: 8 }}>Coming in Phase 4 — billing, invoices and customers.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, marginTop: 32 },
  title: { fontSize: 24, fontWeight: "700" },
});
