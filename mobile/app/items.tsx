/**
 * Items screen — web parity.
 *
 * The product master: list with stock left (the old screen read
 * `stockRemaining`, which the API never returns — every quantity was blank),
 * owner Add/Edit/Delete, and the per-item Lots ledger (purchase batches →
 * sold qty/value → profit → pending) from GET /api/items/:id/batches/ledger.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
  Image,
  Modal,
  Pressable,
  Alert,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type BatchLedger, type ItemRow } from "../lib/api";
import { useAuth } from "./_layout";

/** Base units per display unit (src/logic/units.ts FACTOR). */
const FACTOR: Record<string, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  pcs: 1,
  "60 kg bag": 60_000,
};

/** src/logic/units.ts formatQuantity — "1.50 kg", "12 pcs". */
function formatQty(base: number, unit: string): string {
  const factor = FACTOR[unit] ?? 1;
  if (factor === 1) return `${Math.round(base)} ${unit}`;
  return `${(base / factor).toFixed(2)} ${unit}`;
}

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

/** "2026-11-10" → "10 Nov 2026". */
function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

/** The Add/Edit form fields (web itemForm). */
type ItemForm = {
  id: number | null;
  name: string;
  unit: string;
  category: string;
  hsnCode: string;
  /** Min stock in DISPLAY units — sent as integer minStockBase. */
  minStock: string;
  imageUrl: string;
};

const EMPTY_FORM: ItemForm = { id: null, name: "", unit: "kg", category: "", hsnCode: "", minStock: "", imageUrl: "" };

