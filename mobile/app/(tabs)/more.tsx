/** More — settings, theme, sign out (bottom sheet style from the web app). */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";

import { useAuth } from "../_layout";

export default function MoreScreen() {
  const { theme, setThemeMode, signOut, user } = useAuth();
  const router = useRouter();
  const [dark, setDark] = useState(false);

  function toggleTheme(value: boolean) {
    setDark(value);
    setThemeMode(value ? "dark" : "light");
  }

  async function handleSignOut() {
    await signOut();
  }

  const row = (label: string, onPress?: () => void, trailing?: React.ReactNode) => (
    <TouchableOpacity disabled={!onPress} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]} onPress={onPress}>
      <Text style={{ fontSize: 15, color: theme.ink, flex: 1 }}>{label}</Text>
      {trailing}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.heading, { color: theme.ink }]}>More</Text>
      <View style={[styles.card, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
        {row("Dark theme", () => setDark(!dark), <Switch value={dark} onValueChange={toggleTheme} trackColor={{ true: theme.primary }} thumbColor={theme.primary} />)}
        {row("Items", () => router.push("/(tabs)/items"))}
        {row("Purchases", () => router.push("/(tabs)/purchases"))}
        {row("Expenses", () => router.push("/(tabs)/expenses"))}
        {(user?.role === "owner" || user?.role === "ca") && row("Reports", () => router.push("/(tabs)/reports"))}
        {row("Supplier dues", () => router.push("/(tabs)/suppliers"))}
        {user?.role === "owner" && row("Activity", () => router.push("/(tabs)/activity"))}
        {user?.role === "owner" && row("Team", () => router.push("/(tabs)/team"))}
      </View>
      <TouchableOpacity style={[styles.signOutButton, { backgroundColor: theme.error }]} onPress={() => void handleSignOut()}>
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Sign out</Text>
      </TouchableOpacity>
      <View style={{ padding: 20 }}>
        <Text style={{ color: theme.muted, fontSize: 12, textAlign: "center" }}>
          {user?.name} · {user?.role?.toUpperCase()}
        </Text>
        <Text style={{ color: theme.muted, fontSize: 10, textAlign: "center", marginTop: 4 }}>
          SREE DURGA HARIHARA ENTERPRISES
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 32 },
  heading: { fontSize: 24, fontWeight: "700", padding: 16 },
  card: { borderRadius: 14, margin: 12, overflow: "hidden", elevation: 2, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  row: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1 },
  signOutButton: { margin: 12, padding: 14, borderRadius: 12, alignItems: "center" },
});
