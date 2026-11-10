/**
 * New Bill screen — raise a GST invoice (web parity).
 *
 * Customer (pick a saved client or type new), line items picked from the item
 * master (qty in display units → integer base units), margin suggestion, GST
 * rate (CGST/SGST split), discount + delivery expenses, live totals.
 *
 * POST /api/bills contract (src/db/billing.ts saleBillSchema):
 *   { customerId, date, paymentMode, lines: [{ itemId, qtyBase,
 *     unitPricePaise, hsnCode }], discountPaise, gstPaise, gstRateBp,
 *     saleExpensesPaise } — total server-side = subtotal − discount + gst.
 */
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  FlatList,
  Pressable,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type Customer, type ItemRow } from "../../lib/api";
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

const GST_RATES = [
  { label: "0%", value: "0" },
  { label: "5%", value: "500" },
  { label: "12%", value: "1200" },
  { label: "18%", value: "1800" },
  { label: "28%", value: "2800" },
] as const;

const PAYMENT_MODES: readonly ["Cash", "UPI", "Card", "Credit"] = ["Cash", "UPI", "Card", "Credit"];

/** One bill line, once added (web billLines). */
type BillLine = {
  itemId: number;
  name: string;
  unit: string;
  qtyBase: number;
  ratePaise: number;
  hsn: string;
  totalPaise: number;
};