export default function ItemsScreen() {
  const { theme, user } = useAuth();
  const isOwner = user?.role === "owner";

  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Add / edit form (owner). */
  const [form, setForm] = useState<ItemForm | null>(null);
  const [saving, setSaving] = useState(false);

  /** Lots modal (web openLots / lotLedger). */
  const [lotItem, setLotItem] = useState<ItemRow | null>(null);
  const [ledger, setLedger] = useState<BatchLedger | null>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const [lotError, setLotError] = useState<string | null>(null);
  const [expandedLot, setExpandedLot] = useState<number | null>(null);

  /** Search the master by name (client-side — the list is small). */
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const { items: data } = await api.items();
      setItems(data);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((i) => i.name.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  /** Web saveItem — one body for create and edit. */
  async function saveItem() {
    if (!form || saving) return;
    if (!form.name.trim()) {
      setMessage("Name is required");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const factor = FACTOR[form.unit] ?? 1000;
      const body = {
        name: form.name.trim(),
        unit: form.unit,
        category: form.category.trim() || undefined,
        hsnCode: form.hsnCode.trim() || undefined,
        minStockBase: Math.round((Number(form.minStock) || 0) * factor),
        imageUrl: form.imageUrl.trim() || undefined,
      };
      if (form.id === null) await api.createItem(body);
      else await api.updateItem(form.id, body);
      setForm(null);
      await load();
      setMessage("Saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function deleteItem(item: ItemRow) {
    Alert.alert(`Delete ${item.name}?`, "The item and its batches are removed from the master.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void api
            .deleteItem(item.id)
            .then(async () => {
              setMessage(`${item.name} deleted`);
              await load();
            })
            .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
        },
      },
    ]);
  }

  /** Web openLots — fetch the batch ledger and open the modal. */
  async function openLots(item: ItemRow) {
    setLotItem(item);
    setLedger(null);
    setLotError(null);
    setExpandedLot(null);
    setLotLoading(true);
    try {
      const res = await api.batchLedger(item.id);
      setLedger(res.ledger);
    } catch (err) {
      setLotError(err instanceof Error ? err.message : String(err));
    } finally {
      setLotLoading(false);
    }
  }

  function editItem(item: ItemRow) {
    const factor = FACTOR[item.unit] ?? 1000;
    setForm({
      id: item.id,
      name: item.name,
      unit: item.unit,
      category: item.category ?? "",
      hsnCode: item.hsnCode ?? "",
      minStock: String(item.minStockBase / factor),
      imageUrl: item.imageUrl ?? "",
    });
    setMessage(null);
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
          <View style={{ flex: 1 }}>
            <Text style={[styles.heading, { color: theme.ink }]}>Items</Text>
          </View>
          {isOwner && (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: theme.primary }]}
              onPress={() => {
                setForm({ ...EMPTY_FORM });
                setMessage(null);
              }}
            >
              <Ionicons name="add" size={16} color={theme.onPrimary} />
              <Text style={{ fontSize: 13, fontWeight: "700", color: theme.onPrimary }}>Add item</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ---- Add / Edit form (owner) ---- */}
        {form && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: form.id !== null ? theme.accent : undefined }]}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: theme.muted }]}>{form.id === null ? "ADD ITEM" : "EDIT ITEM"}</Text>
              <TouchableOpacity
                onPress={() => {
                  setForm(null);
                  setMessage(null);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Item name</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="Item name"
              placeholderTextColor={theme.muted}
              value={form.name}
              onChangeText={(name) => setForm({ ...form, name })}
            />

            <Text style={[styles.label, { color: theme.muted }]}>Unit</Text>
            <View style={styles.chipRow}>
              {["kg", "60 kg bag"].map((unit) => (
                <TouchableOpacity
                  key={unit}
                  style={[
                    styles.chip,
                    form.unit === unit
                      ? { backgroundColor: theme.primary, borderColor: theme.primary }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => setForm({ ...form, unit })}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: form.unit === unit ? theme.onPrimary : theme.ink }}>{unit}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Category</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="Category"
              placeholderTextColor={theme.muted}
              value={form.category}
              onChangeText={(category) => setForm({ ...form, category })}
            />

            <Text style={[styles.label, { color: theme.muted }]}>HSN code</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="HSN code"
              placeholderTextColor={theme.muted}
              value={form.hsnCode}
              onChangeText={(hsnCode) => setForm({ ...form, hsnCode })}
            />

            <Text style={[styles.label, { color: theme.muted }]}>Min stock ({form.unit})</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="0"
              placeholderTextColor={theme.muted}
              keyboardType="decimal-pad"
              value={form.minStock}
              onChangeText={(minStock) => setForm({ ...form, minStock })}
            />

            <Text style={[styles.label, { color: theme.muted }]}>Image link (https://…png) — optional</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[styles.thumb, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
                {form.imageUrl ? (
                  <Image source={{ uri: form.imageUrl }} style={styles.thumbImage} resizeMode="cover" />
                ) : (
                  <Ionicons name="image-outline" size={16} color={theme.muted} />
                )}
              </View>
              <TextInput
                style={[styles.input, { flex: 1, borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="https://…"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                value={form.imageUrl}
                onChangeText={(imageUrl) => setForm({ ...form, imageUrl })}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: saving ? theme.surface3 : theme.primary }]}
                disabled={saving}
                onPress={() => void saveItem()}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: saving ? theme.muted : theme.onPrimary }}>
                  {saving ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: theme.surface3 }]}
                onPress={() => {
                  setForm(null);
                  setMessage(null);
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.ink }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ---- Search ---- */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={14} color={theme.muted} />
          <TextInput
            style={[styles.searchInput, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface }]}
            placeholder="Search items"
            placeholderTextColor={theme.muted}
            value={query}
            onChangeText={setQuery}
          />
        </View>

        {message && (
          <Text style={{ paddingHorizontal: 16, paddingBottom: 6, fontSize: 13, color: theme.muted }}>{message}</Text>
        )}

        {/* ---- List (web ResponsiveTable) ---- */}
        {visible.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface2 }]}>
            <Text style={{ color: theme.ink, fontSize: 14, fontWeight: "600", textAlign: "center" }}>No items yet</Text>
            <Text style={{ color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 4 }}>
              Add the products you buy and sell — stock, cost and profit follow automatically.
            </Text>
          </View>
        ) : (
          visible.map((item) => {
            const low = item.minStockBase > 0 && item.stockLeftBase <= item.minStockBase;
            return (
              <View key={item.id} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <View style={[styles.thumb, { borderColor: theme.line, backgroundColor: theme.surface3 }]}>
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={styles.thumbImage} resizeMode="cover" />
                  ) : (
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.muted }}>{item.name.trim()[0] ?? "?"}</Text>
                  )}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink, flex: 1 }}>
                      {item.name}
                    </Text>
                    {low && (
                      <View style={[styles.lowBadge, { backgroundColor: theme.errorSoft }]}>
                        <Text style={{ fontSize: 9, fontWeight: "700", color: theme.errorInk }}>LOW</Text>
                      </View>
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                    {item.hsnCode ? `HSN ${item.hsnCode} · ` : ""}
                    {item.category ?? "—"} · {item.unit}
                    {item.avgCostPaise > 0 ? ` · avg ${money(item.avgCostPaise)}` : ""}
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: theme.accentInk, marginTop: 2 }}>
                    {formatQty(item.stockLeftBase, item.unit)} left
                  </Text>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity onPress={() => void openLots(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.primary }}>Lots</Text>
                  </TouchableOpacity>
                  {isOwner && (
                    <>
                      <TouchableOpacity onPress={() => editItem(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.ink }}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteItem(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.errorInk }}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ---- Lots modal (web: Lots table, expandable rows) ---- */}
      <Modal visible={lotItem !== null} transparent animationType="fade" onRequestClose={() => setLotItem(null)}>
        <Pressable style={styles.backdrop} onPress={() => setLotItem(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]}>
            <View style={styles.cardTitleRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Lots — {lotItem?.name}</Text>
                <Text style={{ fontSize: 11, color: theme.muted }}>per purchase batch</Text>
              </View>
              <TouchableOpacity onPress={() => setLotItem(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {lotLoading && <Text style={{ fontSize: 13, color: theme.muted, paddingVertical: 8 }}>Loading lots…</Text>}
            {lotError && <Text style={{ fontSize: 13, color: theme.errorInk, paddingVertical: 8 }}>{lotError}</Text>}

            {ledger && ledger.batches.length === 0 && (
              <Text style={{ fontSize: 13, color: theme.muted, paddingVertical: 8 }}>No purchase lots for this item yet.</Text>
            )}

            {ledger && ledger.batches.length > 0 && (
              <ScrollView style={{ maxHeight: 460 }}>
                <View style={[styles.lotHead, { borderBottomColor: theme.line }]}>
                  <Text style={[styles.lotHeadText, { color: theme.muted }]}>Lot</Text>
                  <Text style={[styles.lotHeadText, { color: theme.muted }]}>Bought</Text>
                  <Text style={[styles.lotHeadText, { color: theme.muted }]}>Pending</Text>
                  <Text style={[styles.lotHeadText, { color: theme.muted }]}>Profit</Text>
                </View>
                {ledger.batches.map((row) => {
                  const open = expandedLot === row.batchId;
                  return (
                    <View key={row.batchId} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line }}>
                      <TouchableOpacity
                        style={styles.lotRow}
                        onPress={() => setExpandedLot((prev) => (prev === row.batchId ? null : row.batchId))}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.ink }}>
                            #{row.batchId} {open ? "▾" : "▸"}
                          </Text>
                          <Text style={{ fontSize: 10, color: theme.muted }}>
                            {formatDate(row.purchaseDate)}
                            {row.supplierName ? ` · ${row.supplierName}` : ""}
                          </Text>
                        </View>
                        <Text style={[styles.lotCell, { color: theme.ink }]}>{formatQty(row.qtyOriginal, ledger.unit)}</Text>
                        <Text style={[styles.lotCell, { color: theme.accentInk }]}>{formatQty(row.qtyRemaining, ledger.unit)}</Text>
                        <Text style={[styles.lotCell, { color: row.profitPaise >= 0 ? theme.successInk : theme.errorInk }]}>
                          {money(row.profitPaise)}
                        </Text>
                      </TouchableOpacity>

                      {open && (
                        <View style={{ padding: 8, gap: 4 }}>
                          <Text style={{ fontSize: 11, color: theme.muted }}>
                            Unit cost {money(row.unitPricePaise)}
                            {row.expensesPaise > 0 ? ` · + expenses ${money(row.expensesPaise)}` : ""} · Sold{" "}
                            {formatQty(row.qtySold, ledger.unit)} ({money(row.soldValuePaise)}) · Pending value{" "}
                            {money(row.pendingValuePaise)}
                          </Text>
                          {row.sales.length === 0 ? (
                            <Text style={{ fontSize: 11, color: theme.muted }}>No sales from this lot yet.</Text>
                          ) : (
                            row.sales.map((sale) => (
                              <Text key={sale.billNo} style={{ fontSize: 11, color: theme.muted }}>
                                {sale.billNo} · {formatDate(sale.saleDate)} · {sale.customerName ?? "Walk-in"} ·{" "}
                                {formatQty(sale.qtyTaken, ledger.unit)} → {money(sale.revenuePaise)} (profit{" "}
                                {money(sale.profitPaise)})
                              </Text>
                            ))
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  heading: { fontSize: 24, fontWeight: "700" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  card: {
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "transparent",
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  label: { fontSize: 11, fontWeight: "600", marginBottom: 4, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    minHeight: 40,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44 },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  lowBadge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, minHeight: 38, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { borderRadius: 12, padding: 24, alignItems: "center", marginHorizontal: 12, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  sheet: { borderRadius: 16, padding: 14 },
  lotHead: { flexDirection: "row", gap: 8, borderBottomWidth: 1, paddingVertical: 6 },
  lotHeadText: { fontSize: 10, fontWeight: "700", flex: 1, textAlign: "right" },
  lotRow: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 8 },
  lotCell: { fontSize: 11, fontWeight: "600", flex: 1, textAlign: "right" },
});
