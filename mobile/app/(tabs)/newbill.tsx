/**
 * Billing screen — create sales bills (invoices).
 *
 * Customer details + line items (qty × rate), discount/GST, payment mode.
 * Submits to POST /api/bills and shows the bill number + total.
 */
import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView } from "react-native";

import { api } from "../../lib/api";
import { useAuth } from "../_layout";

type LineItem = {
  itemId: number;
  qty: number;
  ratePaise: number;
  lineTotalPaise: number;
  itemName?: string;
};

const PAYMENT_MODES: readonly ["Cash", "Card", "UPI", "Credit"] = ["Cash", "Card", "UPI", "Credit"];

export default function BillsScreen() {
  const { theme } = useAuth();
  const [items, setItems] = useState<LineItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [discountPaise, setDiscountPaise] = useState(0);
  const [gstPaise, setGstPaise] = useState(0);
  const [paidPaise, setPaidPaise] = useState(0);
  const [paymentMode, setPaymentMode] = useState<"Cash" | "Card" | "UPI" | "Credit">("Cash");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ billNo: string; totalPaise: number } | null>(null);

  const subtotal = items.reduce((s, i) => s + i.lineTotalPaise, 0);
  const totalPaise = Math.max(0, subtotal - discountPaise + gstPaise);
  const balance = totalPaise - paidPaise;

  const addItem = () => {
    setItems([...items, { itemId: 0, qty: 1, ratePaise: 0, lineTotalPaise: 0, itemName: "" }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof LineItem, value: any) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    next[index].lineTotalPaise = next[index].qty * next[index].ratePaise;
    setItems(next);
  };

  const createBill = async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const { bill } = await api.createBill({
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        lines: items.map((i) => ({ itemId: i.itemId, qty: i.qty, ratePaise: i.ratePaise })),
        discountPaise,
        gstPaise,
        paidPaise,
        paymentMode,
      });
      setResult({ billNo: bill.billNo, totalPaise: bill.totalPaise });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("createBill failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0 && !customerName && !submitting) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        <View style={[styles.header, { backgroundColor: theme.surface }]}>
          <Text style={[styles.heading, { color: theme.ink }]}>New Bill</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>Create sales invoice</Text>
        </View>
        <View style={styles.empty}>
          <Text style={{ color: theme.muted, textAlign: "center" }}>Add items to create a bill</Text>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={[styles.header, { backgroundColor: theme.surface }]}>
          <Text style={[styles.heading, { color: theme.ink }]}>New Bill</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>Create sales invoice</Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, padding: 16 }]}>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Customer</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Customer name"
            placeholderTextColor={theme.muted}
            value={customerName}
            onChangeText={setCustomerName}
          />
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Phone"
            placeholderTextColor={theme.muted}
            value={customerPhone}
            onChangeText={setCustomerPhone}
            keyboardType="phone-pad"
          />
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Email"
            placeholderTextColor={theme.muted}
            value={customerEmail}
            onChangeText={setCustomerEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, marginTop: 12 }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.ink }]}>Line Items</Text>
            <TouchableOpacity onPress={addItem} style={[styles.addItem, { backgroundColor: theme.accentSoft }]}>
              <Text style={{ color: theme.accentInk, fontWeight: "600", fontSize: 12 }}>+ Add Item</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={items}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item, index }) => (
              <TouchableOpacity style={[styles.itemRow, { backgroundColor: theme.surface2 }]}>
                <TextInput
                  style={[styles.itemInput, { color: theme.ink, backgroundColor: theme.surface }]}
                  placeholder="Item name"
                  value={item.itemName || ""}
                  onChangeText={(v) => updateItem(index, "itemName", v)}
                />
                <TextInput
                  style={[styles.itemInput, { width: 60, color: theme.ink, backgroundColor: theme.surface }]}
                  placeholder="Qty"
                  keyboardType="numeric"
                  value={String(item.qty)}
                  onChangeText={(v) => updateItem(index, "qty", Math.max(0, parseInt(v) || 0))}
                />
                <TextInput
                  style={[styles.itemInput, { width: 90, color: theme.ink, backgroundColor: theme.surface }]}
                  placeholder="Rate"
                  keyboardType="numeric"
                  value={String(item.ratePaise / 100)}
                  onChangeText={(v) => updateItem(index, "ratePaise", Math.max(0, parseFloat(v) || 0) * 100)}
                />
                <TouchableOpacity style={[styles.removeItem, { backgroundColor: theme.errorSoft }]} onPress={() => removeItem(index)}>
                  <Text style={{ color: theme.errorInk, fontWeight: "600", fontSize: 14 }}>✕</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            )}
            ListEmptyComponent={undefined}
          />
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, marginTop: 12 }]}>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Totals</Text>
          <View style={[styles.totalRow, { backgroundColor: theme.surface2, borderRadius: 12, padding: 12 }]}>
            <Text style={{ color: theme.muted }}>Subtotal</Text>
            <Text style={{ color: theme.ink, fontWeight: "600" }}>{money(subtotal)}</Text>
          </View>
          <View style={[styles.totalRow, { backgroundColor: theme.surface2, borderRadius: 12, padding: 12 }]}>
            <Text style={{ color: theme.muted }}>Discount</Text>
            <TextInput
              style={[styles.smallInput, { color: theme.ink, backgroundColor: theme.surface }]}
              value={(discountPaise / 100).toString()}
              keyboardType="numeric"
              onChangeText={(v) => setDiscountPaise(Math.max(0, parseFloat(v) || 0) * 100)}
            />
          </View>
          <View style={[styles.totalRow, { backgroundColor: theme.surface2, borderRadius: 12, padding: 12 }]}>
            <Text style={{ color: theme.muted }}>GST</Text>
            <TextInput
              style={[styles.smallInput, { color: theme.ink, backgroundColor: theme.surface }]}
              value={(gstPaise / 100).toString()}
              keyboardType="numeric"
              onChangeText={(v) => setGstPaise(Math.max(0, parseFloat(v) || 0) * 100)}
            />
          </View>
          <View style={[styles.totalRow, { backgroundColor: theme.primary, borderRadius: 12, padding: 12 }]}>
            <Text style={{ color: theme.onPrimary, fontWeight: "700" }}>Total</Text>
            <Text style={{ color: theme.onPrimary, fontWeight: "800", fontSize: 18 }}>{money(totalPaise)}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, marginTop: 12 }]}>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Payment</Text>
          <View style={styles.paymentRow}>
            {PAYMENT_MODES.map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.paymentChip, { backgroundColor: paymentMode === mode ? theme.primary : theme.surface2, borderColor: paymentMode === mode ? theme.primary : theme.line }]}
                onPress={() => setPaymentMode(mode)}
              >
                <Text style={{ color: paymentMode === mode ? theme.onPrimary : theme.ink, fontWeight: "600" }}>{mode}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.rightCol}>
              <Text style={[styles.meta, { color: theme.ink, fontWeight: "600" }]}>{paidPaise > 0 ? money(paidPaise) : "—"}</Text>
              <TextInput
                style={[styles.smallInput, { color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="Paid"
                keyboardType="numeric"
                value={String(paidPaise / 100)}
                onChangeText={(v) => setPaidPaise(Math.max(0, parseFloat(v) || 0) * 100)}
              />
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: submitting ? theme.muted : theme.primary, opacity: items.length === 0 ? 0.5 : 1 }]}
          onPress={() => void createBill()}
          disabled={items.length === 0 || submitting}
        >
          <Text style={{ color: theme.onPrimary, fontWeight: "700", fontSize: 16 }}>{submitting ? "Creating…" : "Create Bill"}</Text>
        </TouchableOpacity>

        {result && (
          <View style={[styles.resultCard, { backgroundColor: theme.successSoft }]}>
            <Text style={{ color: theme.successInk, fontWeight: "700" }}>Bill #{result.billNo} created</Text>
            <Text style={{ color: theme.successInk, fontSize: 18, fontWeight: "700", marginTop: 4 }}>{money(result.totalPaise)}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { padding: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "black" },
  subtitle: { fontSize: 12, marginTop: 2 },
  card: {
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 8,
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "black", marginBottom: 8 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    fontSize: 15,
  },
  itemRow: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  itemInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    flex: 1,
  },
  removeItem: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  addItem: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
  },
  smallInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    width: 80,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  paymentChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  rightCol: { alignItems: "flex-end" },
  submitButton: {
    backgroundColor: "black",
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 12,
    marginTop: 16,
    alignItems: "center",
  },
  resultCard: {
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 12,
    marginTop: 12,
    alignItems: "center",
  },
  empty: { padding: 40, alignItems: "center" },
  meta: { fontSize: 12, color: "black" },
});
