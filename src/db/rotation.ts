/**
 * Web dashboard summary: working capital + how many times it rotated this
 * month + profit, plus the 30-day daily net-sales trend for the chart.
 *
 * Rotation here = net sales this month ÷ the current amount in rotation
 * (stock + cash + credit outstanding). Days-to-rotate uses the elapsed days
 * of the month so far, so it reads as a current pace.
 */
import type { Db } from "./client";
import { expensesTotal, salesSummary } from "./analytics";
import { rotationTrend, workingCapital, type RotationDay } from "./cashLedger";
import { grossProfitPaise, netProfitPaise } from "../logic/analytics";

export type RotationSummary = {
  asOfDate: string;
  investmentPaise: number;
  stockValuePaise: number;
  cashInBankPaise: number;
  creditOutstandingPaise: number;
  amountInRotationPaise: number;
  netSalesPaise: number;
  cogsPaise: number;
  expensesPaise: number;
  grossProfitPaise: number;
  netProfitPaise: number;
  rotationTimes: number;
  daysToRotate: number | null;
  inventoryTurnover: number;
  trend: RotationDay[];
};

export async function rotationSummary(db: Db, trendDays = 30): Promise<RotationSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [wc, sales, expenses, trend] = await Promise.all([
    workingCapital(db, today),
    salesSummary(db, monthStart, today),
    expensesTotal(db, monthStart, today),
    rotationTrend(db, trendDays),
  ]);

  const gross = grossProfitPaise(sales.netSalesPaise, sales.cogsPaise);
  const net = netProfitPaise(gross, expenses);
  const amount = wc.amountInRotationPaise;
  const rotationTimes = amount > 0 ? sales.netSalesPaise / amount : 0;
  const elapsedDays = Math.max(
    1,
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${monthStart}T00:00:00Z`)) / 86_400_000,
    ) + 1,
  );
  const daysToRotate = rotationTimes > 0 ? elapsedDays / rotationTimes : null;
  const inventoryTurnover =
    wc.stockValuePaise > 0 ? sales.cogsPaise / wc.stockValuePaise : 0;

  return {
    asOfDate: today,
    investmentPaise: wc.investmentPaise,
    stockValuePaise: wc.stockValuePaise,
    cashInBankPaise: wc.cashInBankPaise,
    creditOutstandingPaise: wc.creditOutstandingPaise,
    amountInRotationPaise: wc.amountInRotationPaise,
    netSalesPaise: sales.netSalesPaise,
    cogsPaise: sales.cogsPaise,
    expensesPaise: expenses,
    grossProfitPaise: gross,
    netProfitPaise: net,
    rotationTimes,
    daysToRotate,
    inventoryTurnover,
    trend,
  };
}
