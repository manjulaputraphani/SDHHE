/**
 * Supplier Dues screen — web parity.
 *
 * Total outstanding, add supplier, the dues table, record a payment against
 * a purchase, and the recent payments list.
 * /api/suppliers · /api/supplier-dues · /api/supplier-payments.
 */
import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type PurchaseRow, type SupplierPaymentRow, type SupplierWithDues } from "../lib/api";
import { useAuth } from "./_layout";

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

export default function SuppliersScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();
  const canCreate = user?.role === "owner" || user?.role === "staff";

  const [dues, setDues] = useState<SupplierWithDues[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Record payment (web recordPayment state). */
  const [payOpen, setPayOpen] = useState(false);
  const [purchaseId, setPurchaseId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => todayIso());
  const [paymentMode, setPaymentMode] = useState<"Cash" | "UPI" | "Card" | "Credit">("Cash");
  const [payNote, setPayNote] = useState("");
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ dues: d }, { payments: p }, { purchases: list }] = await Promise.all([
        api.supplierDues(),
        api.supplierPayments(),
        api.purchases(),
      ]);
      setDues(d);
      setPayments(p);
      setPurchases(list);
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

  const totalOutstanding = dues.reduce((sum, d) => sum + d.outstanding_paise, 0);
  const openPurchases = purchases.filter((p) => p.total_paise > p.paid_paise);

  /** Web addSupplierNow. */
  async function addSupplier() {
    if (!supplierName.trim() || adding) return;
    setAdding(true);
    setMessage(null);
    try {
      await api.createSupplier({ name: supplierName.trim(), phone: supplierPhone.trim() || undefined });
      setSupplierName("");
      setSupplierPhone("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  /** Web recordSupplierPaymentNow. */
  async function recordPayment() {
    const paise = Math.round(Number(amount) * 100);
    if (purchaseId === "" || !(paise > 0) || paying) return;
    setPaying(true);
    setMessage(null);
    try {
      await api.recordSupplierPayment({
        purchaseId: Number(purchaseId),
        amountPaise: paise,
        paymentDate,
        paymentMode,
        note: payNote.trim() || undefined,
      });
      setPayOpen(false);
      setPurchaseId("");
      setAmount("");
      setPayNote("");
      setMessage("Payment recorded");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
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
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={theme.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 22, fontWeight: "700", color: theme.ink }}>Supplier Dues</Text>
            <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
              What you owe suppliers · total outstanding{" "}
              <Text style={{ fontWeight: "700", color: totalOutstanding > 0 ? theme.errorInk : theme.muted }}>
                {money(totalOutstanding)}
              </Text>
            </Text>
          </View>
        </View>

        {/* ---- Add supplier ---- */}
        {canCreate && (
          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <Text style={[styles.cardTitle, { color: theme.muted }]}>ADD SUPPLIER</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1, borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="Name"
                placeholderTextColor={theme.muted}
                value={supplierName}
                onChangeText={setSupplierName}
              />
              <TextInput
                style={[styles.input, { flex: 1, borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="Phone"
                placeholderTextColor={theme.muted}
                keyboardType="phone-pad"
                value={supplierPhone}
                onChangeText={setSupplierPhone}
              />
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: adding || !supplierName.trim() ? theme.surface3 : theme.primary }]}
              disabled={adding || !supplierName.trim()}
              onPress={() => void addSupplier()}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: adding || !supplierName.trim() ? theme.muted : theme.onPrimary }}>
                {adding ? "Adding…" : "Add supplier"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {message && <Text style={{ paddingHorizontal: 16, paddingBottom: 6, fontSize: 13, color: theme.muted }}>{message}</Text>}

        {/* ---- Dues ---- */}
        <Text style={[styles.listTitle, { color: theme.ink }]}>Supplier dues</Text>
        {dues.length === 0 ? (
          <Text style={{ paddingHorizontal: 16, fontSize: 13, color: theme.muted }}>No suppliers yet. Add your first one above.</Text>
        ) : (
          dues.map((row) => (
            <View key={row.id} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink }}>{row.name}</Text>
                <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                  {row.phone ?? "—"} · purchased {money(row.total_purchased_paise)} · paid {money(row.total_paid_paise)}
                </Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: "700", color: row.outstanding_paise > 0 ? theme.errorInk : theme.successInk }}>
                {row.outstanding_paise > 0 ? money(row.outstanding_paise) : "Paid"}
              </Text>
            </View>
          ))
        )}

        {/* ---- Record payment ---- */}
        {canCreate && (
          <TouchableOpacity style={[styles.card, { backgroundColor: theme.surface }]} onPress={() => setPayOpen(true)}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: theme.ink }}>Record payment to supplier</Text>
            <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
              Select a purchase with an outstanding balance and enter the amount paid.
            </Text>
          </TouchableOpacity>
        )}

        {/* ---- Recent payments ---- */}
        <Text style={[styles.listTitle, { color: theme.ink }]}>Recent payments</Text>
        {payments.length === 0 ? (
          <Text style={{ paddingHorizontal: 16, fontSize: 13, color: theme.muted }}>No payments yet.</Text>
        ) : (
          payments.map((row) => (
            <View key={row.id} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: theme.ink, flex: 1 }}>
                    {row.item_name}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: theme.ink }}>{money(row.amount_paise)}</Text>
                </View>
                <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                  {formatDate(row.payment_date)} · {row.payment_mode ?? "—"}
                  {row.note ? ` · ${row.note}` : ""}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* ---- Record payment sheet ---- */}
      <Modal visible={payOpen} transparent animationType="fade" onRequestClose={() => setPayOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPayOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]}>
            <View style={styles.cardTitleRow}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Record payment to supplier</Text>
              <TouchableOpacity onPress={() => setPayOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={20} color={theme.muted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Purchase</Text>
            <View style={{ gap: 6 }}>
              {openPurchases.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.pickRow,
                    purchaseId === p.id
                      ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => setPurchaseId(p.id)}
                >
                  <Text style={{ flex: 1, fontSize: 13, color: theme.ink }}>
                    {p.name} · {formatDate(p.purchase_date)}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.errorInk }}>
                    {money(p.total_paise - p.paid_paise)}
                  </Text>
                </TouchableOpacity>
              ))}
              {openPurchases.length === 0 && (
                <Text style={{ fontSize: 12, color: theme.muted }}>No purchases with an outstanding balance.</Text>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Amount ₹</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  placeholder="0"
                  placeholderTextColor={theme.muted}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: theme.muted }]}>Date</Text>
                <TextInput
                  style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.muted}
                  value={paymentDate}
                  onChangeText={setPaymentDate}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Mode</Text>
            <View style={styles.chipRow}>
              {PAYMENT_MODES.map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.chip,
                    paymentMode === mode
                      ? { backgroundColor: theme.primary, borderColor: theme.primary }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => setPaymentMode(mode)}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: paymentMode === mode ? theme.onPrimary : theme.ink }}>{mode}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { color: theme.muted }]}>Note</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="Optional"
              placeholderTextColor={theme.muted}
              value={payNote}
              onChangeText={setPayNote}
            />

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: paying || purchaseId === "" || !(Number(amount) > 0) ? theme.surface3 : theme.primary }]}
              disabled={paying || purchaseId === "" || !(Number(amount) > 0)}
              onPress={() => void recordPayment()}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: paying ? theme.muted : theme.onPrimary }}>
                {paying ? "Recording…" : "Record payment"}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", padding: 16 },
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
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  pickRow: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  listTitle: { fontSize: 15, fontWeight: "700", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  row: { padding: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  sheet: { borderRadius: 16, padding: 14 },
});
