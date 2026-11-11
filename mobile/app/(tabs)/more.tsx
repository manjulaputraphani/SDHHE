/**
 * More — settings, modules and sign out (bottom-sheet style from the web app).
 *
 * The module cards are PERMISSION-AWARE (Phase 18): a card shows only if the
 * signed-in role can VIEW that module (user.permissions from login), so staff
 * and CA never see — or tap — cards that would bounce them elsewhere. Design:
 * 2-column tiles with the module icon, the way the web sidebar reads.
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "../_layout";
import type { ThemeColors } from "../../lib/theme";
import type { ThemeMode } from "../../lib/theme";

type Tile = {
  label: string;
  module: string;
  icon: string;
  tint: keyof ThemeColors;
  onPress: () => void;
};

export default function MoreScreen() {
  const { theme, themeMode, setThemeMode, signOut, user } = useAuth();
  const router = useRouter();

  const MODES: Array<{ value: ThemeMode; label: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "contrast", label: "Contrast" },
  ];

  async function handleSignOut() {
    await signOut();
  }

  /** Can this member see the module card? permissions first, owner fallback. */
  function canSee(module: string): boolean {
    const perms = user?.permissions as Record<string, { canView?: boolean }> | undefined;
    const set = perms?.[module];
    if (set) return Boolean(set.canView);
    return user?.role === "owner";
  }

  const allTiles: Tile[] = [
    { label: "Stock Check", module: "stock", icon: "archive", tint: "accentSoft", onPress: () => router.push("/(tabs)/stock") },
    { label: "Items", module: "items", icon: "cube", tint: "surface3", onPress: () => router.push("/(tabs)/items") },
    { label: "Purchases", module: "purchases", icon: "pricetags", tint: "surface3", onPress: () => router.push("/(tabs)/purchases") },
    { label: "Expenses", module: "expenses", icon: "cash", tint: "surface3", onPress: () => router.push("/(tabs)/expenses") },
    { label: "Supplier dues", module: "suppliers", icon: "wallet", tint: "surface3", onPress: () => router.push("/(tabs)/suppliers") },
    { label: "Reports", module: "reports", icon: "bar-chart", tint: "accentSoft", onPress: () => router.push("/(tabs)/reports") },
    { label: "Activity", module: "activity", icon: "pulse", tint: "accentSoft", onPress: () => router.push("/(tabs)/activity") },
    { label: "Team", module: "team", icon: "people", tint: "accentSoft", onPress: () => router.push("/(tabs)/team") },
  ];
  const tiles: Tile[] = allTiles.filter((tile) => {
    // Owner-only screens keep the hard role rule even if permissions lag.
    if (tile.module === "activity" || tile.module === "team") return user?.role === "owner";
    return canSee(tile.module);
  });

  const tile = (t: Tile) => (
    <TouchableOpacity style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.line }]} onPress={t.onPress}>
      <View style={[styles.tileIcon, { backgroundColor: theme[t.tint] as string }]}>
        <Ionicons name={t.icon as never} size={20} color={theme.ink} />
      </View>
      <Text style={{ fontSize: 13, fontWeight: "600", color: theme.ink }} numberOfLines={1}>
        {t.label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.heading, { color: theme.ink }]}>More</Text>

      <View style={[styles.card, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
        <View style={[styles.row, { borderBottomColor: theme.line }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={[styles.tileIcon, { backgroundColor: theme.surface2 }]}>
              <Ionicons name="contrast" size={18} color={theme.ink} />
            </View>
            <Text style={{ fontSize: 15, color: theme.ink }}>Theme</Text>
          </View>
          <View style={[styles.segRow, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            {MODES.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[styles.seg, themeMode === m.value && { backgroundColor: theme.primary }]}
                onPress={() => setThemeMode(m.value)}
              >
                <Text
                  style={{ fontSize: 11, fontWeight: "600", color: themeMode === m.value ? theme.onPrimary : theme.ink }}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <Text style={[styles.section, { color: theme.muted }]}>MODULES</Text>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <View key={t.module} style={styles.cell}>
            {tile(t)}
          </View>
        ))}
      </View>

      <TouchableOpacity style={[styles.signOutButton, { backgroundColor: theme.error }]} onPress={() => void handleSignOut()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="log-out" size={17} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Sign out</Text>
        </View>
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
  heading: { fontSize: 24, fontWeight: "700", padding: 16, paddingBottom: 8 },
  card: { borderRadius: 14, margin: 12, overflow: "hidden", elevation: 2, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  row: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1 },
  section: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginLeft: 16, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 12 },
  cell: { width: "31.5%", flexGrow: 1 },
  tile: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    gap: 8,
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  tileIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  signOutButton: { margin: 12, padding: 14, borderRadius: 12, alignItems: "center" },
  segRow: { flexDirection: "row", borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  seg: { paddingHorizontal: 10, paddingVertical: 6 },
});
