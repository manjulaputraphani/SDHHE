/**
 * Dashboard — mobile parity with the web Dashboard (web/src/App.tsx, `view === "dashboard"`).
 *
 * Same sections, same order as the web app:
 *   1. Ask AI
 *   2. Stat cards (today, month, profit, expenses, credit, low stock)
 *   3. Working capital & rotation (+ 30-day trend)
 *   4. Low stock items (toggled from the card)
 *   5. Quick expense
 *   6. Last 14 days (sales vs expenses)
 *   7. Expenses by category (month)
 *   8. Recent activity
 *
 * Endpoints: /api/stats, /api/rotation, /api/stats/daily,
 *            /api/stats/expense-categories, /api/activity, /api/items,
 *            /api/ai/chat, POST /api/expenses
 */
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  api,
  type ActivityRow,
  type AiTurn,
  type ItemRow,
  type RotationSummary,
  type Stats,
} from "../../lib/api";
import { useAuth } from "../_layout";

const QTY_FACTORS: Record<string, number> = { kg: 1000, l: 1000, "60 kg bag": 60_000 };
const ACTIVITY_ROWS = 4; // same as the web DASHBOARD_ACTIVITY_ROWS

function money(paise: number | string | null | undefined): string {
  const n = Number(paise ?? 0);
  if (!Number.isFinite(n)) return "₹0.00";
  return `₹${(n / 100).toFixed(2)}`;
}

