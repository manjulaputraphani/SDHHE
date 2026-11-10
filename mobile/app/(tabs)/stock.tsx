/**
 * Stock Check screen — web parity.
 *
 * Record USAGE / WASTAGE / STOCK_CHECK entries per item and see the last 30.
 * The old screen called a phantom "stockCheck rows" shape — GET /api/stock
 * actually returns recent ENTRIES, so the list never showed anything.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Pressable,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type ItemRow, type StockEntryRow } from "../../lib/api";
import { useAuth } from "../_layout";

/** Base units per display unit (src/logic/units.ts FACTOR). */
const FACTOR: Record<string, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  pcs: 1,
  "60 kg bag": 60_000,
};

/** Web STOCK_TYPE_LABEL. */
const TYPES: Array<{ value: "USAGE" | "WASTAGE" | "STOCK_CHECK"; label: string }> = [
  { value: "USAGE", label: "Used" },
  { value: "WASTAGE", label: "Wastage" },
  { value: "STOCK_CHECK", label: "Stock left" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatQty(base: number, unit: string): string {
  const factor = FACTOR[unit] ?? 1;
  if (factor === 1) return `${Math.round(base)} ${unit}`;
  return `${(base / factor).toFixed(2)} ${unit}`;
}

/** "2026-11-10T…" → "10 Nov 2026, 8:35 PM" (web formatDateTime). */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

export default function StockScreen() {
  const { theme, user } = useAuth();
  const canCreate = user?.role === "owner" || user?.role === "staff";

  const [items, setItems] = useState<ItemRow[]>([]);
  const [entries, setEntries] = useState<StockEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** The entry form (web `stock` state). */
  const [itemId, setItemId] = useState<number | "">("");
  const [type, setType] = useState<"USAGE" | "WASTAGE" | "STOCK_CHECK">("USAGE");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  /** Open batches of the picked item (current-stock hint, web pickStockItem). */
  const [batches, setBatches] = useState<Array<{ id: number; qty_remaining: number }>>([]);

  const load = useCallback(async () => {
    try {
      const [{ items: list }, { entries: rows }] = await Promise.all([api.items(), api.stockEntries()]);
      setItems(list);
      setEntries(rows);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickedItem = itemId === "" ? undefined : items.find((i) => i.id === itemId);
  const currentStockBase = batches.reduce((sum, b) => sum + b.qty_remaining, 0);

  const itemMatches = itemQuery.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(itemQuery.trim().toLowerCase()))
    : items;

  /** Web pickStockItem — also loads the open batches for the stock hint. */
  function pick(id: number | "") {
    setItemId(id);
    setMessage(null);
    if (id === "") {
      setBatches([]);
      return;
    }
    void api
      .itemBatches(id)
      .then((r) => setBatches(r.batches))
      .catch(() => setBatches([]));
  }

  /** Web saveStockNow. */
  async function saveEntry() {
    const item = pickedItem;
    if (!item || saving) {
      if (!item) setMessage("Choose an item");
      return;
    }
    const base = Math.round(Number(qty) * (FACTOR[item.unit] ?? 1));
    if (!(Number(qty) > 0) || !(base > 0)) {
      setMessage("Enter a quantity");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.saveStock({
        itemId: item.id,
        type,
        qty: type === "STOCK_CHECK" ? null : base,
        enteredLeft: type === "STOCK_CHECK" ? base : null,
        date: todayIso(),
        note: note.trim() || undefined,
      });
      setMessage("Stock entry saved");
      setItemId("");
      setType("USAGE");
      setQty("");
      setNote("");
      setBatches([]);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().then(() => setRefreshing(false));
            }}
            tintColor={theme.muted}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.ink }]}>Stock Check</Text>
          <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
            Record usage, wastage or the stock counted on the shelf.
          </Text>
        </View>

        {/* ---- Entry form (web top card) ---- */}
        {canCreate && (
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <Text style={[styles.cardTitle, { color: theme.muted }]}>NEW ENTRY</Text>

            <Text style={[styles.label, { color: theme.muted }]}>Item</Text>
            <TouchableOpacity
              style={[styles.pickerBtn, { borderColor: theme.line, backgroundColor: theme.surface2 }]}
              onPress={() => {
                setItemQuery("");
                setPickerOpen(true);
              }}
            >
              <Text style={{ fontSize: 14, color: pickedItem ? theme.ink : theme.muted }} numberOfLines={1}>
                {pickedItem ? pickedItem.name : "Choose item…"}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.muted} />
            </TouchableOpacity>

            <Text style={[styles.label, { color: theme.muted }]}>Type</Text>
            <View style={styles.chipRow}>
              {TYPES.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    type === option.value
                      ? { backgroundColor: theme.primary, borderColor: theme.primary }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => setType(option.value)}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: type === option.value ? theme.onPrimary : theme.ink }}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={[styles.label, { color: theme.muted }]}>
                Quantity {type === "STOCK_CHECK" ? "(stock left)" : ""}
              </Text>
              {pickedItem && batches.length > 0 && (
                <Text style={{ fontSize: 11, color: theme.muted }}>
                  Stock: <Text style={{ fontWeight: "700", color: theme.ink }}>{formatQty(currentStockBase, pickedItem.unit)}</Text>
                </Text>
              )}
            </View>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder={type === "STOCK_CHECK" ? "Stock left" : "Quantity"}
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
              value={qty}
              onChangeText={setQty}
            />

            <Text style={[styles.label, { color: theme.muted }]}>Note</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="Optional"
              placeholderTextColor={theme.muted}
              value={note}
              onChangeText={setNote}
            />

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: saving ? theme.surface3 : theme.primary }]}
              disabled={saving}
              onPress={() => void saveEntry()}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: saving ? theme.muted : theme.onPrimary }}>
                {saving ? "Saving…" : "Save entry"}
              </Text>
            </TouchableOpacity>
            {message && (
              <Text style={{ marginTop: 8, fontSize: 13, color: theme.muted, textAlign: "center" }}>{message}</Text>
            )}
          </View>
        )}

        {/* ---- Recent entries (web ResponsiveTable) ---- */}
        <View style={styles.listHead}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Recent entries</Text>
          <Text style={{ fontSize: 11, color: theme.muted }}>Last 30 entries</Text>
        </View>

        {entries.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface2 }]}>
            <Text style={{ color: theme.muted, fontSize: 13, textAlign: "center" }}>No stock entries yet.</Text>
          </View>
        ) : (
          entries.map((row) => {
            const isCheck = row.type === "STOCK_CHECK";
            const isWastage = row.type === "WASTAGE";
            const badgeBg = isCheck ? theme.accentSoft : isWastage ? theme.errorSoft : theme.surface3;
            const badgeInk = isCheck ? theme.accentInk : isWastage ? theme.errorInk : theme.ink;
            const label = TYPES.find((t) => t.value === row.type)?.label ?? row.type;
            return (
              <View key={row.id} style={[styles.listRow, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink, flex: 1 }}>
                      {row.item}
                    </Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>
                      {formatQty(row.qtyBase, row.unit)}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                    {row.createdAt ? formatDateTime(row.createdAt) : formatDate(row.date)}
                    {row.note ? ` · ${row.note}` : ""}
                    {row.user ? ` · by ${row.user}` : ""}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: badgeBg }]}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: badgeInk }}>{label}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ---- Item picker ---- */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]}>
            <View style={styles.cardTitleRow}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Choose an item</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="Search items"
              placeholderTextColor={theme.muted}
              value={itemQuery}
              onChangeText={setItemQuery}
            />
            <ScrollView style={{ maxHeight: 320 }}>
              {itemMatches.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.pickerRow, { borderBottomColor: theme.line }]}
                  onPress={() => {
                    pick(item.id);
                    setPickerOpen(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted }}>
                      {item.unit} · {formatQty(item.stockLeftBase, item.unit)} left
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {itemMatches.length === 0 && (
                <Text style={{ textAlign: "center", color: theme.muted, padding: 16, fontSize: 13 }}>No items match.</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 16 },
  heading: { fontSize: 24, fontWeight: "700" },
  card: {
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 10,
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "600", marginBottom: 4, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 14, minHeight: 40 },
  pickerBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 42,
  },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 12 },
  listHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  empty: { borderRadius: 12, padding: 24, alignItems: "center", marginHorizontal: 12, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  sheet: { borderRadius: 16, padding: 14 },
});
