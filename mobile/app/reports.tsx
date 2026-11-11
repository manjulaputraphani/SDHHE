/**
 * Reports screen — web parity ("Profit & turnover").
 *
 * Financial-year picker, the 4 summary cards (turnover, purchases, gross,
 * net), the per-deal profit table and closing stock.
 * GET /api/reports/fin-years + /api/reports/fin-year + /api/reports/deals.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type DealProfit, type FinYearReport } from "../lib/api";
import { useAuth } from "./_layout";

function money(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

export default function ReportsScreen() {
  const { theme } = useAuth();
  const router = useRouter();

  const [years, setYears] = useState<string[]>([]);
  const [finYear, setFinYear] = useState<string>("");
  const [report, setReport] = useState<FinYearReport | null>(null);
  const [deals, setDeals] = useState<DealProfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (year: string) => {
    try {
      const [reportRes, dealsRes] = await Promise.all([api.finYearReport(year), api.dealProfits(year)]);
      setReport(reportRes.report);
      setDeals(dealsRes.deals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void api
      .finYears()
      .then((r) => {
        const list = r.finYears;
        setYears(list);
        setFinYear((prev) => prev || (list[0] ?? ""));
      })
      .catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (finYear) void load(finYear);
    }, [finYear, load]),
  );

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            if (!finYear) return;
            setRefreshing(true);
            void load(finYear).then(() => setRefreshing(false));
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
          <Text style={{ fontSize: 22, fontWeight: "700", color: theme.ink }}>Profit &amp; turnover</Text>
          <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
            {report ? `Financial year ${report.finYear} · ${formatDate(report.startDate)} to ${formatDate(report.endDate)}` : "Pick a financial year."}
          </Text>
        </View>
      </View>

      {/* FY picker (web <select>) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
        {years.map((year) => (
          <TouchableOpacity
            key={year}
            style={[
              styles.chip,
              finYear === year
                ? { backgroundColor: theme.primary, borderColor: theme.primary }
                : { backgroundColor: theme.surface2, borderColor: theme.line },
            ]}
            onPress={() => setFinYear(year)}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: finYear === year ? theme.onPrimary : theme.ink }}>FY {year}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error ? <Text style={{ paddingHorizontal: 16, fontSize: 13, color: theme.errorInk }}>{error}</Text> : null}

      {report && (
        <>
          {/* 4 summary cards */}
          <View style={styles.cardGrid}>
            {[
              ["Turnover", money(report.turnoverPaise), `${report.salesCount} deals`],
              ["Total purchases", money(report.totalPurchasesPaise), `stock ${money(report.purchaseValuePaise)} + ${money(report.purchaseExpensesPaise)}`],
              ["Gross profit", money(report.grossProfitPaise), `after COGS ${money(report.cogsPaise)}`],
              ["Net profit", money(report.netProfitPaise), `sales ${money(report.saleExpensesPaise)} · general ${money(report.generalExpensesPaise)}`],
            ].map(([label, value, hint]) => (
              <View key={label} style={[styles.card, { backgroundColor: theme.surface }]}>
                <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 1, color: theme.muted }}>{label.toUpperCase()}</Text>
                <Text style={{ fontSize: 19, fontWeight: "700", color: theme.ink, marginTop: 4 }}>{value}</Text>
                <Text style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>{hint}</Text>
              </View>
            ))}
          </View>

          {/* Deals */}
          <Text style={[styles.listTitle, { color: theme.ink }]}>Deals</Text>
          {deals.length === 0 ? (
            <Text style={{ paddingHorizontal: 16, fontSize: 13, color: theme.muted }}>No deals in this financial year.</Text>
          ) : (
            deals.map((deal) => (
              <View key={deal.saleId} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: theme.ink, flex: 1 }}>
                      {deal.billNo} · {deal.customerName ?? "Walk-in"}
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: theme.ink }}>{money(deal.netProfitPaise)}</Text>
                    <View style={[styles.badge, { backgroundColor: deal.profitPercent >= 0 ? theme.successSoft : theme.errorSoft }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: deal.profitPercent >= 0 ? theme.successInk : theme.errorInk }}>
                        {deal.profitPercent}%
                      </Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                    {formatDate(deal.date)} · sale {money(deal.saleValuePaise)} · COGS {money(deal.cogsPaise)} · gross{" "}
                    {money(deal.grossProfitPaise)}
                    {deal.saleExpensesPaise > 0 ? ` · sale exp. ${money(deal.saleExpensesPaise)}` : ""}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* Closing stock */}
          <View style={styles.listHead}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: theme.ink }}>Closing stock</Text>
            <Text style={{ fontSize: 12, color: theme.muted }}>{money(report.closingStockValuePaise)}</Text>
          </View>
          {report.closingStock.filter((row) => row.qtyBase > 0).length === 0 ? (
            <Text style={{ paddingHorizontal: 16, fontSize: 13, color: theme.muted }}>No stock on hand.</Text>
          ) : (
            report.closingStock
              .filter((row) => row.qtyBase > 0)
              .map((row) => (
                <View key={row.itemId} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>{row.name}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                      {(row.qtyBase / 1000).toFixed(2)} {row.unit} · avg {money(row.avgCostPaise)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: theme.ink }}>{money(row.valuePaise)}</Text>
                </View>
              ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", padding: 16 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  cardGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16 },
  card: {
    borderRadius: 14,
    padding: 12,
    flexBasis: "47%",
    flexGrow: 1,
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  listTitle: { fontSize: 15, fontWeight: "700", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  listHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  row: { padding: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  badge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
});
