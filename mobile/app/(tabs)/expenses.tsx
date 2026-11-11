/**
 * Expenses screen — web parity.
 *
 * Add-expense form (date / type / category / amount / paid to / note), the
 * recent-expenses list with the month total, and owner Edit / Delete.
 * The list shows the real ExpenseRow fields (the old screen read
 * `title`/`status`, which the API never returns — rows rendered blank).
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
  Alert,
} from "react-native";

import { api, type ExpenseRow } from "../../lib/api";
import { useAuth } from "../_layout";

const EXPENSE_TYPES: readonly ["general", "purchase", "sale"] = ["general", "purchase", "sale"];
/** Web's datalist options for the category field. */
const CATEGORIES = ["Rent", "Tea", "Transport", "Salary", "Electricity", "Other"] as const;

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-11-10" → "10 Nov 2026" (web formatDate, local-safe). */
function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

/** The form fields (web `expense` state). */
type Draft = { date: string; type: "general" | "purchase" | "sale"; category: string; amount: string; paidTo: string; note: string };

const EMPTY_DRAFT: Draft = { date: todayIso(), type: "general", category: "", amount: "", paidTo: "", note: "" };

export default function ExpensesScreen() {
  const { theme, user } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Owner edit (web openExpenseEdit / saveExpenseEdit). */
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  const load = useCallback(async () => {
    try {
      const { expenses: data } = await api.expenses();
      setExpenses(data);
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

  /** Web monthExpensesPaise — the list's own month prefix. */
  const monthTotalPaise = useMemo(() => {
    const prefix = new Date().toISOString().slice(0, 7);
    return expenses.filter((x) => x.date.slice(0, 7) === prefix).reduce((sum, x) => sum + x.amountPaise, 0);
  }, [expenses]);

  function validate(d: Draft): string | null {
    if (!d.category.trim()) return "Category is required";
    const rupees = Number(d.amount);
    if (!Number.isFinite(rupees) || rupees <= 0) return "Enter the amount in ₹";
    return null;
  }

  /** Web addExpenseNow. */
  async function saveExpense() {
    const problem = validate(draft);
    if (problem || saving) {
      if (problem) setMessage(problem);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.addExpense({
        category: draft.category.trim(),
        expenseType: draft.type,
        amountPaise: Math.round(Number(draft.amount) * 100),
        date: draft.date || todayIso(),
        paymentMode: "Cash",
        paidTo: draft.paidTo.trim() || undefined,
        note: draft.note.trim() || undefined,
      });
      setMessage("Expense saved");
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: ExpenseRow) {
    setEditing(row);
    setMessage(null);
    setEditDraft({
      date: row.date,
      type: row.expenseType,
      category: row.category,
      amount: String(row.amountPaise / 100),
      paidTo: row.paidTo ?? "",
      note: row.note ?? "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const problem = validate(editDraft);
    if (problem) {
      setMessage(problem);
      return;
    }
    setSaving(true);
    try {
      await api.updateExpense(editing.id, {
        category: editDraft.category.trim(),
        expenseType: editDraft.type,
        amountPaise: Math.round(Number(editDraft.amount) * 100),
        date: editDraft.date || todayIso(),
        paymentMode: "Cash",
        paidTo: editDraft.paidTo.trim() || undefined,
        note: editDraft.note.trim() || undefined,
      });
      setEditing(null);
      setMessage("Expense updated");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function deleteRow(row: ExpenseRow) {
    Alert.alert(
      "Delete expense?",
      `${row.category} — ${money(row.amountPaise)}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void api
              .deleteExpense(row.id)
              .then(() => {
                setMessage("Expense deleted");
                return load();
              })
              .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
          },
        },
      ],
    );
  }

  /** The shared form fields (add + edit use the same layout). */
  function renderForm(d: Draft, setD: (next: Draft) => void) {
    return (
      <>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.muted }]}>Date</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.muted}
              value={d.date}
              onChangeText={(date) => setD({ ...d, date })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.muted }]}>Type</Text>
            <View style={styles.chipRow}>
              {EXPENSE_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.chip,
                    d.type === type
                      ? { backgroundColor: theme.primary, borderColor: theme.primary }
                      : { backgroundColor: theme.surface2, borderColor: theme.line },
                  ]}
                  onPress={() => setD({ ...d, type })}
                >
                  <Text style={{ fontSize: 11, fontWeight: "600", color: d.type === type ? theme.onPrimary : theme.ink }}>
                    {type === "general" ? "General" : type === "purchase" ? "Purchase" : "Sale"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Category</Text>
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="Choose or type"
          placeholderTextColor={theme.muted}
          value={d.category}
          onChangeText={(category) => setD({ ...d, category })}
        />
        <View style={styles.chipRow}>
          {CATEGORIES.map((category) => (
            <TouchableOpacity
              key={category}
              style={[
                styles.chip,
                d.category === category
                  ? { backgroundColor: theme.accentSoft, borderColor: theme.accent }
                  : { backgroundColor: theme.surface2, borderColor: theme.line },
              ]}
              onPress={() => setD({ ...d, category })}
            >
              <Text style={{ fontSize: 11, fontWeight: "600", color: d.category === category ? theme.accentInk : theme.ink }}>
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Amount ₹</Text>
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="0"
          placeholderTextColor={theme.muted}
          keyboardType="decimal-pad"
          value={d.amount}
          onChangeText={(amount) => setD({ ...d, amount })}
        />

        <Text style={[styles.label, { color: theme.muted }]}>Paid to</Text>
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="Who was paid"
          placeholderTextColor={theme.muted}
          value={d.paidTo}
          onChangeText={(paidTo) => setD({ ...d, paidTo })}
        />

        <Text style={[styles.label, { color: theme.muted }]}>Note</Text>
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="Optional"
          placeholderTextColor={theme.muted}
          value={d.note}
          onChangeText={(note) => setD({ ...d, note })}
        />
      </>
    );
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
          <Text style={[styles.heading, { color: theme.ink }]}>Expenses</Text>
        </View>

        {/* ---- Add expense (web top card) ---- */}
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: theme.muted }]}>ADD EXPENSE</Text>
            <TouchableOpacity
              style={[styles.miniBtn, { borderColor: theme.line }]}
              onPress={() => {
                setFormOpen((open) => !open);
                setMessage(null);
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.ink }}>{formOpen ? "Close" : "Add"}</Text>
            </TouchableOpacity>
          </View>
          {formOpen && (
            <>
              {renderForm(draft, setDraft)}
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: saving ? theme.surface3 : theme.primary }]}
                disabled={saving}
                onPress={() => void saveExpense()}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: saving ? theme.muted : theme.onPrimary }}>
                  {saving ? "Saving…" : "Add expense"}
                </Text>
              </TouchableOpacity>
            </>
          )}
          {message && !editing && (
            <Text style={{ marginTop: 8, fontSize: 13, color: theme.muted, textAlign: "center" }}>{message}</Text>
          )}
        </View>

        {/* ---- Owner edit card (web openExpenseEdit) ---- */}
        {editing && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: theme.accentInk }]}>EDIT EXPENSE</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditing(null);
                  setMessage(null);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.muted }}>Cancel</Text>
              </TouchableOpacity>
            </View>
            {renderForm(editDraft, setEditDraft)}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: saving ? theme.surface3 : theme.primary }]}
              disabled={saving}
              onPress={() => void saveEdit()}
            >
              <Text style={{ fontSize: 14, fontWeight: "700", color: saving ? theme.muted : theme.onPrimary }}>
                {saving ? "Saving…" : "Save changes"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ---- Recent expenses (web ResponsiveTable) ---- */}
        <View style={styles.listHead}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Recent expenses</Text>
          <Text style={{ fontSize: 12, color: theme.muted }}>
            This month: <Text style={{ fontWeight: "700", color: theme.ink }}>{money(monthTotalPaise)}</Text>
          </Text>
        </View>

        {expenses.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface2 }]}>
            <Text style={{ color: theme.muted, textAlign: "center", fontSize: 13 }}>
              No expenses yet.{"\n"}Add your first one above.
            </Text>
          </View>
        ) : (
          expenses.map((row) => (
            <View key={row.id} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: theme.ink, flex: 1 }}>
                    {row.category}
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>{money(row.amountPaise)}</Text>
                </View>
                <Text numberOfLines={1} style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                  {formatDate(row.date)}
                  {row.paidTo ? ` · Paid to ${row.paidTo}` : ""}
                  {row.note ? ` · ${row.note}` : ""}
                  {row.expenseType !== "general" ? ` · ${row.expenseType}` : ""}
                </Text>
              </View>
              {user?.role === "owner" && (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={() => openEdit(row)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.primary }}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteRow(row)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.errorInk }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  miniBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 12 },
  listHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { borderRadius: 12, padding: 24, alignItems: "center", marginHorizontal: 12, marginTop: 4 },
});
