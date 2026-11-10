/**
 * Purchases screen — web parity.
 *
 * Record stock bought from suppliers (date, item, qty, rate, transport,
 * supplier) and see the recent list. Owner can edit a purchase.
 *
 * The old screen read itemName/qtyRemaining/status/amountPaise — fields the
 * API never returns (GET /api/purchases is raw SQL with name/qty_base/
 * total_paise…), so every row rendered blank.
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

import { api, type ItemRow, type PurchaseRow } from "../../lib/api";
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

const PAYMENT_MODES: readonly ["Cash", "UPI", "Card", "Credit"] = ["Cash", "UPI", "Card", "Credit"];

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

function formatQty(base: number, unit: string): string {
  const factor = FACTOR[unit] ?? 1;
  if (factor === 1) return `${Math.round(base)} ${unit}`;
  return `${(base / factor).toFixed(2)} ${unit}`;
}

/** Add-form fields (web `purchase` state). */
type Draft = { itemId: number | ""; qty: string; rate: string; expenses: string; supplier: string; date: string };
const EMPTY_DRAFT: Draft = { itemId: "", qty: "", rate: "", expenses: "", supplier: "", date: todayIso() };

export default function PurchasesScreen() {
  const { theme, user } = useAuth();
  const canCreate = user?.role === "owner" || user?.role === "staff";

  const [items, setItems] = useState<ItemRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState("");

  /** Owner edit (web openPurchaseEdit / savePurchaseEdit). */
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [editDraft, setEditDraft] = useState({
    qty: "",
    rate: "",
    expenses: "",
    supplier: "",
    paymentMode: "Cash" as "Cash" | "UPI" | "Card" | "Credit",
    note: "",
    date: todayIso(),
  });

  const load = useCallback(async () => {
    try {
      const [{ items: list }, { purchases: rows }] = await Promise.all([api.items(), api.purchases()]);
      setItems(list);
      setPurchases(rows);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickedItem = draft.itemId === "" ? undefined : items.find((i) => i.id === draft.itemId);
  /** Web: total = qty × rate (rate in ₹). */
  const draftTotalPaise =
    Number(draft.qty) > 0 ? Math.round(Number(draft.qty) * Math.round(Number(draft.rate || "0") * 100)) : 0;

  const itemMatches = itemQuery.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(itemQuery.trim().toLowerCase()))
    : items;

  /** Web addPurchaseNow. */
  async function savePurchase() {
    const item = draft.itemId === "" ? undefined : items.find((i) => i.id === draft.itemId);
    if (!item || saving) {
      if (!item) setMessage("Choose an item");
      return;
    }
    if (!(Number(draft.qty) > 0)) {
      setMessage("Enter a quantity");
      return;
    }
    if (!(Number(draft.rate) >= 0) || Number.isNaN(Number(draft.rate))) {
      setMessage("Enter the rate in ₹");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.addPurchase({
        itemId: item.id,
        qty: Number(draft.qty),
        unitPricePaise: Math.round(Number(draft.rate) * 100),
        expensesPaise: Math.round(Number(draft.expenses || "0") * 100),
        date: draft.date || todayIso(),
        supplierName: draft.supplier.trim() || undefined,
        paymentMode: "Cash",
      });
      setMessage("Purchase saved");
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: PurchaseRow) {
    const factor = FACTOR[row.unit] ?? 1000;
    setEditing(row);
    setMessage(null);
    setEditDraft({
      qty: String(row.qty_base / factor),
      rate: String(row.unit_price_paise / 100),
      expenses: String(row.expenses_paise / 100),
      supplier: row.supplier_name ?? "",
      paymentMode: (row.payment_mode as "Cash" | "UPI" | "Card" | "Credit") ?? "Cash",
      note: row.note ?? "",
      date: row.purchase_date?.slice(0, 10) ?? todayIso(),
    });
  }

  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      await api.updatePurchase(editing.id, {
        qty: Number(editDraft.qty),
        unitPricePaise: Math.round(Number(editDraft.rate) * 100),
        expensesPaise: Math.round(Number(editDraft.expenses || "0") * 100),
        date: editDraft.date || todayIso(),
        supplierName: editDraft.supplier.trim() || undefined,
        paymentMode: editDraft.paymentMode,
        note: editDraft.note.trim() || undefined,
      });
      setEditing(null);
      setMessage("Purchase updated");
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
          <Text style={[styles.heading, { color: theme.ink }]}>Purchases</Text>
          <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>Record stock you buy from suppliers.</Text>
        </View>

        {/* ---- Add form (web top card) ---- */}
        {canCreate && (
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <Text style={[styles.cardTitle, { color: theme.muted }]}>NEW PURCHASE</Text>

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

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Date</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.muted}
                  value={draft.date}
                  onChangeText={(date) => setDraft({ ...draft, date })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Qty ({pickedItem?.unit ?? "unit"})</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  placeholder="0"
                  placeholderTextColor={theme.muted}
                  keyboardType="decimal-pad"
                  value={draft.qty}
                  onChangeText={(qty) => setDraft({ ...draft, qty })}
                />
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Rate ₹</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  placeholder="0"
                  placeholderTextColor={theme.muted}
                  keyboardType="decimal-pad"
                  value={draft.rate}
                  onChangeText={(rate) => setDraft({ ...draft, rate })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Transport ₹</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  placeholder="0"
                  placeholderTextColor={theme.muted}
                  keyboardType="decimal-pad"
                  value={draft.expenses}
                  onChangeText={(expenses) => setDraft({ ...draft, expenses })}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Supplier</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="Supplier"
              placeholderTextColor={theme.muted}
              value={draft.supplier}
              onChangeText={(supplier) => setDraft({ ...draft, supplier })}
            />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <Text style={{ fontSize: 13, color: theme.muted }}>
                Total: <Text style={{ fontWeight: "700", color: theme.ink }}>{money(draftTotalPaise)}</Text>
              </Text>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: saving ? theme.surface3 : theme.primary }]}
                disabled={saving}
                onPress={() => void savePurchase()}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: saving ? theme.muted : theme.onPrimary }}>
                  {saving ? "Saving…" : "Save purchase"}
                </Text>
              </TouchableOpacity>
            </View>
            {message && !editing && (
              <Text style={{ marginTop: 8, fontSize: 13, color: theme.muted, textAlign: "center" }}>{message}</Text>
            )}
          </View>
        )}

        {/* ---- Recent purchases (web ResponsiveTable) ---- */}
        <Text style={[styles.listTitle, { color: theme.ink }]}>Recent purchases</Text>
        {purchases.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface2 }]}>
            <Text style={{ color: theme.ink, fontSize: 14, fontWeight: "600", textAlign: "center" }}>No purchases yet</Text>
            <Text style={{ color: theme.muted, fontSize: 12, textAlign: "center", marginTop: 4 }}>
              Record what you buy — the weighted-average cost is updated automatically.
            </Text>
          </View>
        ) : (
          purchases.map((row) => (
            <View key={row.id} style={[styles.listRow, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink, flex: 1 }}>
                    {row.name}
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>{money(row.total_paise)}</Text>
                </View>
                <Text numberOfLines={1} style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                  {formatDate(row.purchase_date)} · {formatQty(row.qty_base, row.unit)} @ {money(row.unit_price_paise)}
                  {row.expenses_paise > 0 ? ` · transport ${money(row.expenses_paise)}` : ""}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                  {row.supplier_name ?? "—"}
                  {row.note ? ` · ${row.note}` : ""}
                </Text>
              </View>
              {user?.role === "owner" && (
                <TouchableOpacity onPress={() => openEdit(row)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.primary }}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
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
                    setDraft({ ...draft, itemId: item.id });
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

      {/* ---- Owner edit sheet (web modal) ---- */}
      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => setEditing(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]}>
            <View style={styles.cardTitleRow}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink, flex: 1 }}>
                Edit purchase — {editing?.name}
              </Text>
              <TouchableOpacity onPress={() => setEditing(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Date</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  value={editDraft.date}
                  onChangeText={(date) => setEditDraft({ ...editDraft, date })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Supplier</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  value={editDraft.supplier}
                  onChangeText={(supplier) => setEditDraft({ ...editDraft, supplier })}
                />
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Qty ({editing?.unit})</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  keyboardType="decimal-pad"
                  value={editDraft.qty}
                  onChangeText={(qty) => setEditDraft({ ...editDraft, qty })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Rate ₹ / {editing?.unit}</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  keyboardType="decimal-pad"
                  value={editDraft.rate}
                  onChangeText={(rate) => setEditDraft({ ...editDraft, rate })}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Transport ₹</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              keyboardType="decimal-pad"
              value={editDraft.expenses}
              onChangeText={(expenses) => setEditDraft({ ...editDraft, expenses })}
            />

            <Text style={[styles.label, { color: theme.muted }]}>Payment mode</Text>
            <View style={styles.chipRow}>
              {PAYMENT_MODES.map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.chip,
                    editDraft.paymentMode === mode
                      ? { backgroundColor: theme.primary, borderColor: theme.primary }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => setEditDraft({ ...editDraft, paymentMode: mode })}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: editDraft.paymentMode === mode ? theme.onPrimary : theme.ink }}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Note</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              value={editDraft.note}
              onChangeText={(note) => setEditDraft({ ...editDraft, note })}
            />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: theme.surface3 }]} onPress={() => setEditing(null)}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.ink }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: saving ? theme.surface3 : theme.primary }]}
                disabled={saving}
                onPress={() => void saveEdit()}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: saving ? theme.muted : theme.onPrimary }}>
                  {saving ? "Saving…" : "Save changes"}
                </Text>
              </TouchableOpacity>
            </View>
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
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  listTitle: { fontSize: 15, fontWeight: "700", paddingHorizontal: 16, paddingVertical: 8 },
  listRow: {
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
});