function money(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function NewBillScreen() {
  const { theme } = useAuth();

  // Masters.
  const [items, setItems] = useState<ItemRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Customer (web billCustomer + pickedCustomer + CustomerPicker).
  const [customerSearch, setCustomerSearch] = useState("");
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [billCustomer, setBillCustomer] = useState({ name: "", phone: "", email: "", gstin: "" });

  // Draft line (web draft).
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [draft, setDraft] = useState<{ itemId: number | ""; qty: string; rate: string; hsn: string }>({
    itemId: "",
    qty: "",
    rate: "",
    hsn: "",
  });
  const [billMargin, setBillMargin] = useState("6");
  const [billLines, setBillLines] = useState<BillLine[]>([]);

  // Summary (web: billDate/billMode/billGst/billDiscount/billSaleExpenses).
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billMode, setBillMode] = useState<"Cash" | "UPI" | "Card" | "Credit">("Cash");
  const [billGst, setBillGst] = useState("500");
  const [billDiscount, setBillDiscount] = useState("");
  const [billSaleExpenses, setBillSaleExpenses] = useState("");

  // Result.
  const [saving, setSaving] = useState(false);
  const [billMsg, setBillMsg] = useState<string | null>(null);
  const [lastBill, setLastBill] = useState<{ billNo: string; totalPaise: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .items()
      .then((r) => alive && setItems(r.items))
      .catch(() => undefined);
    void api
      .customers()
      .then((r) => alive && setCustomers(r.customers))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const draftItem = draft.itemId === "" ? undefined : items.find((i) => i.id === draft.itemId);
  /** Web draftSuggestedPaise: avg cost × (1 + margin%). */
  const suggestedPaise = Math.round(((draftItem?.avgCostPaise ?? 0) * (100 + (Number(billMargin) || 0))) / 100);

  /** Pick a saved client — their details fill the form (web CustomerPicker). */
  const customerMatches = useMemo(() => {
    const needle = customerSearch.trim().toLowerCase();
    const pool = needle ? customers.filter((c) => c.name.toLowerCase().includes(needle) || (c.phone ?? "").includes(needle)) : customers;
    return pool.slice(0, 6);
  }, [customerSearch, customers]);

  /** Item-picker rows (web ItemPicker = select; mobile = searchable modal). */
  const itemMatches = useMemo(() => {
    const needle = itemQuery.trim().toLowerCase();
    return needle ? items.filter((i) => i.name.toLowerCase().includes(needle)) : items;
  }, [itemQuery, items]);

  // Totals (web billSubtotal … billTotal).
  const billSubtotal = billLines.reduce((sum, l) => sum + l.totalPaise, 0);
  const discountPaise = Math.round(Number(billDiscount || "0") * 100);
  const saleExpensesPaise = Math.round(Number(billSaleExpenses || "0") * 100);
  const taxable = Math.max(0, billSubtotal - discountPaise);
  const gstPaise = Math.round((taxable * Number(billGst || "0")) / 10_000);
  const billTotal = taxable + gstPaise;
  const gstRatePercent = Number(billGst || 0) / 100;
  const cgstPaise = Math.round(gstPaise / 2);
  const sgstPaise = gstPaise - cgstPaise;
  // The shop's GSTIN isn't loaded on mobile — split CGST/SGST (web's default
  // when either GSTIN is missing; the printed invoice does the same).

  function addBillLine() {
    const item = draft.itemId === "" ? undefined : items.find((i) => i.id === draft.itemId);
    if (!item) {
      setBillMsg("Choose an item first");
      return;
    }
    const qty = Number(draft.qty);
    const rate = Math.round(Number(draft.rate) * 100);
    if (!(qty > 0)) {
      setBillMsg("Enter a quantity");
      return;
    }
    if (!(rate >= 0) || Number.isNaN(rate)) {
      setBillMsg("Enter a rate in ₹");
      return;
    }
    const lineFactor = FACTOR[item.unit] ?? 1;
    const qtyBase = Math.round(qty * lineFactor);
    setBillLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        qtyBase,
        ratePaise: rate,
        hsn: draft.hsn.trim() || item.hsnCode || "",
        totalPaise: Math.round((qtyBase * rate) / lineFactor),
      },
    ]);
    setDraft({ itemId: "", qty: "", rate: "", hsn: "" });
    setBillMsg(null);
  }

  /** Web saveBill: save the customer (if named), then POST the bill. */
  async function saveBill() {
    setBillMsg(null);
    if (billLines.length === 0) {
      setBillMsg("Add at least one item");
      return;
    }
    if (billMode === "Credit" && !billCustomer.name.trim()) {
      setBillMsg("Customer name is required for a credit bill");
      return;
    }
    setSaving(true);
    try {
      let customerId: number | undefined;
      if (billCustomer.name.trim()) {
        const { customer } = await api.saveCustomer(billCustomer);
        customerId = customer.id;
      }
      const { bill } = await api.createBill({
        customerId,
        date: billDate,
        paymentMode: billMode,
        lines: billLines.map((l) => ({
          itemId: l.itemId,
          qtyBase: l.qtyBase,
          unitPricePaise: l.ratePaise,
          hsnCode: l.hsn || undefined,
        })),
        discountPaise,
        gstPaise,
        gstRateBp: Number(billGst || "0"),
        saleExpensesPaise,
      });
      setBillMsg(`Bill ${bill.billNo} created — ${money(bill.totalPaise)}`);
      setLastBill({ billNo: bill.billNo, totalPaise: bill.totalPaise });
      setBillLines([]);
      setBillCustomer({ name: "", phone: "", email: "", gstin: "" });
      setPickedCustomer(null);
      setBillDiscount("");
      setBillSaleExpenses("");
      api
        .customers()
        .then((r) => setCustomers(r.customers))
        .catch(() => undefined);
      api
        .items()
        .then((r) => setItems(r.items))
        .catch(() => undefined);
    } catch (err) {
      setBillMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <Text style={[styles.heading, { color: theme.ink }]}>New Bill</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>Raise a GST invoice — customer, items and totals update live.</Text>
        </View>

        {/* ---- Customer ---- */}
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: theme.muted }]}>CUSTOMER</Text>
            {pickedCustomer && (
              <TouchableOpacity
                style={[styles.miniBtn, { borderColor: theme.line }]}
                onPress={() => {
                  setPickedCustomer(null);
                  setBillCustomer({ name: "", phone: "", email: "", gstin: "" });
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.ink }}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={[styles.label, { color: theme.muted }]}>Pick saved client</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Search by name or phone"
            placeholderTextColor={theme.muted}
            value={customerSearch}
            onChangeText={setCustomerSearch}
          />
          {customerMatches.length > 0 && (
            <View style={styles.matchRow}>
              {customerMatches.map((customer) => (
                <TouchableOpacity
                  key={customer.id}
                  style={[
                    styles.matchChip,
                    pickedCustomer?.id === customer.id
                      ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => {
                    setPickedCustomer(customer);
                    setBillCustomer({
                      name: customer.name,
                      phone: customer.phone ?? "",
                      email: customer.email ?? "",
                      gstin: customer.gstin ?? "",
                    });
                    setCustomerSearch("");
                  }}
                >
                  <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: theme.ink }}>
                    {customer.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={[styles.label, { color: theme.muted, marginTop: 8 }]}>Customer name</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Walk-in or name"
            placeholderTextColor={theme.muted}
            value={billCustomer.name}
            onChangeText={(name) => setBillCustomer({ ...billCustomer, name })}
          />
          <Text style={[styles.label, { color: theme.muted }]}>Phone</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Phone"
            placeholderTextColor={theme.muted}
            keyboardType="phone-pad"
            value={billCustomer.phone}
            onChangeText={(phone) => setBillCustomer({ ...billCustomer, phone })}
          />
          <Text style={[styles.label, { color: theme.muted }]}>Email (for bill)</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Email"
            placeholderTextColor={theme.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            value={billCustomer.email}
            onChangeText={(email) => setBillCustomer({ ...billCustomer, email })}
          />
          <Text style={[styles.label, { color: theme.muted }]}>GSTIN (optional)</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Leave blank if no GST"
            placeholderTextColor={theme.muted}
            autoCapitalize="characters"
            value={billCustomer.gstin}
            onChangeText={(gstin) => setBillCustomer({ ...billCustomer, gstin: gstin.toUpperCase() })}
          />
          <Text style={{ marginTop: 6, fontSize: 11, color: theme.muted }}>
            {pickedCustomer
              ? "Saved client — their details are updated in the master with this bill."
              : "New client? Their details are saved into the customer master with this bill."}
          </Text>
        </View>

        {/* ---- Items ---- */}
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.cardTitle, { color: theme.muted, marginBottom: 10 }]}>ITEMS</Text>

          <Text style={[styles.label, { color: theme.muted }]}>Item</Text>
          <TouchableOpacity
            style={[styles.pickerBtn, { borderColor: theme.line, backgroundColor: theme.surface2 }]}
            onPress={() => {
              setItemQuery("");
              setItemPickerOpen(true);
            }}
          >
            <Text style={{ fontSize: 14, color: draftItem ? theme.ink : theme.muted }} numberOfLines={1}>
              {draftItem ? draftItem.name : "Choose an item…"}
            </Text>
            <Ionicons name="chevron-down" size={16} color={theme.muted} />
          </TouchableOpacity>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: theme.muted }]}>Qty ({draftItem?.unit ?? "unit"})</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="0"
                placeholderTextColor={theme.muted}
                keyboardType="decimal-pad"
                value={draft.qty}
                onChangeText={(qty) => setDraft({ ...draft, qty })}
              />
            </View>
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
          </View>

          <Text style={[styles.label, { color: theme.muted }]}>HSN</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="—"
            placeholderTextColor={theme.muted}
            value={draft.hsn}
            onChangeText={(hsn) => setDraft({ ...draft, hsn })}
          />

          {/* Avg cost → margin → suggested rate (web margin row). */}
          {draftItem && (draftItem.avgCostPaise ?? 0) > 0 && (
            <View style={[styles.marginRow, { backgroundColor: theme.surface2 }]}>
              <Text style={{ fontSize: 11, color: theme.muted, flex: 1 }}>
                Avg cost: <Text style={{ fontWeight: "700", color: theme.ink }}>{money(draftItem.avgCostPaise ?? 0)}</Text> / {draftItem.unit}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 11, color: theme.muted }}>Margin</Text>
                <TextInput
                  style={[styles.marginInput, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface }]}
                  keyboardType="decimal-pad"
                  value={billMargin}
                  onChangeText={setBillMargin}
                />
                <Text style={{ fontSize: 11, color: theme.muted }}>%</Text>
              </View>
              <Text style={{ fontSize: 11, color: theme.muted }}>
                Suggested: <Text style={{ fontWeight: "700", color: theme.ink }}>{money(suggestedPaise)}</Text>
              </Text>
              <TouchableOpacity
                style={[styles.miniBtn, { borderColor: theme.accent }]}
                onPress={() => setDraft({ ...draft, rate: (suggestedPaise / 100).toFixed(2) })}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.accentInk }}>Use suggested</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: theme.primary }]}
            onPress={addBillLine}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: theme.onPrimary }}>+ Add</Text>
          </TouchableOpacity>

          {/* Added lines (web ResponsiveTable). */}
          {billLines.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              {billLines.map((line, index) => (
                <View key={`${line.itemId}-${index}`} style={[styles.lineRow, { borderBottomColor: theme.line }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>
                      {line.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                      {line.qtyBase / (FACTOR[line.unit] ?? 1)} {line.unit} × {money(line.ratePaise)}
                      {line.hsn ? ` · HSN ${line.hsn}` : ""}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>{money(line.totalPaise)}</Text>
                  <TouchableOpacity
                    onPress={() => setBillLines(billLines.filter((_, i) => i !== index))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.errorInk }}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.emptyLines, { backgroundColor: theme.surface2 }]}>
              <Text style={{ fontSize: 13, color: theme.muted, textAlign: "center" }}>
                No items yet — pick an item, enter qty &amp; rate, then Add.
              </Text>
            </View>
          )}
        </View>

        {/* ---- Summary ---- */}
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.cardTitle, { color: theme.muted, marginBottom: 10 }]}>SUMMARY</Text>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: theme.muted }]}>Date</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.muted}
                value={billDate}
                onChangeText={setBillDate}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: theme.muted }]}>Payment</Text>
              <View style={styles.chipRow}>
                {PAYMENT_MODES.map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[
                      styles.chip,
                      billMode === mode
                        ? { backgroundColor: theme.primary, borderColor: theme.primary }
                        : { backgroundColor: theme.surface2, borderColor: theme.line },
                    ]}
                    onPress={() => setBillMode(mode)}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: billMode === mode ? theme.onPrimary : theme.ink }}>{mode}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <Text style={[styles.label, { color: theme.muted, marginTop: 8 }]}>GST rate</Text>
          <View style={styles.chipRow}>
            {GST_RATES.map((rate) => (
              <TouchableOpacity
                key={rate.value}
                style={[
                  styles.chip,
                  billGst === rate.value
                    ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                    : { backgroundColor: theme.surface2, borderColor: theme.line },
                ]}
                onPress={() => setBillGst(rate.value)}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: billGst === rate.value ? theme.accentInk : theme.ink }}>
                  {rate.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: theme.muted }]}>Discount ₹</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="0"
                placeholderTextColor={theme.muted}
                keyboardType="decimal-pad"
                value={billDiscount}
                onChangeText={setBillDiscount}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: theme.muted }]}>Delivery / sale expenses ₹</Text>
              <TextInput
                style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
                placeholder="0"
                placeholderTextColor={theme.muted}
                keyboardType="decimal-pad"
                value={billSaleExpenses}
                onChangeText={setBillSaleExpenses}
              />
            </View>
          </View>

          {/* Totals breakdown (web dl). */}
          <View style={[styles.breakdown, { borderTopColor: theme.line }]}>
            <View style={styles.totalRow}>
              <Text style={{ fontSize: 14, color: theme.muted }}>Subtotal</Text>
              <Text style={{ fontSize: 14, color: theme.ink }}>{money(billSubtotal)}</Text>
            </View>
            {Number(billGst || 0) > 0 && (
              <>
                <View style={styles.totalRow}>
                  <Text style={{ fontSize: 14, color: theme.muted }}>CGST ({gstRatePercent / 2}%)</Text>
                  <Text style={{ fontSize: 14, color: theme.ink }}>{money(cgstPaise)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={{ fontSize: 14, color: theme.muted }}>SGST ({gstRatePercent / 2}%)</Text>
                  <Text style={{ fontSize: 14, color: theme.ink }}>{money(sgstPaise)}</Text>
                </View>
              </>
            )}
            <View style={styles.totalRow}>
              <Text style={{ fontSize: 14, color: theme.muted }}>Discount (−)</Text>
              <Text style={{ fontSize: 14, color: theme.ink }}>− {money(discountPaise)}</Text>
            </View>
            {saleExpensesPaise > 0 && (
              <View style={styles.totalRow}>
                <Text style={{ fontSize: 14, color: theme.muted }}>Delivery (+)</Text>
                <Text style={{ fontSize: 14, color: theme.ink }}>+ {money(saleExpensesPaise)}</Text>
              </View>
            )}
          </View>
          <View style={[styles.totalRow, { borderTopColor: theme.line, borderTopWidth: 1, paddingTop: 10 }]}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: theme.muted, letterSpacing: 0.5 }}>TOTAL</Text>
            <Text style={{ fontSize: 22, fontWeight: "700", color: theme.ink }}>{money(billTotal)}</Text>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: billLines.length === 0 || saving ? theme.surface3 : theme.primary }]}
            onPress={() => void saveBill()}
            disabled={billLines.length === 0 || saving}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: billLines.length === 0 || saving ? theme.muted : theme.onPrimary }}>
              {saving ? "Saving…" : "Save bill"}
            </Text>
          </TouchableOpacity>
          {billLines.length === 0 && (
            <Text style={{ textAlign: "center", fontSize: 12, color: theme.muted, marginTop: 6 }}>
              Add at least one item to save.
            </Text>
          )}

          {billMsg && (
            <View style={[styles.msgBox, { backgroundColor: theme.surface2 }]}>
              <Text style={{ fontSize: 13, color: theme.ink, textAlign: "center" }}>{billMsg}</Text>
            </View>
          )}
          {lastBill && (
            <View style={[styles.resultCard, { backgroundColor: theme.successSoft }]}>
              <Text style={{ color: theme.successInk, fontWeight: "700" }}>Bill #{lastBill.billNo} created</Text>
              <Text style={{ color: theme.successInk, fontSize: 18, fontWeight: "700", marginTop: 4 }}>
                {money(lastBill.totalPaise)}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ---- Item picker (mobile stand-in for web's <select>) ---- */}
      <Modal visible={itemPickerOpen} transparent animationType="fade" onRequestClose={() => setItemPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setItemPickerOpen(false)}>
          <Pressable style={[styles.pickerSheet, { backgroundColor: theme.surface }]}>
            <View style={styles.cardTitleRow}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Choose an item</Text>
              <TouchableOpacity onPress={() => setItemPickerOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
            <FlatList
              data={itemMatches}
              keyExtractor={(item) => String(item.id)}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerRow, { borderBottomColor: theme.line }]}
                  onPress={() => {
                    setDraft({ ...draft, itemId: item.id, hsn: item.hsnCode ?? "" });
                    setItemPickerOpen(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted }}>
                      {item.unit}
                      {(item.stockLeftBase ?? 0) > 0 ? ` · ${item.stockLeftBase} in stock` : ""}
                    </Text>
                  </View>
                  {(item.avgCostPaise ?? 0) > 0 && (
                    <Text style={{ fontSize: 12, color: theme.muted }}>{money(item.avgCostPaise ?? 0)}</Text>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={{ textAlign: "center", color: theme.muted, padding: 16, fontSize: 13 }}>
                  No items match.
                </Text>
              }
            />
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
  matchRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  matchChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 180 },
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
  marginRow: {
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  marginInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, width: 44, fontSize: 12 },
  miniBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  addBtn: { borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 40, marginTop: 10 },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyLines: { borderRadius: 10, padding: 14, marginTop: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  breakdown: { borderTopWidth: 1, marginTop: 12, paddingTop: 10, gap: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 46, marginTop: 12 },
  msgBox: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  resultCard: { borderRadius: 14, padding: 16, marginTop: 12, alignItems: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 24 },
  pickerSheet: { borderRadius: 16, padding: 14 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
