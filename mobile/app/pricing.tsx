/**
 * Green Coffee Pricing Calculator — Android (Expo) screen.
 *
 * The formulas are NOT written here. Every number comes from the shared,
 * pure `calculatePricing()` in src/logic/pricing.ts — the exact module the web
 * app and the Cloudflare Worker use, with the same unit tests.
 *
 * Field-sales behaviour:
 *   - live results as the member types (numeric keypad, 48px targets),
 *   - last-used inputs remembered on the device,
 *   - saved quotes are queued locally and synced when the phone is online,
 *   - "Share quote" opens the Android share sheet with a plain-text quote that
 *     never contains landed cost, margin or the roaster ceiling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ScrollViewInstance,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Network from "expo-network";
import { Picker } from "@react-native-picker/picker";

import {
  DEFAULT_PRICING_INPUTS,
  calculatePricing,
  formatPricingMoney,
  validatePricingInputs,
  type PricingInputs,
  type PricingTier,
  type PricingTierKey,
} from "../../src/logic/pricing";
import { api } from "../lib/api";
import {
  enqueuePricingQuote,
  isNetworkError,
  loadPricingDraft,
  loadSavedPricingQuotes,
  mergeServerPricingQuotes,
  savePricingDraft,
  syncPendingPricingQuotes,
  type SavedPricingQuote,
} from "../lib/pricingStore";
import { useAuth } from "./_layout";

const GRADE_OPTIONS = [
  "Robusta Cherry",
  "Robusta Parchment",
  "Arabica Plantation",
  "Arabica Cherry",
  "Arabica Robusta Blend",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type FormState = Record<keyof PricingInputs, string>;
type Tab = "calculator" | "history";
type NoticeKind = "ok" | "error" | "info";
type Notice = { text: string; kind: NoticeKind };

type FieldDef = { key: keyof PricingInputs; label: string; suffix: string };

const COST_FIELDS: FieldDef[] = [
  { key: "purchasePrice", label: "Purchase price", suffix: "₹ / kg" },
  { key: "transport", label: "Transport", suffix: "₹ / kg" },
  { key: "handling", label: "Bags, handling, storage", suffix: "₹ / kg" },
  { key: "weightLossPct", label: "Weight loss", suffix: "% moisture, sorting" },
  { key: "creditDays", label: "Credit given to buyer", suffix: "days" },
  { key: "interestPct", label: "Yearly interest on our money", suffix: "%" },
];

const MARGIN_FIELDS: FieldDef[] = [
  { key: "bulkMarginPct", label: "Bulk buyer margin", suffix: "%" },
  { key: "bulkKgPerMonth", label: "Bulk buyer quantity", suffix: "kg / month" },
  { key: "regularMarginPct", label: "Regular buyer margin", suffix: "%" },
  { key: "regularKgPerMonth", label: "Regular buyer quantity", suffix: "kg / month" },
  { key: "smallMarginPct", label: "Small buyer margin", suffix: "%" },
  { key: "smallKgPerMonth", label: "Small buyer quantity", suffix: "kg / month" },
];

const ROASTER_FIELDS: FieldDef[] = [
  { key: "powderPrice", label: "Roaster's powder selling price", suffix: "₹ / kg" },
  { key: "yieldPct", label: "Powder yield from green beans", suffix: "%" },
  { key: "processingCost", label: "Roasting, grinding, packing", suffix: "₹ / kg" },
  { key: "roasterProfitPct", label: "Roaster's profit", suffix: "%" },
];

/** Field text → typed inputs (blank = NaN, so validation explains it). */
function toForm(inputs: PricingInputs): FormState {
  const form = {} as FormState;
  for (const key of Object.keys(DEFAULT_PRICING_INPUTS) as (keyof PricingInputs)[]) {
    form[key] = String(inputs[key]);
  }
  return form;
}