/** Base units → display units (same rules as the web `qty()`). */
function qty(base: number, unit: string): string {
  const factor = QTY_FACTORS[unit] ?? 1;
  return factor === 1 ? `${Math.round(base)} ${unit}` : `${(base / factor).toFixed(2)} ${unit}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tone = { bg: string; fg: string };

export default function HomeScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();

  const [stats, setStats] = useState<Stats | null>(null);
  const [rotation, setRotation] = useState<RotationSummary | null>(null);
  const [daily, setDaily] = useState<{ date: string; sales: string; expenses: string }[]>([]);
  const [categories, setCategories] = useState<{ category: string; total: string }[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [lowItems, setLowItems] = useState<ItemRow[]>([]);
  const [lowOpen, setLowOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [aiMessages, setAiMessages] = useState<AiTurn[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const [expenseCat, setExpenseCat] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseMsg, setExpenseMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [st, rot, day, cat, act, items] = await Promise.allSettled([
        api.stats(),
        api.rotation(),
        api.statsDaily(14),
        api.expenseCategories(),
        api.activity(ACTIVITY_ROWS),
        api.items(),
      ]);

      if (st.status === "fulfilled") setStats(st.value.stats);
      if (rot.status === "fulfilled") setRotation(rot.value.rotation);
      if (day.status === "fulfilled") setDaily(day.value.daily);
      if (cat.status === "fulfilled") setCategories(cat.value.categories);
      if (act.status === "fulfilled") setActivity(act.value.activity);
      if (items.status === "fulfilled") {
        const low = items.value.items.filter(
          (i) => (i.stockLeftBase ?? 0) <= (i.minStockBase ?? 0),
        );
        setLowItems(low);
      }

      const failed = [st, rot, day, cat, act, items].filter((r) => r.status === "rejected");
      setLoadError(failed.length === 6 ? "Couldn't load the dashboard — pull to retry." : null);
    } catch {
      setLoadError("Couldn't load the dashboard — pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  async function askAi() {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiInput("");
    const history = aiMessages.slice(-10);
    setAiMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const res = await api.aiChat(text, history);
      setAiMessages((m) => [...m, { role: "assistant", content: res.answer }]);
    } catch (err) {
      setAiMessages((m) => [
        ...m,
        { role: "assistant", content: err instanceof Error ? err.message : String(err) },
      ]);
    } finally {
      setAiBusy(false);
    }
  }

  async function addExpenseNow() {
    if (expenseSaving) return;
    const amountPaise = Math.round(Number(expenseAmount) * 100);
    if (!expenseCat.trim() || !Number.isFinite(amountPaise) || amountPaise <= 0) {
      setExpenseMsg("Enter a category and an amount above ₹0.");
      return;
    }
    setExpenseSaving(true);
    setExpenseMsg(null);
    try {
      await api.addExpense({
        category: expenseCat.trim(),
        expenseType: "general",
        amountPaise,
        date: todayIso(),
        paymentMode: "Cash",
      });
      setExpenseCat("");
      setExpenseAmount("");
      setExpenseMsg("Added ✓");
      void load();
    } catch (err) {
      setExpenseMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExpenseSaving(false);
    }
  }

  const canCreateExpense =
    user?.role === "owner" || Boolean(user?.permissions?.expenses?.canCreate);

  const lowStockCount = stats?.low_stock ?? 0;
  const unpaidBills = stats?.credit_bills ?? 0;

  const surface = { backgroundColor: theme.surface, shadowColor: theme.shadow };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* ---- header ---- */}
        <View style={styles.header}>
          <Text style={[styles.shop, { color: theme.ink }]}>SDHHE</Text>
          <Text style={[styles.name, { color: theme.muted }]}>{user?.name}</Text>
        </View>

        <View style={styles.titleRow}>
          <View style={[styles.titleDot, { backgroundColor: theme.accent }]} />
          <View>
            <Text style={[styles.title, { color: theme.ink }]}>Dashboard</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>
              Sales, stock, expenses and money in rotation — live.
            </Text>
          </View>
        </View>

        {loadError ? (
          <View style={[styles.card, surface]}>
            <Text style={{ color: theme.errorInk, fontSize: 13 }}>{loadError}</Text>
          </View>
        ) : null}

        {/* ---- 1. Ask AI ---- */}
        <View style={[styles.card, surface]}>
          <Text style={[styles.cardTitle, { color: theme.ink }]}>Ask AI</Text>
          <View style={styles.aiBox}>
            {aiMessages.length === 0 ? (
              <Text style={[styles.muted, { color: theme.muted }]}>
                Ask anything read-only about your shop — sales, stock, expenses.
              </Text>
            ) : (
              aiMessages.map((m, i) => (
                <View
                  key={`${m.role}-${i}`}
                  style={[
                    styles.aiBubble,
                    {
                      backgroundColor: m.role === "user" ? theme.surface2 : theme.surface3,
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    },
                  ]}
                >
                  <Text style={{ color: theme.ink, fontSize: 13 }}>{m.content}</Text>
                </View>
              ))
            )}
            {aiBusy ? (
              <View style={[styles.aiBubble, { backgroundColor: theme.surface3, alignSelf: "flex-start" }]}>
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  Thinking… (reading your data — can take up to a minute)
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.row}>
            <TextInput
              style={[
                styles.input,
                { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2, flex: 1 },
              ]}
              placeholder="e.g. total sales this month?"
              placeholderTextColor={theme.muted}
              value={aiInput}
              onChangeText={setAiInput}
              onSubmitEditing={() => void askAi()}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: aiBusy ? theme.muted : theme.primary }]}
              onPress={() => void askAi()}
              disabled={aiBusy}
            >
              <Text style={{ color: theme.onPrimary, fontWeight: "600", fontSize: 14 }}>
                {aiBusy ? "Asking…" : "Ask"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ---- 2. stat cards ---- */}
        <View style={styles.grid}>
          <StatCard
            theme={theme}
            label="Today's sales"
            value={money(stats?.today_sales)}
            icon="cash"
            tone={{ bg: theme.accentSoft, fg: theme.accentInk }}
          />
          <StatCard
            theme={theme}
            label="This month"
            value={money(stats?.month_sales)}
            icon="bar-chart"
            tone={{ bg: theme.surface3, fg: theme.secondaryInk }}
          />
          <StatCard
            theme={theme}
            label="Month profit"
            value={money(stats?.month_profit)}
            icon="trending-up"
            tone={{ bg: theme.successSoft, fg: theme.successInk }}
          />
          <StatCard
            theme={theme}
            label="Month expenses"
            value={money(stats?.month_expenses)}
            icon="wallet"
            tone={{ bg: theme.errorSoft, fg: theme.errorInk }}
          />
          <StatCard
            theme={theme}
            label="Credit given"
            value={money(stats?.credit_paise)}
            hint={`${unpaidBills} unpaid bills`}
            icon="receipt"
            tone={{ bg: theme.accentSoft, fg: theme.accentInk }}
          />
          <StatCard
            theme={theme}
            label="Low stock items"
            value={String(lowStockCount)}
            hint={lowStockCount > 0 ? "View items" : "All good"}
            icon="cube"
            tone={
              lowStockCount > 0
                ? { bg: theme.primary, fg: theme.onPrimary }
                : { bg: theme.surface3, fg: theme.muted }
            }
            highlight={lowStockCount > 0}
            active={lowOpen}
            onPress={() => setLowOpen((v) => !v)}
          />
        </View>

        {/* ---- 3. working capital & rotation ---- */}
        {rotation ? (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: theme.ink }]}>
              Working capital &amp; rotation
            </Text>
            <Text style={[styles.sectionSub, { color: theme.muted }]}>
              This month to date · as of {rotation.asOfDate}
            </Text>
            <View style={styles.grid}>
              <StatCard
                theme={theme}
                label="Amount in rotation"
                value={money(rotation.amountInRotationPaise)}
                hint={`Stock ${money(rotation.stockValuePaise)} · Cash ${money(rotation.cashInBankPaise)} · Credit ${money(rotation.creditOutstandingPaise)}`}
                icon="refresh"
                tone={{ bg: theme.accentSoft, fg: theme.accentInk }}
                wide
              />
              <StatCard
                theme={theme}
                label="Rotation this month"
                value={`${rotation.rotationTimes.toFixed(2)}×`}
                hint={
                  rotation.daysToRotate === null
                    ? "No sales yet"
                    : `${rotation.daysToRotate.toFixed(1)} days to rotate`
                }
                icon="refresh"
                tone={{ bg: theme.surface3, fg: theme.secondaryInk }}
              />
              <StatCard
                theme={theme}
                label="Inventory turnover"
                value={`${rotation.inventoryTurnover.toFixed(2)}×`}
                hint="COGS ÷ stock value"
                icon="cube"
                tone={{ bg: theme.surface3, fg: theme.primary }}
              />
              <StatCard
                theme={theme}
                label="Net profit (after expenses)"
                value={money(rotation.netProfitPaise)}
                hint={`Gross ${money(rotation.grossProfitPaise)} − expenses ${money(rotation.expensesPaise)}`}
                icon="trending-up"
                tone={{ bg: theme.successSoft, fg: theme.successInk }}
                negative={rotation.netProfitPaise < 0}
                wide
              />
              <StatCard
                theme={theme}
                label="Stock value"
                value={money(rotation.stockValuePaise)}
                hint="At batch cost"
                icon="pricetag"
                tone={{ bg: theme.surface3, fg: theme.primary }}
              />
              <StatCard
                theme={theme}
                label="Cash in bank"
                value={money(rotation.cashInBankPaise)}
                hint="From the cash ledger"
                icon="business"
                tone={{ bg: theme.accentSoft, fg: theme.accentInk }}
              />
            </View>

            {rotation.trend.length > 0 ? (
              <View style={[styles.card, surface]}>
                <Text style={[styles.cardTitle, { color: theme.ink }]}>
                  Rotation trend (net sales, last 30 days)
                </Text>
                <BarChart
                  theme={theme}
                  values={rotation.trend.map((t) => Number(t.netSalesPaise))}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ---- 4. low stock list ---- */}
        {lowOpen ? (
          <View style={[styles.card, surface]}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.cardTitle, { color: theme.ink }]}>Low stock items</Text>
              <TouchableOpacity onPress={() => setLowOpen(false)}>
                <Text style={{ color: theme.accentInk, fontSize: 13, fontWeight: "600" }}>Close</Text>
              </TouchableOpacity>
            </View>
            {lowItems.length === 0 ? (
              <Text style={[styles.muted, { color: theme.muted }]}>
                All items are above their minimum stock.
              </Text>
            ) : (
              lowItems.map((item) => (
                <View key={item.id} style={[styles.listRow, { borderColor: theme.line }]}>
                  <Text style={{ color: theme.ink, fontSize: 14, flex: 1 }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={{ color: theme.accentInk, fontSize: 13, fontWeight: "600" }}>
                    {qty(item.stockLeftBase ?? 0, item.unit)}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 13, marginLeft: 12 }}>
                    min {qty(item.minStockBase ?? 0, item.unit)}
                  </Text>
                </View>
              ))
            )}
            <TouchableOpacity
              style={[styles.ghostBtn, { borderColor: theme.line }]}
              onPress={() => router.push("/items")}
            >
              <Text style={{ color: theme.primary, fontSize: 13, fontWeight: "600" }}>
                Open Items →
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ---- 5. quick expense ---- */}
        {canCreateExpense ? (
          <View style={[styles.card, surface]}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.cardTitle, { color: theme.ink }]}>Quick expense</Text>
              <TouchableOpacity onPress={() => router.push("/expenses")}>
                <Text style={{ color: theme.accentInk, fontSize: 13, fontWeight: "600" }}>
                  Full form →
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TextInput
                style={[
                  styles.input,
                  { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2, flex: 2 },
                ]}
                placeholder="Category (e.g. Rent, Tea)"
                placeholderTextColor={theme.muted}
                value={expenseCat}
                onChangeText={setExpenseCat}
              />
              <TextInput
                style={[
                  styles.input,
                  { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2, flex: 1 },
                ]}
                placeholder="Amount ₹"
                placeholderTextColor={theme.muted}
                keyboardType="numeric"
                value={expenseAmount}
                onChangeText={setExpenseAmount}
                onSubmitEditing={() => void addExpenseNow()}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: expenseSaving ? theme.muted : theme.primary }]}
                onPress={() => void addExpenseNow()}
                disabled={expenseSaving}
              >
                <Ionicons name="add" size={16} color={theme.onPrimary} />
                <Text style={{ color: theme.onPrimary, fontWeight: "600", fontSize: 14 }}>
                  {expenseSaving ? "Adding…" : "Add"}
                </Text>
              </TouchableOpacity>
            </View>
            {expenseMsg ? (
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 8 }} role="status">
                {expenseMsg}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* ---- 6. last 14 days ---- */}
        <View style={[styles.card, surface]}>
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={[styles.cardTitle, { color: theme.ink }]}>Last 14 days</Text>
            <View style={styles.row}>
              <Legend color={theme.accent} label="Sales" theme={theme} />
              <Legend color={theme.secondary} label="Expenses" theme={theme} />
            </View>
          </View>
          {daily.length === 0 ? (
            <Text style={[styles.muted, { color: theme.muted }]}>No data yet.</Text>
          ) : (
            <>
              <View style={styles.chart}>
                {daily.map((d) => {
                  const sales = Number(d.sales) || 0;
                  const expenses = Number(d.expenses) || 0;
                  return (
                    <View key={d.date} style={styles.chartDay}>
                      <View style={styles.chartBars}>
                        <View
                          style={{
                            width: 7,
                            borderRadius: 4,
                            backgroundColor: theme.accent,
                            height: barHeight(sales, dailyMax(daily, "sales")),
                          }}
                        />
                        <View
                          style={{
                            width: 7,
                            borderRadius: 4,
                            backgroundColor: theme.secondary,
                            height: barHeight(expenses, dailyMax(daily, "expenses")),
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
              <Text style={[styles.caption, { color: theme.muted }]}>
                {daily[0]?.date} → {daily[daily.length - 1]?.date}
              </Text>
            </>
          )}
        </View>

        {/* ---- 7. expenses by category ---- */}
        <View style={[styles.card, surface]}>
          <Text style={[styles.cardTitle, { color: theme.ink }]}>Expenses by category (month)</Text>
          {categories.length === 0 ? (
            <Text style={[styles.muted, { color: theme.muted }]}>
              No expenses this month — add rent, transport or any other cost to see the split.
            </Text>
          ) : (
            categories.map((c) => {
              const value = Number(c.total) || 0;
              const max = Math.max(...categories.map((x) => Number(x.total) || 0), 1);
              const pct = Math.max(4, Math.round((value / max) * 100));
              return (
                <View key={c.category ?? "—"} style={{ marginBottom: 10 }}>
                  <View style={[styles.row, { justifyContent: "space-between" }]}>
                    <Text style={{ color: theme.ink, fontSize: 13 }} numberOfLines={1}>
                      {c.category ?? "Uncategorised"}
                    </Text>
                    <Text style={{ color: theme.ink, fontSize: 13, fontWeight: "600" }}>
                      {money(value)}
                    </Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: theme.surface3 }]}>
                    <View
                      style={{
                        width: `${pct}%`,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: theme.accent,
                      }}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ---- 8. recent activity ---- */}
        <View style={[styles.card, surface]}>
          <Text style={[styles.cardTitle, { color: theme.ink }]}>Recent activity</Text>
          {activity.length === 0 ? (
            <Text style={[styles.muted, { color: theme.muted }]}>Nothing yet.</Text>
          ) : (
            activity.map((row) => (
              <View key={row.id} style={[styles.listRow, { borderColor: theme.line }]}>
                <Text style={{ color: theme.ink, fontSize: 13, flex: 1 }} numberOfLines={2}>
                  {row.summary}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12, marginLeft: 8 }}>
                  {row.actor} · {relativeTime(row.at)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Largest value in a daily column — used to scale the bars. */
function dailyMax(daily: { sales: string; expenses: string }[], key: "sales" | "expenses"): number {
  return Math.max(...daily.map((d) => Number(d[key]) || 0), 1);
}

function barHeight(value: number, max: number): number {
  if (value <= 0) return 2;
  return Math.max(3, Math.round((value / max) * 104));
}

function Legend({ color, label, theme }: { color: string; label: string; theme: { muted: string } }) {
  return (
    <View style={styles.row}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: theme.muted, fontSize: 12, marginLeft: 4 }}>{label}</Text>
    </View>
  );
}

/** Simple column chart (no chart library — bars drawn with Views). */
function BarChart({
  theme,
  values,
}: {
  theme: { accent: string; muted: string; surface3: string };
  values: number[];
}) {
  const max = Math.max(...values, 1);
  return (
    <View style={styles.chart}>
      {values.map((v, i) => (
        <View key={`${i}-${v}`} style={styles.chartDay}>
          <View style={styles.chartBars}>
            <View
              style={{
                width: 7,
                borderRadius: 4,
                backgroundColor: theme.accent,
                height: v <= 0 ? 2 : Math.max(3, Math.round((v / max) * 104)),
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function StatCard({
  theme,
  label,
  value,
  hint,
  icon,
  tone,
  onPress,
  active,
  highlight,
  negative,
  wide,
}: {
  theme: {
    surface: string;
    surface2: string;
    accentSoft: string;
    line: string;
    ink: string;
    muted: string;
    accentInk: string;
    shadow: string;
  };
  label: string;
  value: string;
  hint?: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  tone: Tone;
  onPress?: () => void;
  active?: boolean;
  highlight?: boolean;
  negative?: boolean;
  wide?: boolean;
}) {
  const cardStyle = [
    styles.card,
    styles.statCard,
    {
      backgroundColor: highlight ? theme.accentSoft : theme.surface,
      shadowColor: theme.shadow,
      borderColor: active ? theme.accentInk : "transparent",
      borderWidth: active ? 1 : 0,
      flexBasis: wide ? "100%" : "48%",
    },
  ];

  const body = (
    <>
      <View style={styles.statHead}>
        <Text style={[styles.statLabel, { color: theme.muted }]} numberOfLines={1}>
          {label}
        </Text>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tone.bg,
          }}
        >
          <Ionicons name={icon} size={16} color={tone.fg} />
        </View>
      </View>
      <Text
        style={[styles.statValue, { color: negative ? theme.accentInk : theme.ink }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {hint ? (
        <Text style={[styles.statHint, { color: theme.muted }]} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={cardStyle}>
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={cardStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingTop: 48, paddingBottom: 40, gap: 12 },
  header: { marginBottom: 4 },
  shop: { fontSize: 20, fontWeight: "700", letterSpacing: 1.6 },
  name: { fontSize: 12, marginTop: 2 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  titleDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 2 },
  card: {
    borderRadius: 14,
    padding: 14,
    elevation: 2,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitle: { fontSize: 15, fontWeight: "600", marginBottom: 10 },
  block: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  sectionSub: { fontSize: 12, marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { flexGrow: 0, flexShrink: 1, minWidth: 0 },
  statHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    flex: 1,
  },
  statValue: { fontSize: 21, fontWeight: "700", marginTop: 8, letterSpacing: -0.4 },
  statHint: { fontSize: 11, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
  },
  ghostBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    marginTop: 10,
  },
  aiBox: { gap: 8, marginBottom: 10 },
  aiBubble: { maxWidth: "88%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  muted: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 11, marginTop: 8 },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 116,
    gap: 4,
  },
  chartDay: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  chartBars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: "100%" },
  track: { height: 8, borderRadius: 4, marginTop: 6, overflow: "hidden" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