function parseForm(form: FormState): PricingInputs {
  const inputs = {} as PricingInputs;
  for (const key of Object.keys(DEFAULT_PRICING_INPUTS) as (keyof PricingInputs)[]) {
    const raw = form[key].trim();
    inputs[key] = raw === "" ? Number.NaN : Number(raw);
  }
  return inputs;
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hours = date.getHours();
  const hour = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(value.slice(0, 10))} · ${hour}:${minutes} ${hours >= 12 ? "PM" : "AM"}`;
}

/** Today + N days, in the shop's local calendar (not UTC). */
function datePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Indian grouping without the rupee sign — "1,500" kg. */
function formatKg(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return formatPricingMoney(rounded, Number.isInteger(rounded) ? 0 : 2).replace("₹", "");
}

function tierLabel(tier: PricingTier): string {
  return tier.label.replace(" buyer", "");
}

export default function PricingScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const syncInFlight = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tab, setTab] = useState<Tab>("calculator");
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULT_PRICING_INPUTS));
  const [grade, setGrade] = useState(GRADE_OPTIONS[0]);
  const [note, setNote] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [openSections, setOpenSections] = useState({ cost: true, margins: true, roaster: false });
  const [quotes, setQuotes] = useState<SavedPricingQuote[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [latestBusy, setLatestBusy] = useState(false);
  const [latestMessage, setLatestMessage] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareTierKey, setShareTierKey] = useState<PricingTierKey>("regular");
  const [shareMinOrder, setShareMinOrder] = useState("");

  const inputs = useMemo(() => parseForm(form), [form]);
  const errors = useMemo(() => validatePricingInputs(inputs), [inputs]);
  const errorCount = Object.keys(errors).length;
  const result = useMemo(() => {
    if (errorCount > 0) return null;
    try {
      return calculatePricing(inputs);
    } catch {
      return null;
    }
  }, [inputs, errorCount]);

  const pendingCount = quotes.filter((quote) => quote.status === "pending").length;

  const canCreate = useMemo(() => {
    if (user?.role === "owner") return true;
    const permissions = user?.permissions as
      | Record<string, { create?: boolean } | undefined>
      | undefined;
    return Boolean(permissions?.pricing?.create);
  }, [user]);

  const gradeChoices = useMemo(() => {
    const saved = quotes.map((quote) => quote.grade);
    return [...new Set([...GRADE_OPTIONS, grade, ...saved].filter(Boolean))];
  }, [quotes, grade]);

  const showNotice = useCallback((text: string, kind: NoticeKind = "info") => {
    setNotice({ text, kind });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // ---- Hydrate last-used inputs + local queue -------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await loadPricingDraft();
      if (!cancelled && draft) {
        const restored = toForm(DEFAULT_PRICING_INPUTS);
        for (const key of Object.keys(restored) as (keyof PricingInputs)[]) {
          const value = draft.form[key];
          if (typeof value === "string") restored[key] = value;
        }
        setForm(restored);
        setGrade(draft.grade || GRADE_OPTIONS[0]);
        setNote(draft.note);
      }
      const saved = await loadSavedPricingQuotes();
      if (!cancelled) {
        setQuotes(saved);
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Remember the current form on this device (raw text, so blanks survive).
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void savePricingDraft({ form, grade, note });
    }, 350);
    return () => clearTimeout(timer);
  }, [hydrated, form, grade, note]);

  const refreshLocal = useCallback(async () => {
    const saved = await loadSavedPricingQuotes();
    setQuotes(saved);
  }, []);

  const fetchServerHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { calculations } = await api.pricingCalculations();
      const merged = await mergeServerPricingQuotes(calculations);
      setQuotes(merged);
    } catch (err) {
      if (isNetworkError(err)) {
        setOnline(false);
      } else {
        setHistoryError(err instanceof Error ? err.message : "Could not load saved calculations");
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const syncAndRefresh = useCallback(
    async (silent = true) => {
      if (syncInFlight.current) return;
      syncInFlight.current = true;
      setSyncing(true);
      try {
        const summary = await syncPendingPricingQuotes();
        await refreshLocal();
        if (!summary.offline) {
          setOnline(true);
          await fetchServerHistory();
        } else {
          setOnline(false);
        }

        if (!silent) {
          if (summary.synced > 0) {
            showNotice(
              `${summary.synced} saved ${summary.synced === 1 ? "quote" : "quotes"} synced`,
              "ok",
            );
          } else if (summary.error) {
            showNotice(summary.error, "error");
          } else if (summary.pending > 0) {
            showNotice("Still offline — quotes stay queued on this phone", "info");
          } else if (summary.offline) {
            showNotice("Offline — showing the history saved on this phone", "info");
          } else {
            showNotice("Everything is synced", "ok");
          }
        }
      } catch (err) {
        if (isNetworkError(err)) setOnline(false);
        if (!silent) showNotice(err instanceof Error ? err.message : "Sync failed", "error");
      } finally {
        syncInFlight.current = false;
        setSyncing(false);
      }
    },
    [fetchServerHistory, refreshLocal, showNotice],
  );

  // Refresh on screen focus (covers app re-entry) and sync as soon as the
  // device reports a usable connection again.
  useFocusEffect(
    useCallback(() => {
      void refreshLocal();
      void syncAndRefresh(true);
    }, [refreshLocal, syncAndRefresh]),
  );

  useEffect(() => {
    let mounted = true;
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (mounted) setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
      })
      .catch(() => undefined);

    const subscription = Network.addNetworkStateListener((state) => {
      const next = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setOnline(next);
      if (next) void syncAndRefresh(true);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [syncAndRefresh]);

  const setField = (key: keyof PricingInputs, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));

  async function fillLatestPrice() {
    const chosen = grade.trim();
    if (!chosen) {
      showNotice("Choose a coffee grade first", "error");
      return;
    }
    if (!online) {
      setLatestMessage("Offline — connect to fetch the latest purchase price.");
      return;
    }
    setLatestBusy(true);
    setLatestMessage(null);
    try {
      const { latest } = await api.latestPricingPrice(chosen);
      if (!latest) {
        setLatestMessage(`No stock batch found for “${chosen}”.`);
        showNotice(`No stock batch found for ${chosen}`, "error");
        return;
      }
      setField("purchasePrice", String(latest.pricePerKg));
      const price = formatPricingMoney(
        latest.pricePerKg,
        latest.pricePerKg % 1 === 0 ? 0 : 2,
      );
      setLatestMessage(
        `Using ${latest.itemName} @ ${price}/kg from ${formatDate(latest.purchaseDate)}.`,
      );
      showNotice("Purchase price filled from the latest stock batch", "ok");
    } catch (err) {
      if (isNetworkError(err)) setOnline(false);
      const message = isNetworkError(err)
        ? "Could not reach the server — enter the price manually."
        : err instanceof Error
          ? err.message
          : "Could not read the stock price";
      setLatestMessage(message);
      showNotice(message, "error");
    } finally {
      setLatestBusy(false);
    }
  }

  async function saveQuote() {
    if (!result) {
      showNotice("Fix the highlighted fields before saving", "error");
      return;
    }
    if (!canCreate) {
      showNotice("Your role can view quotes but not save new ones", "error");
      return;
    }
    setSaving(true);
    try {
      await enqueuePricingQuote({
        grade: grade.trim(),
        note: note.trim() || null,
        inputs,
        results: result,
        createdByName: user?.name ?? "",
      });
      await refreshLocal();

      // Try immediately; a failed attempt leaves the quote marked pending.
      const summary = await syncPendingPricingQuotes();
      await refreshLocal();

      if (summary.offline) {
        showNotice("Saved on this phone — pending sync", "info");
      } else if (summary.error) {
        showNotice(`Saved locally. Sync failed: ${summary.error}`, "error");
      } else {
        showNotice("Saved and synced", "ok");
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not save the calculation", "error");
    } finally {
      setSaving(false);
    }
  }

  function openShare() {
    if (!result) {
      showNotice("Fix the highlighted fields before sharing", "error");
      return;
    }
    const tier = result.tiers.find((entry) => entry.key === "regular") ?? result.tiers[1];
    setShareTierKey(tier.key);
    setShareMinOrder(String(tier.kgPerMonth));
    setShareOpen(true);
  }

  function chooseShareTier(tier: PricingTier) {
    setShareTierKey(tier.key);
    setShareMinOrder(String(tier.kgPerMonth));
  }

  function quoteText(): string | null {
    if (!result) return null;
    const tier = result.tiers.find((entry) => entry.key === shareTierKey);
    if (!tier) return null;
    const minOrder = Number(shareMinOrder);
    if (!Number.isFinite(minOrder) || minOrder <= 0) return null;
    return [
      "Sri Durga Hari Hara Enterprises",
      `Green coffee – ${grade.trim()}`,
      `Price: ${formatPricingMoney(tier.sellingPrice)}/kg`,
      `Min order: ${formatKg(minOrder)} kg`,
      `Valid till: ${datePlusDays(3)}`,
    ].join("\n");
  }

  async function shareQuote() {
    const message = quoteText();
    if (!message) {
      showNotice("Enter a valid minimum order in kg", "error");
      return;
    }
    try {
      await Share.share({ message, title: "Green coffee quote" });
      setShareOpen(false);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Could not open the share sheet", "error");
    }
  }

  function resetCalculator() {
    Alert.alert(
      "Reset calculator?",
      "This clears the current quote and restores the web defaults.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            setForm(toForm(DEFAULT_PRICING_INPUTS));
            setGrade(GRADE_OPTIONS[0]);
            setNote("");
            setLatestMessage(null);
            showNotice("Reset to the default numbers", "info");
            scrollRef.current?.scrollTo({ y: 0, animated: true });
          },
        },
      ],
    );
  }

  function openSavedQuote(quote: SavedPricingQuote) {
    setForm(toForm(quote.inputs));
    setGrade(quote.grade);
    setNote(quote.note ?? "");
    setLatestMessage(null);
    setTab("calculator");
    showNotice(`Loaded ${quote.grade}`, "ok");
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function closeScreen() {
    if (router.canGoBack()) router.back();
    else router.replace("/more");
  }

  const selectedShareTier = result?.tiers.find((tier) => tier.key === shareTierKey) ?? null;
  const previewText = quoteText();

  const statusColours =
    result?.status.level === "ok"
      ? { bg: theme.successSoft, border: theme.success, ink: theme.successInk }
      : { bg: theme.errorSoft, border: theme.error, ink: theme.errorInk };

  const noticeColours =
    notice?.kind === "ok"
      ? { bg: theme.successSoft, border: theme.success, ink: theme.successInk }
      : notice?.kind === "error"
        ? { bg: theme.errorSoft, border: theme.error, ink: theme.errorInk }
        : { bg: theme.surface2, border: theme.line, ink: theme.muted };

  function renderField(field: FieldDef) {
    const error = errors[field.key];
    return (
      <View key={field.key} style={styles.fieldCell}>
        <Text style={[styles.fieldLabel, { color: theme.ink }]}>{field.label}</Text>
        <Text style={[styles.fieldSuffix, { color: theme.muted }]}>{field.suffix}</Text>
        <TextInput
          style={[
            styles.input,
            {
              color: theme.ink,
              backgroundColor: theme.surface2,
              borderColor: error ? theme.error : theme.line,
            },
          ]}
          value={form[field.key]}
          onChangeText={(value) => setField(field.key, value)}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="0"
          placeholderTextColor={theme.muted}
          selectionColor={theme.primary}
          accessibilityLabel={`${field.label} (${field.suffix})`}
          accessibilityHint={error ? `Error: ${error}` : undefined}
        />
        {error ? (
          <Text style={[styles.fieldError, { color: theme.errorInk }]} role="alert">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  function renderSection(
    key: keyof typeof openSections,
    title: string,
    subtitle: string,
    fields: FieldDef[],
  ) {
    const open = openSections[key];
    return (
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <TouchableOpacity
          style={styles.sectionHeader}
          onPress={() => toggleSection(key)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${title} section`}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: theme.ink }]}>{title}</Text>
            <Text style={[styles.sectionSubtitle, { color: theme.muted }]}>{subtitle}</Text>
          </View>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={theme.muted} />
        </TouchableOpacity>
        {open ? <View style={styles.fieldGrid}>{fields.map(renderField)}</View> : null}
      </View>
    );
  }

  function renderBuyerTable() {
    if (!result) return null;
    const totalKg = result.tiers.reduce((sum, tier) => sum + tier.kgPerMonth, 0);
    return (
      <View style={styles.table}>
        <View style={[styles.tableHead, { borderBottomColor: theme.line }]}>
          <Text style={[styles.thBuyer, { color: theme.muted }]}>Buyer</Text>
          <Text style={[styles.thNum, { color: theme.muted }]}>Price/kg</Text>
          <Text style={[styles.thNum, { color: theme.muted }]}>Profit/kg</Text>
          <Text style={[styles.thMonthly, { color: theme.muted }]}>Monthly</Text>
        </View>
        {result.tiers.map((tier) => (
          <View key={tier.key} style={[styles.tableRow, { borderBottomColor: theme.line }]}>
            <View style={styles.tdBuyer}>
              <Text style={[styles.tdBuyerText, { color: theme.ink }]} numberOfLines={1}>
                {tierLabel(tier)}
              </Text>
              <Text style={[styles.tdBuyerMeta, { color: theme.muted }]}>
                {formatKg(tier.kgPerMonth)} kg/mo
              </Text>
            </View>
            <Text style={[styles.tdNum, { color: theme.ink }]} numberOfLines={1}>
              {formatPricingMoney(tier.sellingPrice)}
            </Text>
            <Text style={[styles.tdNum, { color: theme.muted }]} numberOfLines={1}>
              {formatPricingMoney(tier.profitPerKg, 2)}
            </Text>
            <Text style={[styles.tdMonthly, { color: theme.ink }]} numberOfLines={1}>
              {formatPricingMoney(tier.monthlyProfit)}
            </Text>
          </View>
        ))}
        <View style={[styles.tableRow, styles.tableTotal, { backgroundColor: theme.surface2 }]}>
          <View style={styles.tdBuyer}>
            <Text style={[styles.tdBuyerText, { color: theme.ink }]}>Total</Text>
            <Text style={[styles.tdBuyerMeta, { color: theme.muted }]}>{formatKg(totalKg)} kg/mo</Text>
          </View>
          <Text style={[styles.tdNum, { color: theme.muted }]}>—</Text>
          <Text style={[styles.tdNum, { color: theme.muted }]}>—</Text>
          <Text style={[styles.tdMonthly, { color: theme.ink }]} numberOfLines={1}>
            {formatPricingMoney(result.totalMonthlyProfit)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}
    >
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
      >
        {/* ---- header ---- */}
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity
            onPress={closeScreen}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={theme.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heading, { color: theme.ink }]}>Pricing Calculator</Text>
            <Text style={[styles.subheading, { color: theme.muted }]}>
              Quote green coffee per kg — works offline.
            </Text>
          </View>
          {!online ? (
            <View style={[styles.offlinePill, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <Ionicons name="cloud-offline-outline" size={13} color={theme.muted} />
              <Text style={[styles.offlineText, { color: theme.muted }]}>Offline</Text>
            </View>
          ) : null}
        </View>

        {/* ---- calculator / history tabs ---- */}
        <View style={[styles.tabSwitch, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {(["calculator", "history"] as Tab[]).map((key) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.tabButton, active && { backgroundColor: theme.surface }]}
                onPress={() => setTab(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.tabText, { color: active ? theme.ink : theme.muted }]}>
                  {key === "calculator" ? "Calculator" : "History"}
                </Text>
                {key === "history" && pendingCount > 0 ? (
                  <View style={[styles.countBadge, { backgroundColor: theme.primary }]}>
                    <Text style={[styles.countBadgeText, { color: theme.onPrimary }]}>{pendingCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {notice ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: noticeColours.bg, borderColor: noticeColours.border },
            ]}
            role="status"
          >
            <Text style={[styles.noticeText, { color: noticeColours.ink }]}>{notice.text}</Text>
          </View>
        ) : null}

        {pendingCount > 0 ? (
          <TouchableOpacity
            style={[styles.pendingBanner, { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}
            onPress={() => {
              setTab("history");
              void syncAndRefresh(false);
            }}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel={`${pendingCount} saved quotes pending sync. Tap to sync now.`}
          >
            <Ionicons name="cloud-upload-outline" size={16} color={theme.accentInk} />
            <Text style={[styles.pendingText, { color: theme.accentInk }]}>
              {pendingCount} saved {pendingCount === 1 ? "quote" : "quotes"} pending sync
            </Text>
            <Text style={[styles.pendingAction, { color: theme.accentInk }]}>
              {syncing ? "Syncing…" : "Sync now"}
            </Text>
          </TouchableOpacity>
        ) : null}

        {tab === "calculator" ? (
          <>
            {/* ---- 1 + 2. headline, status ---- */}
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              {!result ? (
                <>
                  <Text style={[styles.cardLabel, { color: theme.muted }]}>REGULAR BUYER PRICE</Text>
                  <Text style={[styles.bigPrice, { color: theme.ink }]}>—</Text>
                  <Text style={[styles.emptyHint, { color: theme.muted }]}>
                    {errorCount === 1
                      ? "1 field needs a valid number."
                      : `${errorCount} fields need a valid number.`}{" "}
                    Prices appear as soon as every field is valid.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.cardLabel, { color: theme.muted }]}>REGULAR BUYER PRICE</Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.bigPrice, { color: theme.accentInk }]}>
                      {formatPricingMoney(result.regularPrice)}
                    </Text>
                    <Text style={[styles.priceUnit, { color: theme.muted }]}>/ kg</Text>
                  </View>

                  <View style={styles.headlineStats}>
                    <View style={styles.headlineStat}>
                      <Text style={[styles.statLabel, { color: theme.muted }]}>LANDED COST</Text>
                      <Text style={[styles.statValue, { color: theme.ink }]}>
                        {formatPricingMoney(result.landedCost, 1)}
                      </Text>
                    </View>
                    <View style={styles.headlineStat}>
                      <Text style={[styles.statLabel, { color: theme.muted }]}>ROASTER MAX</Text>
                      <Text style={[styles.statValue, { color: theme.ink }]}>
                        {formatPricingMoney(result.roasterMaxPrice)}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.statusBanner,
                      { backgroundColor: statusColours.bg, borderColor: statusColours.border },
                    ]}
                    role="status"
                  >
                    <Ionicons
                      name={result.status.level === "ok" ? "checkmark-circle" : "alert-circle"}
                      size={17}
                      color={statusColours.ink}
                    />
                    <Text style={[styles.statusText, { color: statusColours.ink }]}>
                      {result.status.message}
                    </Text>
                  </View>

                  {/* ---- 3. buyer table ---- */}
                  {renderBuyerTable()}

                  <Text style={[styles.gstNote, { color: theme.muted }]}>
                    Prices are ex-GST — GST is not included in this calculation.
                  </Text>
                </>
              )}
            </View>

            {/* ---- 4. inputs in three collapsible sections ---- */}
            {renderSection("cost", "Cost", "Purchase, freight, loss and credit", COST_FIELDS)}
            {renderSection("margins", "Margins", "Margin and monthly quantity by buyer", MARGIN_FIELDS)}
            {renderSection("roaster", "Roaster check", "The ceiling the roaster can pay", ROASTER_FIELDS)}

            {/* ---- 5. grade + note  ---- */}
            <View style={[styles.card, { backgroundColor: theme.surface }]}>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>Quote details</Text>

              <Text style={[styles.fieldLabel, { color: theme.ink }]}>Coffee grade</Text>
              <View
                style={[
                  styles.pickerWrap,
                  { borderColor: theme.line, backgroundColor: theme.surface2 },
                ]}
              >
                <Picker
                  selectedValue={grade}
                  onValueChange={(value) => setGrade(String(value))}
                  mode="dropdown"
                  dropdownIconColor={theme.muted}
                  style={[styles.picker, { color: theme.ink }]}
                  itemStyle={{ color: theme.ink, fontSize: 15 }}
                  accessibilityLabel="Coffee grade"
                >
                  {gradeChoices.map((option) => (
                    <Picker.Item key={option} label={option} value={option} />
                  ))}
                </Picker>
              </View>

              <TouchableOpacity
                style={[
                  styles.latestButton,
                  {
                    borderColor: theme.line,
                    backgroundColor: theme.surface2,
                    opacity: latestBusy || !online ? 0.65 : 1,
                  },
                ]}
                onPress={() => void fillLatestPrice()}
                disabled={latestBusy || !online}
                accessibilityRole="button"
                accessibilityLabel="Use latest purchase price from the backend"
              >
                <Ionicons name="refresh" size={15} color={theme.primary} />
                <Text style={[styles.latestText, { color: theme.primary }]}>
                  {latestBusy
                    ? "Checking stock…"
                    : online
                      ? "Use latest purchase price"
                      : "Latest price needs a connection"}
                </Text>
              </TouchableOpacity>
              {latestMessage ? (
                <Text style={[styles.latestMessage, { color: theme.muted }]}>{latestMessage}</Text>
              ) : null}

              <Text style={[styles.fieldLabel, { color: theme.ink, marginTop: 14 }]}>
                Note <Text style={{ fontWeight: "400", color: theme.muted }}>(optional)</Text>
              </Text>
              <TextInput
                style={[
                  styles.noteInput,
                  { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 },
                ]}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. buyer collects, 30 days credit"
                placeholderTextColor={theme.muted}
                multiline
                maxLength={500}
                selectionColor={theme.primary}
                accessibilityLabel="Note"
              />
            </View>

            {/* ---- 6. actions ---- */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  { backgroundColor: saving || !result || !canCreate ? theme.surface3 : theme.primary },
                ]}
                onPress={() => void saveQuote()}
                disabled={saving || !result || !canCreate}
                accessibilityRole="button"
                accessibilityLabel="Save calculation"
                accessibilityHint={canCreate ? undefined : "Your role cannot save new quotes"}
              >
                <Text
                  style={[
                    styles.actionText,
                    { color: saving || !result || !canCreate ? theme.muted : theme.onPrimary },
                  ]}
                >
                  {saving ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.actionButton,
                  {
                    backgroundColor: result ? theme.accentSoft : theme.surface3,
                    borderColor: theme.accent,
                    borderWidth: result ? 1 : 0,
                  },
                ]}
                onPress={openShare}
                disabled={!result}
                accessibilityRole="button"
                accessibilityLabel="Share quote"
              >
                <Ionicons name="share-social-outline" size={16} color={result ? theme.accentInk : theme.muted} />
                <Text style={[styles.actionText, { color: result ? theme.accentInk : theme.muted }]}>
                  Share quote
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.resetButton,
                  { backgroundColor: theme.surface2, borderColor: theme.line },
                ]}
                onPress={resetCalculator}
                accessibilityRole="button"
                accessibilityLabel="Reset calculator"
              >
                <Ionicons name="refresh" size={16} color={theme.muted} />
                <Text style={[styles.resetText, { color: theme.muted }]}>Reset</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.footerNote, { color: theme.muted }]}>
              Saving stores the grade, note, inputs and results with your name. Quotes saved
              offline wait on this phone and sync automatically.
            </Text>

            <View style={[styles.formulaCard, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <Text style={[styles.formulaTitle, { color: theme.ink }]}>How this is calculated</Text>
              <Text style={[styles.formulaText, { color: theme.muted }]}>
                Landed = purchase + transport + handling + weight loss + credit cost. Selling =
                landed × (1 + margin%) rounded UP to the next ₹5. Roaster max = powder revenue −
                processing − roaster profit. The same shared function runs on the web app.
              </Text>
            </View>
          </>
        ) : (
          /* ---------------- history ---------------- */
          <View style={{ paddingHorizontal: 12, gap: 8 }}>
            <View style={styles.historyHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.historyTitle, { color: theme.ink }]}>
                  Saved calculations
                </Text>
                <Text style={[styles.historySub, { color: theme.muted }]}>
                  {quotes.length} total · {pendingCount} pending sync
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.syncButton, { borderColor: theme.line, backgroundColor: theme.surface }]}
                onPress={() => void syncAndRefresh(false)}
                disabled={syncing}
                accessibilityRole="button"
                accessibilityLabel="Sync saved calculations"
              >
                {syncing ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={15} color={theme.primary} />
                )}
                <Text style={[styles.syncText, { color: theme.primary }]}>
                  {syncing ? "Syncing" : "Sync"}
                </Text>
              </TouchableOpacity>
            </View>

            {historyError ? (
              <View style={[styles.notice, { backgroundColor: theme.errorSoft, borderColor: theme.error }]}>
                <Text style={[styles.noticeText, { color: theme.errorInk }]}>{historyError}</Text>
              </View>
            ) : null}

            {historyLoading && quotes.length === 0 ? (
              <View style={styles.historyEmpty}>
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={[styles.emptyHint, { color: theme.muted, marginTop: 10 }]}>
                  Loading saved calculations…
                </Text>
              </View>
            ) : quotes.length === 0 ? (
              <View style={[styles.historyEmpty, { backgroundColor: theme.surface2 }]}>
                <Ionicons name="calculator-outline" size={28} color={theme.muted} />
                <Text style={[styles.emptyTitle, { color: theme.ink }]}>
                  No saved calculations yet
                </Text>
                <Text style={[styles.emptyHint, { color: theme.muted }]}>
                  Save a quote from the Calculator tab and it will appear here — offline too.
                </Text>
              </View>
            ) : (
              quotes.map((quote) => {
                const pending = quote.status === "pending";
                return (
                  <TouchableOpacity
                    key={quote.localId}
                    style={[
                      styles.historyRow,
                      {
                        backgroundColor: theme.surface,
                        borderColor: pending ? theme.accent : theme.line,
                      },
                    ]}
                    onPress={() => openSavedQuote(quote)}
                    accessibilityRole="button"
                    accessibilityLabel={`Load ${quote.grade} quote`}
                  >
                    <View style={styles.historyRowTop}>
                      <Text style={[styles.historyGrade, { color: theme.ink }]} numberOfLines={1}>
                        {quote.grade}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: pending ? theme.accentSoft : theme.successSoft,
                            borderColor: pending ? theme.accent : theme.success,
                          },
                        ]}
                      >
                        <Ionicons
                          name={pending ? "cloud-offline-outline" : "checkmark-circle-outline"}
                          size={12}
                          color={pending ? theme.accentInk : theme.successInk}
                        />
                        <Text
                          style={[
                            styles.statusPillText,
                            { color: pending ? theme.accentInk : theme.successInk },
                          ]}
                        >
                          {pending ? "Pending sync" : "Synced"}
                        </Text>
                      </View>
                    </View>

                    <Text style={[styles.historyMeta, { color: theme.muted }]} numberOfLines={1}>
                      {formatDateTime(quote.createdAt)}
                      {quote.createdByName ? ` · ${quote.createdByName}` : ""}
                    </Text>

                    <View style={styles.historyValues}>
                      <View style={styles.historyValue}>
                        <Text style={[styles.historyValueLabel, { color: theme.muted }]}>
                          REGULAR
                        </Text>
                        <Text style={[styles.historyValueText, { color: theme.ink }]}>
                          {formatPricingMoney(quote.results.regularPrice)}/kg
                        </Text>
                      </View>
                      <View style={styles.historyValue}>
                        <Text style={[styles.historyValueLabel, { color: theme.muted }]}>
                          LANDED
                        </Text>
                        <Text style={[styles.historyValueText, { color: theme.ink }]}>
                          {formatPricingMoney(quote.results.landedCost, 1)}
                        </Text>
                      </View>
                      <View style={styles.historyValue}>
                        <Text style={[styles.historyValueLabel, { color: theme.muted }]}>
                          MONTHLY PROFIT
                        </Text>
                        <Text style={[styles.historyValueText, { color: theme.ink }]}>
                          {formatPricingMoney(quote.results.totalMonthlyProfit)}
                        </Text>
                      </View>
                    </View>

                    {quote.note ? (
                      <Text style={[styles.historyNote, { color: theme.muted }]} numberOfLines={2}>
                        {quote.note}
                      </Text>
                    ) : null}
                    {quote.syncError ? (
                      <Text style={[styles.historyError, { color: theme.errorInk }]} numberOfLines={2}>
                        Sync stopped: {quote.syncError}
                      </Text>
                    ) : null}

                    <Text style={[styles.historyOpen, { color: theme.primary }]}>
                      Tap to load these inputs →
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}

            <Text style={[styles.footerNote, { color: theme.muted, marginTop: 4 }]}>
              Synced quotes are stored on the shop server. Pending quotes live only on this phone
              until the connection returns.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ---- share sheet picker ---- */}
      <Modal
        visible={shareOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShareOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={() => undefined}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitle, { color: theme.ink }]}>Share quote</Text>
                  <Text style={[styles.sheetSub, { color: theme.muted }]}>
                    Pick the buyer tier. The shared text never shows cost or margin.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShareOpen(false)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close share sheet"
                >
                  <Ionicons name="close" size={22} color={theme.muted} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.fieldLabel, { color: theme.ink, marginTop: 10 }]}>
                Buyer tier
              </Text>
              {result?.tiers.map((tier) => {
                const selected = tier.key === shareTierKey;
                return (
                  <TouchableOpacity
                    key={tier.key}
                    style={[
                      styles.tierOption,
                      {
                        borderColor: selected ? theme.primary : theme.line,
                        backgroundColor: selected ? theme.surface2 : theme.surface,
                      },
                    ]}
                    onPress={() => chooseShareTier(tier)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View
                      style={[
                        styles.radio,
                        { borderColor: selected ? theme.primary : theme.muted },
                      ]}
                    >
                      {selected ? (
                        <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tierName, { color: theme.ink }]}>{tier.label}</Text>
                      <Text style={[styles.tierMeta, { color: theme.muted }]}>
                        {formatKg(tier.kgPerMonth)} kg / month
                      </Text>
                    </View>
                    <Text style={[styles.tierPrice, { color: theme.ink }]}>
                      {formatPricingMoney(tier.sellingPrice)}/kg
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <Text style={[styles.fieldLabel, { color: theme.ink, marginTop: 14 }]}>
                Minimum order (kg)
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: theme.ink,
                    backgroundColor: theme.surface2,
                    borderColor: theme.line,
                    width: "100%",
                  },
                ]}
                value={shareMinOrder}
                onChangeText={setShareMinOrder}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="0"
                placeholderTextColor={theme.muted}
                selectionColor={theme.primary}
                accessibilityLabel="Minimum order in kilograms"
              />

              <Text style={[styles.fieldLabel, { color: theme.ink, marginTop: 14 }]}>
                Preview
              </Text>
              <View style={[styles.preview, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                <Text style={[styles.previewText, { color: theme.ink }]} selectable>
                  {previewText ?? "Enter a valid minimum order to preview the quote."}
                </Text>
              </View>

              <Text style={[styles.privacyNote, { color: theme.muted }]}>
                Landed cost, margin and the roaster ceiling are never included.
              </Text>

              <TouchableOpacity
                style={[
                  styles.shareButton,
                  { backgroundColor: previewText ? theme.primary : theme.surface3 },
                ]}
                onPress={() => void shareQuote()}
                disabled={!previewText || !selectedShareTier}
                accessibilityRole="button"
                accessibilityLabel="Open Android share sheet"
              >
                <Ionicons
                  name="share-social"
                  size={18}
                  color={previewText ? theme.onPrimary : theme.muted}
                />
                <Text
                  style={[styles.shareButtonText, { color: previewText ? theme.onPrimary : theme.muted }]}
                >
                  Share on WhatsApp or another app
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  heading: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  subheading: { fontSize: 12, marginTop: 2 },
  offlinePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  offlineText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },

  tabSwitch: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 12,
    marginBottom: 10,
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 9,
    minHeight: 40,
  },
  tabText: { fontSize: 13, fontWeight: "600" },
  countBadge: { borderRadius: 10, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  countBadgeText: { fontSize: 10, fontWeight: "700" },

  notice: { marginHorizontal: 12, marginBottom: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  noticeText: { fontSize: 12, fontWeight: "600", lineHeight: 17 },

  pendingBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 44,
  },
  pendingText: { flex: 1, fontSize: 12, fontWeight: "600" },
  pendingAction: { fontSize: 12, fontWeight: "700" },

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
  cardLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  priceRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 2 },
  bigPrice: { fontSize: 46, fontWeight: "700", letterSpacing: -1.5, lineHeight: 52 },
  priceUnit: { fontSize: 14, fontWeight: "500", marginBottom: 8, marginLeft: 4 },
  headlineStats: { flexDirection: "row", gap: 20, marginTop: 10 },
  headlineStat: { flex: 1 },
  statLabel: { fontSize: 9.5, fontWeight: "700", letterSpacing: 0.8 },
  statValue: { fontSize: 16, fontWeight: "700", marginTop: 2 },
  statusBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginTop: 12,
  },
  statusText: { flex: 1, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  emptyHint: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "700", marginTop: 8 },

  table: { marginTop: 14 },
  tableHead: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 6, borderBottomWidth: 1 },
  thBuyer: { flex: 1, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  thNum: { width: 58, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textAlign: "right", textTransform: "uppercase" },
  thMonthly: { width: 78, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textAlign: "right", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  tableTotal: { borderBottomWidth: 0, borderTopWidth: 1, marginTop: 2, paddingHorizontal: 4, borderRadius: 6 },
  tdBuyer: { flex: 1, minWidth: 0, paddingRight: 4 },
  tdBuyerText: { fontSize: 12.5, fontWeight: "600" },
  tdBuyerMeta: { fontSize: 9.5, marginTop: 1 },
  tdNum: { width: 58, fontSize: 12, fontWeight: "600", textAlign: "right" },
  tdMonthly: { width: 78, fontSize: 12, fontWeight: "700", textAlign: "right" },
  gstNote: { fontSize: 10, marginTop: 10, lineHeight: 14 },

  sectionHeader: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  sectionSubtitle: { fontSize: 11, marginTop: 2 },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  fieldCell: { flexBasis: "46%", flexGrow: 1, minWidth: 130 },
  fieldLabel: { fontSize: 11, fontWeight: "600", marginBottom: 1 },
  fieldSuffix: { fontSize: 9.5, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: "600",
  },
  fieldError: { fontSize: 10.5, marginTop: 3, lineHeight: 14 },

  pickerWrap: { borderWidth: 1, borderRadius: 10, overflow: "hidden", minHeight: 48, justifyContent: "center" },
  picker: { height: 48, width: "100%" },
  latestButton: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    marginTop: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  latestText: { fontSize: 12.5, fontWeight: "600" },
  latestMessage: { fontSize: 11, lineHeight: 15, marginTop: 6 },
  noteInput: { borderWidth: 1, borderRadius: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: "top" },

  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 12, marginTop: 2 },
  actionButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 6,
  },
  actionText: { fontSize: 13, fontWeight: "700" },
  resetButton: {
    width: 76,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
  },
  resetText: { fontSize: 12, fontWeight: "600" },
  footerNote: { fontSize: 10.5, lineHeight: 15, paddingHorizontal: 16, marginTop: 8 },
  formulaCard: { borderWidth: 1, borderRadius: 12, marginHorizontal: 12, marginTop: 12, padding: 12 },
  formulaTitle: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  formulaText: { fontSize: 11, lineHeight: 16 },

  historyHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  historyTitle: { fontSize: 17, fontWeight: "700" },
  historySub: { fontSize: 11, marginTop: 2 },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  syncText: { fontSize: 12, fontWeight: "700" },
  historyEmpty: { borderRadius: 14, padding: 24, alignItems: "center", marginTop: 4 },
  historyRow: { borderWidth: 1, borderRadius: 14, padding: 12 },
  historyRowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyGrade: { flex: 1, fontSize: 15, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusPillText: { fontSize: 9.5, fontWeight: "700" },
  historyMeta: { fontSize: 10.5, marginTop: 3 },
  historyValues: { flexDirection: "row", gap: 8, marginTop: 9 },
  historyValue: { flex: 1 },
  historyValueLabel: { fontSize: 8.5, fontWeight: "700", letterSpacing: 0.4 },
  historyValueText: { fontSize: 13, fontWeight: "700", marginTop: 1 },
  historyNote: { fontSize: 11, marginTop: 7, lineHeight: 15 },
  historyError: { fontSize: 10.5, marginTop: 5, lineHeight: 14 },
  historyOpen: { fontSize: 11, fontWeight: "600", marginTop: 8 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 14 },
  sheet: { borderRadius: 16, padding: 16, maxHeight: "88%" },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  sheetSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  tierOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 11,
    padding: 10,
    marginTop: 7,
    minHeight: 52,
  },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  tierName: { fontSize: 13, fontWeight: "700" },
  tierMeta: { fontSize: 10.5, marginTop: 1 },
  tierPrice: { fontSize: 13, fontWeight: "700" },
  preview: { borderWidth: 1, borderRadius: 11, padding: 11, marginTop: 2 },
  previewText: { fontSize: 12.5, lineHeight: 19 },
  privacyNote: { fontSize: 10.5, lineHeight: 15, marginTop: 8 },
  shareButton: {
    borderRadius: 12,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  shareButtonText: { fontSize: 13.5, fontWeight: "700" },
});
