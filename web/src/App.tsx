import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import LoadingMark from "../../src/components/LoadingMark";
import {
  api,
  money,
  qty,
  type ActivityRow,
  type BatchLedger,
  type BillDetail,
  type BillRow,
  type Customer,
  type DealProfit,
  type ExpenseRow,
  type FinYearReport,
  type Item,
  type RoastingRow,
  type RotationSummary,
  type Member,
  type StockEntryRow,
  type UsageRow,
  type User,
} from "./api";
import { buildBillHtml } from "../../src/lib/printBill";
import { clearWelcomeFlag, setWelcomeFlag } from "../../src/logic/welcomeBanner";
import { normalizePhone } from "../../src/logic/auth";
import { planRoast } from "../../src/logic/roasting";
import { billWhatsAppText, buildWhatsAppLink } from "../../src/lib/whatsapp";
import type { ShopDetails } from "../../src/db/settings";
import {
  ACTION_LABELS,
  MODULES,
  MODULE_LABELS,
  PERMISSION_ACTIONS,
  allowed,
  type ModuleKey,
  type PermissionAction,
  type Role,
  type RolePermissions,
} from "../../src/logic/permissions";
import { formatDate, formatDateTime } from "./format";
import ThemeToggle from "./ThemeToggle";
import { getMode, resolveTheme, setMode, subscribeMode, watchSystemTheme } from "./theme";
import EmptyState from "./components/EmptyState";
import FormRow from "./components/FormRow";
import ItemPicker from "./components/ItemPicker";
import CustomerPicker from "./components/CustomerPicker";
import ItemThumb from "./components/ItemThumb";
import ResponsiveTable from "./components/ResponsiveTable";
import SalesChart from "./components/SalesChart";
import RotationChart from "./components/RotationChart";
import TeamChat from "./components/TeamChat";
import ChatFab from "./components/ChatFab";
import { getUnread, onlyUnreadRoom, refreshUnread, subscribeUnread } from "./unread";
import ToastHost from "./components/notifications/ToastHost";
import NotificationsHost from "./components/notifications/NotificationsHost";
import AnnouncementsAdmin from "./components/AnnouncementsAdmin";
import { showToast } from "./components/notifications/toastStore";
import { ensurePushSubscription, markPushAsked, pushAsked, pushSupported } from "./components/notifications/pushSetup";
import type { LoginEntry } from "./api";
import { TOURS } from "./components/notifications/tourSteps";
import {
  IconActivity,
  IconBanknote,
  IconBarChart,
  IconBill,
  IconCalculator,
  IconCalendar,
  IconClose,
  IconCoffee as IconCoffeeNav,
  IconContrast,
  IconCrown,
  IconDashboard,
  IconExpenses,
  IconEye as IconEyeOpen,
  IconEyeOff,
  IconImage,
  IconIndianRupee,
  IconInvestments,
  IconInvoice,
  IconItems,
  IconKey,
  IconLoader,
  IconLock,
  IconMenu,
  IconMessageCircle,
  IconMoon,
  IconPackage,
  IconPhone,
  IconPlus,
  IconPurchases,
  IconRefresh,
  IconReports,
  IconScale,
  IconSettings,
  IconSignOut,
  IconStickyNote,
  IconStock,
  IconStore,
  IconSun,
  IconTag,
  IconTeam,
  IconTruck,
  IconUser,
  IconUserCheck,
  IconUserPlus,
  IconUsers,
  IconUserX,
} from "./components/icons";

type View = "dashboard" | "reports" | "customers" | "investments" | "bills" | "billing" | "items" | "purchases" | "roasting" | "stock" | "expenses" | "suppliers" | "activity" | "team-chat" | "team" | "settings";

/** Views that share another module's permission (Roasting uses Stock, Team Chat uses Chat). */
const viewModule = (view: View): ModuleKey =>
  view === "roasting" ? "stock" : view === "team-chat" ? "chat" : (view as ModuleKey);

type PurchaseRow = {
  id: number;
  name: string;
  unit: string;
  qty_base: number;
  unit_price_paise: number;
  total_paise: number;
  paid_paise: number;
  purchase_date: string;
  expenses_paise: number;
  payment_mode: string | null;
  note: string | null;
  supplier_name: string | null;
};

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

const CHART_COLORS = [
  "var(--c-chart-1)",
  "var(--c-chart-2)",
  "var(--c-chart-3)",
  "var(--c-chart-4)",
  "var(--c-chart-5)",
  "var(--c-chart-6)",
];

/** "Bh Phani Kumar" → "BK"; "Chaluvaraj" → "CH". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** 7569208757 → "75692•••57" */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 7) return phone;
  return `${digits.slice(0, 5)}•••${digits.slice(-2)}`;
}

/** "1h 5m", "50m 45s", "0m" — how long a member was active (whole units). */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}


function Donut({ items }: { items: { label: string; value: number }[] }) {  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  let acc = 0;
  const stops = items
    .map((item, index) => {
      const start = (acc / total) * 100;
      acc += item.value;
      return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${(acc / total) * 100}%`;
    })
    .join(", ");
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative size-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
        <div className="absolute inset-5 rounded-full bg-surface" />
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span>{item.label}</span>
            <span className="text-muted">{money(item.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STOCK_TYPE_LABEL: Record<string, string> = {
  STOCK_CHECK: "Stock left",
  USAGE: "Used",
  WASTAGE: "Wastage",
};

/** Base units per display unit, mirroring src/logic/units.ts. */
const UNIT_FACTORS: Record<string, number> = { kg: 1000, l: 1000, "60 kg bag": 60_000 };
const unitFactor = (unit: string): number => UNIT_FACTORS[unit] ?? 1;

/** API dates can arrive as full ISO timestamps; date inputs need YYYY-MM-DD. */
const dateInputValue = (value: string): string => {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

function RolePill({ role }: { role: Role }) {
  if (role === "owner") {
    return <span className="badge badge-warn inline-flex items-center gap-1"><IconCrown size={12} /> Owner</span>;
  }
  if (role === "ca") {
    return <span className="badge badge-info inline-flex items-center gap-1"><IconCalculator size={12} /> CA</span>;
  }
  return <span className="badge badge-info inline-flex items-center gap-1"><IconUser size={12} /> Staff</span>;
}

/** Compact relative time for the activity feed: "2 min ago", "3 h ago", … */
function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.floor(months / 12)} y ago`;
}

/** The dashboard card shows only the latest few activity rows (query-limited). */
const DASHBOARD_ACTIVITY_ROWS = 4;
/** The Activity screen pages 20 rows at a time ("Load more"). */
const ACTIVITY_PAGE = 20;

export default function App() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  /** An Android phone can install the native app — the link appears only there. */
  const isAndroid = useMemo(
    () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent),
    [],
  );
  // The app ALWAYS opens on the Dashboard — even from a /team-chat URL (the
  // owner asked; the chat deep link now only works through in-app navigation).
  // One exception: a tapped notification (?notify=1) opens the chat, because
  // that is a deliberate jump.
  const [view, setView] = useState<View>(() => {
    if (typeof window !== "undefined" && window.location.pathname === "/team-chat") {
      try {
        if (new URLSearchParams(window.location.search).has("notify")) return "team-chat";
      } catch {
        // fall through to the dashboard
      }
    }
    return "dashboard";
  });
  /** The room the FAB wants to open (set when exactly one thread is unread). */
  const [chatTargetRoom, setChatTargetRoom] = useState<string | null>(null);
  const unread = useSyncExternalStore(subscribeUnread, getUnread, getUnread);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState<Role>("staff");
  const [memberAccessUntil, setMemberAccessUntil] = useState("");
  const [teamTab, setTeamTab] = useState<"members" | "roles">("members");
  const [roleMatrix, setRoleMatrix] = useState<Record<Role, RolePermissions> | null>(null);
  const [rolesMsg, setRolesMsg] = useState<string | null>(null);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [teamStatus, setTeamStatus] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [approveRole, setApproveRole] = useState<Record<number, Role>>({});
  const [notifyEmails, setNotifyEmails] = useState("");
  const [notifySignup, setNotifySignup] = useState(true);
  const [notifyMember, setNotifyMember] = useState(true);
  const [notifyBill, setNotifyBill] = useState(true);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState<string | null>(null);
  /** Owner action: sign every member out at once (Phase 14). */
  const [logoutAllStatus, setLogoutAllStatus] = useState<string | null>(null);
  /** The notification system (Phase 15). */
  const [loginHistory, setLoginHistory] = useState<LoginEntry[]>([]);
  /** The member's switch for the "Welcome back" card (Phase 15 fix). */
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(true);
  const [welcomeBannerMsg, setWelcomeBannerMsg] = useState<string | null>(null);
  const [signedInElsewhere, setSignedInElsewhere] = useState<{
    browser?: string | null;
    os?: string | null;
    at?: string | null;
  } | null>(null);
  const [tourToStart, setTourToStart] = useState<string | null>(null);
  const [resendKey, setResendKey] = useState("");
  const [itemForm, setItemForm] = useState<{ id: number | null; name: string; unit: string; category: string; hsnCode: string; minStock: string; imageUrl: string } | null>(null);
  const [itemsMsg, setItemsMsg] = useState<string | null>(null);
  const [billCustomer, setBillCustomer] = useState({ name: "", phone: "", email: "", gstin: "" });
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [billMode, setBillMode] = useState("Cash");
  const [billGst, setBillGst] = useState("500");
  const [billDiscount, setBillDiscount] = useState("");
  const [billSaleExpenses, setBillSaleExpenses] = useState("");
  const [draft, setDraft] = useState({ itemId: "" as number | "", qty: "", rate: "", hsn: "" });
  const [billMargin, setBillMargin] = useState("6");
  const [billLines, setBillLines] = useState<{ itemId: number; name: string; unit: string; qtyBase: number; ratePaise: number; hsn: string; totalPaise: number }[]>([]);
  const [billMsg, setBillMsg] = useState<string | null>(null);
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [lastBillId, setLastBillId] = useState<number | null>(null);
  const [stats, setStats] = useState<{ today_sales: number; month_sales: number; month_profit: number; month_expenses: number; credit_paise: number; credit_bills: number; low_stock: number } | null>(null);
  const [purchasesList, setPurchasesList] = useState<PurchaseRow[]>([]);
  const [expensesList, setExpensesList] = useState<ExpenseRow[]>([]);
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);
  const [expenseEdit, setExpenseEdit] = useState({ date: "", type: "general", category: "", amount: "", paidTo: "", paymentMode: "Cash", note: "" });
  const [expenseEditSaving, setExpenseEditSaving] = useState(false);
  const [expenseEditError, setExpenseEditError] = useState<string | null>(null);
  const [roastingsList, setRoastingsList] = useState<RoastingRow[]>([]);
  const [roastForm, setRoastForm] = useState({
    rawItemId: "" as number | "",
    roastedItemId: "" as number | "",
    rawQty: "",
    yield: "1.200",
    charge: "",
    date: new Date().toISOString().slice(0, 10),
    margin: "6",
    note: "",
  });
  const [roastMsg, setRoastMsg] = useState<string | null>(null);
  const [roastSaving, setRoastSaving] = useState(false);
  const [stockEntries, setStockEntries] = useState<StockEntryRow[]>([]);
  const [purchase, setPurchase] = useState({ itemId: "" as number | "", qty: "", rate: "", supplier: "", expenses: "", date: new Date().toISOString().slice(0, 10) });
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRow | null>(null);
  const [purchaseEdit, setPurchaseEdit] = useState({ qty: "", rate: "", expenses: "", date: "", supplier: "", paymentMode: "Cash", note: "" });
  const [purchaseEditSaving, setPurchaseEditSaving] = useState(false);
  const [purchaseEditError, setPurchaseEditError] = useState<string | null>(null);
  const [purchaseMsg, setPurchaseMsg] = useState<string | null>(null);
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [stock, setStock] = useState({ itemId: "" as number | "", type: "USAGE", qty: "", note: "" });
  const [stockBatches, setStockBatches] = useState<Array<{ id: number; qty_remaining: number; unit_price_paise: number; purchase_date: string }>>([]);
  const [stockMsg, setStockMsg] = useState<string | null>(null);
  const [daily, setDaily] = useState<Array<{ date: string; sales: string; expenses: string }>>([]);
  const [categories, setCategories] = useState<Array<{ category: string; total: string }>>([]);
  const [rotation, setRotation] = useState<RotationSummary | null>(null);
  const [showLowStock, setShowLowStock] = useState(false);
  const [investments, setInvestments] = useState<Array<{ id: number; investor_name: string; amount_paise: number; invested_on: string; note: string | null }>>([]);
  const [investTotal, setInvestTotal] = useState(0);
  const [investment, setInvestment] = useState({ name: "", amount: "", date: new Date().toISOString().slice(0, 10), note: "" });
  const [investmentMsg, setInvestmentMsg] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState("");
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [expense, setExpense] = useState({ category: "", amount: "", paidTo: "", note: "", type: "general", date: new Date().toISOString().slice(0, 10) });
  const [expenseMsg, setExpenseMsg] = useState<string | null>(null);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [suppliersList, setSuppliersList] = useState<Array<{ id: number; name: string; phone: string | null }>>([]);
  const [supplierDuesList, setSupplierDuesList] = useState<Array<{ id: number; name: string; phone: string | null; total_purchased_paise: number; total_paid_paise: number; outstanding_paise: number }>>([]);
  const [supplierPaymentsList, setSupplierPaymentsList] = useState<Array<{ id: number; purchase_id: number; purchase_date: string; item_name: string; amount_paise: number; payment_date: string; payment_mode: string | null; note: string | null }>>([]);
  const [addSupplier, setAddSupplier] = useState({ name: "", phone: "" });
  const [addSupplierMsg, setAddSupplierMsg] = useState<string | null>(null);
  const [addSupplierBusy, setAddSupplierBusy] = useState(false);
  const [recordPayment, setRecordPayment] = useState({ purchaseId: "" as number | "", amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMode: "Cash", note: "" });
  const [recordPaymentMsg, setRecordPaymentMsg] = useState<string | null>(null);
  const [recordPaymentBusy, setRecordPaymentBusy] = useState(false);
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [lotItem, setLotItem] = useState<Item | null>(null);
  const [lotLedger, setLotLedger] = useState<BatchLedger | null>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const [lotError, setLotError] = useState<string | null>(null);
  const [expandedLot, setExpandedLot] = useState<number | null>(null);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [signupStatus, setSignupStatus] = useState<string | null>(null);
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [authShake, setAuthShake] = useState(false);
  const themeMode = useSyncExternalStore(subscribeMode, getMode, getMode);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [loginPhotoOk, setLoginPhotoOk] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerMsg, setCustomerMsg] = useState<string | null>(null);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState<{
    id: number | null;
    name: string;
    phone: string;
    email: string;
    gstin: string;
    address: string;
  } | null>(null);
  const [finYears, setFinYears] = useState<string[]>([]);
  const [finYear, setFinYear] = useState("");
  const [report, setReport] = useState<FinYearReport | null>(null);
  const [deals, setDeals] = useState<DealProfit[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [reportsMsg, setReportsMsg] = useState<string | null>(null);
  const [costingMethod, setCostingMethodState] = useState<"WAC" | "FIFO">("WAC");
  const [costingMsg, setCostingMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .loginHistory()
      .then((result) => setLoginHistory(result.logins))
      .catch(() => setLoginHistory([]));
    api
      .notifications()
      .then((result) => setShowWelcomeBanner(result.user.showWelcomeBanner ?? true))
      .catch(() => undefined);
  }, [user]);

  /** Settings → the "Show welcome message after login" toggle (saved in Neon). */
  async function saveWelcomeBanner(checked: boolean) {
    setShowWelcomeBanner(checked);
    setWelcomeBannerMsg(null);
    try {
      await api.setWelcomeBanner(checked);
      setWelcomeBannerMsg(
        checked ? "Welcome message on" : "Welcome message off — it will not show after login",
      );
    } catch (err) {
      setShowWelcomeBanner(!checked);
      setWelcomeBannerMsg(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        // A session restore (refresh, new tab) — NOT a login: no welcome
        // toast, no banner (the flag is only set by the login handler).
        setUser(user);
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  // Unread chat counts: pull once on sign-in, again on focus, and lightly on a
  // timer so the badges stay fresh without a page refresh.
  useEffect(() => {
    if (!user) return;
    void refreshUnread(user.id);
    const onFocus = () => void refreshUnread(user.id);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUnread(user.id);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refreshUnread(user.id), 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [user]);

  // The browser tab title mirrors the unread count, e.g. "(3) SDHHE …".
  useEffect(() => {
    const base = "SREE DURGA HARIHARA ENTERPRISES";
    document.title = unread.total > 0 ? `(${unread.total > 99 ? "99+" : unread.total}) ${base}` : base;
  }, [unread.total]);

  // The PWA taskbar badge (Android / Chrome) — setAppBadge where supported.
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    try {
      if (unread.total > 0) void (navigator as unknown as { setAppBadge: (n: number) => Promise<void> }).setAppBadge(unread.total);
      else void (navigator as unknown as { clearAppBadge: () => Promise<void> }).clearAppBadge();
    } catch {
      // Not supported in this browser — the in-app badges still work.
    }
  }, [unread.total]);

  /**
   * The session warning: five minutes before the half-hour idle timeout the
   * member gets a toast (the server signs them out after that).
   */
  useEffect(() => {
    if (!user) return;
    let lastActivity = Date.now();
    const mark = () => {
      lastActivity = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, mark, { passive: true });
    const timer = window.setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (idle >= 25 * 60_000) {
        showToast("Your session expires in 5 minutes — save what you are doing", "warning", 8000);
      }
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, mark);
    };
  }, [user]);

  useEffect(() => watchSystemTheme(), []);

  /** Sign out when the backend reports session expiry (inactivity / token expiry). */
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("sdhhe:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sdhhe:unauthorized", onUnauthorized);
  }, []);

  /**
   * The session ended because the member signed in on another device — the
   * backend says so in the error, and the window explains it.
   */
  useEffect(() => {
    const onUnauthorized = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason === "signed-in-elsewhere") {
        setSignedInElsewhere({});
        return;
      }
      setUser(null);
    };
    window.addEventListener("sdhhe:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sdhhe:unauthorized", onUnauthorized);
  }, []);

  /** Close the mobile drawer when the window grows into the desktop layout. */
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (wide.matches) setMenuOpen(false);
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  /** The financial years available for the FY selector. */
  useEffect(() => {
    if (!user || view !== "reports") return;
    let cancelled = false;
    api
      .finYears()
      .then((res) => {
        if (cancelled) return;
        setFinYears(res.finYears);
        setFinYear((current) => (current && res.finYears.includes(current) ? current : res.finYears[0] ?? ""));
      })
      .catch((err) => {
        if (!cancelled) setReportsMsg(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user, view]);

  /** Load the financial-year report for the selected FY. */
  useEffect(() => {
    if (!user || view !== "reports" || !finYear) return;
    let cancelled = false;
    (async () => {
      try {
        setReportsMsg(null);
        const [reportRes, dealsRes] = await Promise.all([
          api.finYearReport(finYear),
          api.dealProfits(finYear),
        ]);
        if (cancelled) return;
        setReport(reportRes.report);
        setDeals(dealsRes.deals);
      } catch (err) {
        if (!cancelled) setReportsMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, view, finYear]);

  /**
   * Load the activity feed whenever the Activity or Dashboard tab is opened —
   * otherwise a colleague's sign-in only appears after a full reload.
   * The Dashboard only asks for the latest 4 rows; the Activity screen fetches
   * its first page of 20 and offers "Load more".
   */
  useEffect(() => {
    if (!user || (view !== "activity" && view !== "dashboard")) return;
    let cancelled = false;
    const limit = view === "dashboard" ? DASHBOARD_ACTIVITY_ROWS : ACTIVITY_PAGE;
    api
      .activity(limit, 0)
      .then((res) => {
        if (cancelled) return;
        setActivity(res.activity);
        setActivityHasMore(view === "activity" && res.activity.length >= ACTIVITY_PAGE);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, view]);

  /**
   * The customer master (searchable) — used by the billing picker and the
   * Customers screen. It is reloaded whenever one of those screens opens, so a
   * client saved a moment ago is there straight away.
   */
  useEffect(() => {
    if (!user || (view !== "customers" && view !== "billing")) return;
    let cancelled = false;
    api
      .customers(customerSearch)
      .then((res) => {
        if (!cancelled) setCustomers(res.customers);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, view, customerSearch]);

  /** The costing method in force (WAC by default). */  useEffect(() => {
    if (!user || user.role !== "owner" || view !== "settings") return;
    let cancelled = false;
    api
      .costingMethod()
      .then((res) => {
        if (!cancelled) setCostingMethodState(res.method);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, view]);

  /** Owner-only usage metrics (sessions, active time, last login). */
  useEffect(() => {
    if (!user || !allowed(user.permissions, "team", "view") || view !== "team") return;
    let cancelled = false;
    api
      .usage()
      .then((res) => {
        if (!cancelled) setUsage(res.usage);
      })
      .catch(() => {
        if (!cancelled) setUsage([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, view]);

  // Load recent stock entries when the Stock Check tab opens.
  useEffect(() => {
    if (!user || view !== "stock") return;
    let cancelled = false;
    api
      .stockEntries()
      .then((res) => {
        if (!cancelled) setStockEntries(res.entries);
      })
      .catch(() => {
        if (!cancelled) setStockEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, view]);

  // Load the role matrix when the owner opens Team → Roles & permissions.
  useEffect(() => {
    if (!user || user.role !== "owner" || view !== "team" || teamTab !== "roles") return;
    let cancelled = false;
    api
      .roles()
      .then((res) => {
        if (!cancelled) {
          setRoleMatrix(res.roles);
          setRolesMsg(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setRolesMsg(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user, view, teamTab]);

  // Low-stock items (same rule as the stats query: stock left <= minimum).
  const lowStockItems = items.filter((item) => item.stockLeftBase <= item.minStockBase);
  const draftItem = items.find((item) => item.id === draft.itemId);
  const draftSuggestedPaise = Math.round(
    (draftItem?.avgCostPaise ?? 0) * (100 + (Number(billMargin) || 0)) / 100,
  );
  const lowStockCount = stats?.low_stock ?? 0;

  // This month's expenses from the list itself (works for roles without dashboard stats).
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const monthExpensesPaise = expensesList
    .filter((item) => item.date.slice(0, 7) === monthPrefix)
    .reduce((sum, item) => sum + item.amountPaise, 0);

  /** Permission check for the signed-in member (Owner is all-true from the API). */
  const can = (moduleKey: ModuleKey, action: PermissionAction): boolean =>
    allowed(user?.permissions, moduleKey, action);

  // If the signed-in role cannot view the current tab, jump to the first allowed one.
  useEffect(() => {
    if (!user) return;
    if (allowed(user.permissions, viewModule(view), "view")) return;
    const first = MODULES.find((moduleKey) => allowed(user.permissions, moduleKey, "view"));
    if (first) setView(first as View);
  }, [user, view]);

  // Message notifications are ON BY DEFAULT: right after the sign-in the app
  // asks for the permission once and subscribes. A member who answers "no" (or
  // turns them off) is never nagged again — the 🔔 in the Team Chat can always
  // switch them back on.
  useEffect(() => {
    if (!user || !pushSupported() || Notification.permission === "denied") return;
    if (pushAsked() && Notification.permission !== "granted") return;
    let cancelled = false;
    void (async () => {
      const firstAsk = !pushAsked();
      const outcome = await ensurePushSubscription();
      if (cancelled) return;
      if (firstAsk) {
        markPushAsked();
        if (outcome === "on") showToast("Message notifications are on", "success", 3000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /**
   * The Team Chat has its own URL (/team-chat) so it can be shared or opened
   * directly. The other screens keep their tab in the app state.
   */
  useEffect(() => {
    if (view === "team-chat") {
      if (window.location.pathname !== "/team-chat") {
        window.history.pushState({ view: "team-chat" }, "", "/team-chat");
      }
      return;
    }
    if (window.location.pathname === "/team-chat") {
      window.history.pushState({ view }, "", "/");
    }
  }, [view]);

  /** Back / forward between the chat and the rest of the app. */
  useEffect(() => {
    const onPop = () => {
      setView(window.location.pathname === "/team-chat" ? "team-chat" : "dashboard");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function addBillLine() {
    const item = items.find((i) => i.id === draft.itemId);
    if (!item) return;
    const qty = Number(draft.qty);
    const rate = Math.round(Number(draft.rate) * 100);
    if (!(qty > 0) || !(rate >= 0)) return;
    const factor = unitFactor(item.unit);
    const qtyBase = Math.round(qty * factor);
    setBillLines([...billLines, { itemId: item.id, name: item.name, unit: item.unit, qtyBase, ratePaise: rate, hsn: draft.hsn.trim() || item.hsnCode || "", totalPaise: Math.round((qtyBase * rate) / factor) }]);
    setDraft({ itemId: "", qty: "", rate: "", hsn: "" });
  }

  const billSubtotal = billLines.reduce((sum, l) => sum + l.totalPaise, 0);
  const billDiscountPaise = Math.round(Number(billDiscount || "0") * 100);
  const billTaxable = Math.max(0, billSubtotal - billDiscountPaise);
  const billGstPaise = Math.round((billTaxable * Number(billGst || "0")) / 10000);
  const billTotal = billTaxable + billGstPaise;

  // GST split: the first two digits of a GSTIN are the state code. Same state
  // as the shop → CGST + SGST; otherwise → IGST. When either GSTIN is missing
  // (unregistered buyer / B2C), default to intra-state — the printed invoice
  // always splits CGST + SGST, so the screen must match it.
  const shopStateCode = (shop?.gstin ?? "").trim().slice(0, 2).toUpperCase();
  const customerStateCode = (billCustomer.gstin ?? "").trim().slice(0, 2).toUpperCase();
  const gstIntraState =
    customerStateCode.length !== 2 ||
    shopStateCode.length !== 2 ||
    shopStateCode === customerStateCode;
  const gstRatePercent = Number(billGst || 0) / 100;
  const cgstPaise = Math.round(billGstPaise / 2);
  const sgstPaise = billGstPaise - cgstPaise;

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
    try {
      let customerId: number | undefined;
      if (billCustomer.name.trim()) {
        customerId = (await api.saveCustomer(billCustomer)).customer.id;
      }
      const res = await api.createBill({
        customerId,
        date: billDate,
        paymentMode: billMode,
        discountPaise: billDiscountPaise,
        saleExpensesPaise: Math.round(Number(billSaleExpenses || "0") * 100),
        gstPaise: billGstPaise,
        gstRateBp: Number(billGst),
        lines: billLines.map((l) => ({ itemId: l.itemId, qtyBase: l.qtyBase, unitPricePaise: l.ratePaise, hsnCode: l.hsn || undefined })),
      });
      setBillMsg(`Bill ${res.bill.billNo} created — ${money(res.bill.totalPaise)}`);
      setLastBillId(res.bill.saleId);
      setBillLines([]);
      setBillCustomer({ name: "", phone: "", email: "", gstin: "" });
      setBillDiscount("");
      setBillSaleExpenses("");
      setPickedCustomer(null);
      setCustomers((await api.customers(customerSearch)).customers);
      setBills((await api.bills()).bills);
      setItems((await api.items()).items);
    } catch (err) {
      setBillMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveItem() {
    if (!itemForm) return;
    setItemsMsg(null);
    try {
      const factor = unitFactor(itemForm.unit);
      const body = {
        name: itemForm.name,
        unit: itemForm.unit,
        category: itemForm.category,
        hsnCode: itemForm.hsnCode.trim() || undefined,
        minStockBase: Math.round((Number(itemForm.minStock) || 0) * factor),
        imageUrl: itemForm.imageUrl.trim(),
      };
      if (itemForm.id === null) await api.createItem(body);
      else await api.updateItem(itemForm.id, body);
      setItemForm(null);
      setItems((await api.items()).items);
      setItemsMsg("Saved");
    } catch (err) {
      setItemsMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const factorOf = unitFactor;
  const todayIso = () => new Date().toISOString().slice(0, 10);

  async function addPurchaseNow() {
    const item = items.find((i) => i.id === purchase.itemId);
    if (!item || purchaseSaving) return;
    setPurchaseSaving(true);
    setPurchaseMsg(null);
    try {
      await api.addPurchase({
        itemId: item.id,
        qty: Number(purchase.qty),
        unitPricePaise: Math.round(Number(purchase.rate) * 100),
        expensesPaise: Math.round(Number(purchase.expenses || "0") * 100),
        date: purchase.date || todayIso(),
        supplierName: purchase.supplier,
        paymentMode: "Cash",
      });
      setPurchaseMsg("Purchase saved");
      setPurchase({ itemId: "", qty: "", rate: "", supplier: "", expenses: "", date: todayIso() });
      setItems((await api.items()).items);
      setPurchasesList((await api.purchases()).purchases);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
    } catch (err) {
      setPurchaseMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPurchaseSaving(false);
    }
  }

  function openPurchaseEdit(row: PurchaseRow) {
    setPurchaseMsg(null);
    setPurchaseEditError(null);
    setEditingPurchase(row);
    setPurchaseEdit({
      qty: String(row.qty_base / unitFactor(row.unit)),
      rate: String(row.unit_price_paise / 100),
      expenses: String(row.expenses_paise / 100),
      date: dateInputValue(row.purchase_date),
      supplier: row.supplier_name ?? "",
      paymentMode: row.payment_mode ?? "Cash",
      note: row.note ?? "",
    });
  }

  async function savePurchaseEdit() {
    if (!editingPurchase || purchaseEditSaving) return;
    setPurchaseEditError(null);
    setPurchaseEditSaving(true);
    try {
      await api.updatePurchase(editingPurchase.id, {
        qty: Number(purchaseEdit.qty),
        unitPricePaise: Math.round(Number(purchaseEdit.rate) * 100),
        expensesPaise: Math.round(Number(purchaseEdit.expenses || "0") * 100),
        date: purchaseEdit.date || todayIso(),
        supplierName: purchaseEdit.supplier,
        paymentMode: purchaseEdit.paymentMode,
        note: purchaseEdit.note,
      });
      setEditingPurchase(null);
      setPurchasesList((await api.purchases()).purchases);
      setItems((await api.items()).items);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
      setPurchaseMsg("Purchase updated");
    } catch (err) {
      setPurchaseEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setPurchaseEditSaving(false);
    }
  }

  async function pickStockItem(id: number | "") {
    setStock({ ...stock, itemId: id });
    setStockMsg(null);
    if (id === "") return setStockBatches([]);
    setStockBatches((await api.batches(id)).batches);
  }

  async function openLots(item: Item) {
    setLotItem(item);
    setLotLedger(null);
    setLotError(null);
    setExpandedLot(null);
    setLotLoading(true);
    try {
      const { ledger } = await api.batchLedger(item.id);
      setLotLedger(ledger);
    } catch (err) {
      setLotError(err instanceof Error ? err.message : String(err));
    } finally {
      setLotLoading(false);
    }
  }

  async function saveStockNow() {
    const item = items.find((i) => i.id === stock.itemId);
    if (!item) return;
    setStockMsg(null);
    try {
      const base = Math.round(Number(stock.qty) * factorOf(item.unit));
      await api.saveStock({
        itemId: item.id,
        type: stock.type,
        qty: stock.type === "STOCK_CHECK" ? null : base,
        enteredLeft: stock.type === "STOCK_CHECK" ? base : null,
        date: todayIso(),
        note: stock.note,
      });
      setStockMsg("Stock entry saved");
      setStock({ itemId: "", type: "USAGE", qty: "", note: "" });
      setStockBatches([]);
      setItems((await api.items()).items);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
      setStockEntries((await api.stockEntries()).entries);
    } catch (err) {
      setStockMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function addInvestmentNow() {
    setInvestmentMsg(null);
    try {
      await api.addInvestment({
        investorName: investment.name,
        amountPaise: Math.round(Number(investment.amount) * 100),
        date: investment.date,
        note: investment.note,
      });
      setInvestmentMsg("Investment saved");
      setInvestment({ name: "", amount: "", date: new Date().toISOString().slice(0, 10), note: "" });
      const r = await api.investments();
      setInvestments(r.investments);
      setInvestTotal(r.totalPaise);
    } catch (err) {
      setInvestmentMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeInvestment(id: number) {
    await api.deleteInvestment(id);
    const r = await api.investments();
    setInvestments(r.investments);
    setInvestTotal(r.totalPaise);
  }

  function customerPayload() {
    if (!customerForm) return null;
    const name = customerForm.name.trim();
    if (!name) {
      setCustomerMsg("Customer name is required");
      return null;
    }
    return {
      name,
      ...(customerForm.phone.trim() ? { phone: customerForm.phone.trim() } : {}),
      ...(customerForm.email.trim() ? { email: customerForm.email.trim() } : {}),
      ...(customerForm.gstin.trim() ? { gstin: customerForm.gstin.trim() } : {}),
      ...(customerForm.address.trim() ? { address: customerForm.address.trim() } : {}),
    };
  }

  /** Create only — never updates an existing row. */
  async function createCustomerNow() {
    if (!customerForm || customerSaving) return;
    setCustomerMsg(null);
    const body = customerPayload();
    if (!body) return;
    setCustomerSaving(true);
    try {
      await api.createCustomer(body);
      setCustomerMsg(`${body.name} created`);
      setCustomerForm(null);
      setCustomers((await api.customers(customerSearch)).customers);
    } catch (err) {
      setCustomerMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomerSaving(false);
    }
  }

  /** Update the customer currently being edited. */
  async function updateCustomerNow() {
    if (!customerForm || customerForm.id === null || customerSaving) return;
    setCustomerMsg(null);
    const body = customerPayload();
    if (!body) return;
    setCustomerSaving(true);
    try {
      await api.updateCustomer(customerForm.id, body);
      setCustomerMsg(`${body.name} updated`);
      setCustomerForm(null);
      setCustomers((await api.customers(customerSearch)).customers);
    } catch (err) {
      setCustomerMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomerSaving(false);
    }
  }

  async function addExpenseNow() {
    if (expenseSaving) return;
    setExpenseSaving(true);
    setExpenseMsg(null);
    try {
      await api.addExpense({
        category: expense.category,
        expenseType: expense.type,
        amountPaise: Math.round(Number(expense.amount) * 100),
        date: expense.date || todayIso(),
        paymentMode: "Cash",
        paidTo: expense.paidTo,
        note: expense.note,
      });
      setExpenseMsg("Expense saved");
      setExpense({ category: "", amount: "", paidTo: "", note: "", type: "general", date: todayIso() });
      setExpensesList((await api.expenses()).expenses);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
      setCategories((await api.expenseCategories()).categories);
    } catch (err) {
      setExpenseMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExpenseSaving(false);
    }
  }

  function openExpenseEdit(x: ExpenseRow) {
    setExpenseMsg(null);
    setExpenseEditError(null);
    setEditingExpense(x);
    setExpenseEdit({
      date: dateInputValue(x.date),
      type: x.expenseType,
      category: x.category,
      amount: String(x.amountPaise / 100),
      paidTo: x.paidTo ?? "",
      paymentMode: x.paymentMode ?? "Cash",
      note: x.note ?? "",
    });
  }

  async function saveExpenseEdit() {
    if (!editingExpense || expenseEditSaving) return;
    setExpenseEditSaving(true);
    setExpenseEditError(null);
    try {
      await api.updateExpense(editingExpense.id, {
        category: expenseEdit.category,
        expenseType: expenseEdit.type,
        amountPaise: Math.round(Number(expenseEdit.amount) * 100),
        date: expenseEdit.date || todayIso(),
        paymentMode: expenseEdit.paymentMode,
        paidTo: expenseEdit.paidTo,
        note: expenseEdit.note,
        relatedSaleId: editingExpense.relatedSaleId,
        relatedPurchaseId: editingExpense.relatedPurchaseId,
      });
      setEditingExpense(null);
      setExpensesList((await api.expenses()).expenses);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
      setCategories((await api.expenseCategories()).categories);
      setExpenseMsg("Expense updated");
    } catch (err) {
      setExpenseEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setExpenseEditSaving(false);
    }
  }

  async function deleteExpenseRow(x: { id: number; category: string; amountPaise: number }) {
    if (!window.confirm(`Delete ${x.category} expense of ${money(x.amountPaise)}?`)) return;
    try {
      await api.deleteExpense(x.id);
      setExpensesList((await api.expenses()).expenses);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
      setCategories((await api.expenseCategories()).categories);
      setExpenseMsg("Expense deleted");
    } catch (err) {
      setExpenseMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function roastPreview() {
    const raw = items.find((item) => item.id === roastForm.rawItemId);
    const roasted = items.find((item) => item.id === roastForm.roastedItemId);
    if (!raw || !roasted) return null;
    const rawQty = Number(roastForm.rawQty);
    const yieldValue = Number(roastForm.yield);
    if (!(rawQty > 0) || !(yieldValue > 0)) return null;
    const rawQtyBase = Math.round(rawQty * unitFactor(raw.unit));
    const rawCost = Math.round((rawQtyBase * raw.avgCostPaise) / unitFactor(raw.unit));
    try {
      return planRoast({
        rawQtyBase,
        yieldBp: Math.round(yieldValue * 10000),
        chargePerKgPaise: Math.round((Number(roastForm.charge) || 0) * 100),
        rawCostPaise: rawCost,
        marginBp: Math.round((Number(roastForm.margin) || 0) * 100),
      });
    } catch {
      return null;
    }
  }

  async function saveRoasting() {
    if (roastSaving) return;
    setRoastMsg(null);
    if (roastForm.rawItemId === "" || roastForm.roastedItemId === "") {
      setRoastMsg("Choose both the raw and roasted items");
      return;
    }
    if (roastForm.rawItemId === roastForm.roastedItemId) {
      setRoastMsg("Raw and roasted items must be different");
      return;
    }
    setRoastSaving(true);
    try {
      const res = await api.createRoasting({
        rawItemId: roastForm.rawItemId,
        roastedItemId: roastForm.roastedItemId,
        rawQty: Number(roastForm.rawQty),
        yieldBp: Math.round((Number(roastForm.yield) || 0) * 10000),
        chargePerKgPaise: Math.round((Number(roastForm.charge) || 0) * 100),
        date: roastForm.date || todayIso(),
        marginBp: Math.round((Number(roastForm.margin) || 0) * 100),
        note: roastForm.note,
      });
      const roastedUnit = items.find((item) => item.id === roastForm.roastedItemId)?.unit ?? "kg";
      setRoastMsg(
        `Roasted ${qty(res.roasting.roastedQtyBase, roastedUnit)} — cost ${money(res.roasting.totalCostPaise)} (${money(res.roasting.costPerKgPaise)}/kg), suggested ${money(res.roasting.suggestedPricePaise)}/kg`,
      );
      setRoastForm({ ...roastForm, rawQty: "", charge: "", note: "" });
      setItems((await api.items()).items);
      setRoastingsList((await api.roastings()).roastings);
      void api.stats().then((r) => setStats(r.stats)).catch(() => {});
    } catch (err) {
      setRoastMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRoastSaving(false);
    }
  }

  async function addSupplierNow() {
    setAddSupplierBusy(true);
    setAddSupplierMsg(null);
    try {
      await api.createSupplier({ name: addSupplier.name, phone: addSupplier.phone || undefined });
      setAddSupplier({ name: "", phone: "" });
      setSuppliersList((await api.suppliers()).suppliers);
      setSupplierDuesList((await api.supplierDues()).dues);
    } catch (err) {
      setAddSupplierMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setAddSupplierBusy(false);
    }
  }

  async function recordSupplierPaymentNow() {
    setRecordPaymentBusy(true);
    setRecordPaymentMsg(null);
    try {
      const purchaseId = Number(recordPayment.purchaseId);
      const amountPaise = Math.round(Number(recordPayment.amount) * 100);
      if (!Number.isInteger(purchaseId) || purchaseId <= 0) throw new Error("Select a purchase");
      if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error("Enter a valid amount");
      await api.recordSupplierPayment({
        purchaseId,
        amountPaise,
        paymentDate: recordPayment.paymentDate,
        paymentMode: recordPayment.paymentMode,
        note: recordPayment.note || undefined,
      });
      setRecordPayment({ purchaseId: "" as number | "", amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMode: "Cash", note: "" });
      setSupplierDuesList((await api.supplierDues()).dues);
      setSupplierPaymentsList((await api.supplierPayments()).payments);
    } catch (err) {
      setRecordPaymentMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRecordPaymentBusy(false);
    }
  }

  async function loadNotify() {
    const cfg = await api.notifySettings();
    setNotifyEmails(cfg.emails.join(", "));
    setNotifySignup(cfg.signup);
    setNotifyMember(cfg.member);
    setNotifyBill(cfg.bill);
    setEmailConfigured(cfg.emailConfigured);
  }

  async function loadMembers() {
    setMembers((await api.users()).users);
  }

  useEffect(() => {
    if (!user) return;
    const canView = (moduleKey: ModuleKey) => allowed(user.permissions, moduleKey, "view");
    if (canView("team")) {
      void loadMembers().catch(() => setMembers([]));
    }
    if (canView("settings")) {
      void loadNotify().catch(() => setNotifyStatus("Could not load notification settings"));
    }
    const jobs: Promise<unknown>[] = [
      api.shop().then((r) => setShop(r.shop as unknown as ShopDetails)),
    ];
    if (canView("dashboard")) {
      jobs.push(api.statsDaily().then((r) => setDaily(r.daily)));
      jobs.push(api.stats().then((r) => setStats(r.stats)));
      jobs.push(api.rotation().then((r) => setRotation(r.rotation)));
    }
    if (canView("expenses")) {
      jobs.push(api.expenseCategories().then((r) => setCategories(r.categories)));
      jobs.push(api.expenses().then((r) => setExpensesList(r.expenses)));
    }
    if (canView("stock")) {
      jobs.push(api.roastings().then((r) => setRoastingsList(r.roastings)));
    }
    if (canView("suppliers")) {
      jobs.push(api.suppliers().then((r) => setSuppliersList(r.suppliers)));
      jobs.push(api.supplierDues().then((r) => setSupplierDuesList(r.dues)));
      jobs.push(api.supplierPayments().then((r) => setSupplierPaymentsList(r.payments)));
    }
    if (canView("investments")) {
      jobs.push(api.investments().then((r) => { setInvestments(r.investments); setInvestTotal(r.totalPaise); }));
    }
    if (canView("purchases")) jobs.push(api.purchases().then((r) => setPurchasesList(r.purchases)));
    if (canView("bills")) jobs.push(api.bills().then((r) => setBills(r.bills)));
    if (canView("items")) jobs.push(api.items().then((r) => setItems(r.items)));
    void Promise.allSettled(jobs);
  }, [user]);

  /** The Activity screen: fetch the next page of 20 rows and append it. */
  async function loadMoreActivity() {
    setActivityBusy(true);
    try {
      const res = await api.activity(ACTIVITY_PAGE, activity.length);
      setActivity((rows) => [
        ...rows,
        ...res.activity.filter((row) => !rows.some((existing) => existing.id === row.id)),
      ]);
      setActivityHasMore(res.activity.length >= ACTIVITY_PAGE);
    } catch {
      /* keep what is already loaded */
    } finally {
      setActivityBusy(false);
    }
  }

  /** The Activity screen's Refresh button: start again from the newest row. */
  async function refreshActivity() {
    setActivityBusy(true);
    try {
      const res = await api.activity(ACTIVITY_PAGE, 0);
      setActivity(res.activity);
      setActivityHasMore(res.activity.length >= ACTIVITY_PAGE);
    } catch {
      /* keep what is already loaded */
    } finally {
      setActivityBusy(false);
    }
  }

  async function requestAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSignupStatus(null);
    if (signupPassword !== signupConfirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.signup(signupName, signupPhone, signupPassword);
      setSignupStatus("Request sent — the owner must approve this account before you can sign in.");
      setSignupName("");
      setSignupPhone("");
      setSignupPassword("");
      setSignupConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(phone, password);
      setUser(user);
      // The one-time welcome flag: only a real login sets it (never a
      // refresh / tab change / new tab — the host consumes it once).
      setWelcomeFlag();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Shake the auth form on a bad phone or wrong credentials. */
  function shakeAuth() {
    setAuthShake(true);
    window.setTimeout(() => setAuthShake(false), 450);
  }

  /** Mobile login: client-side phone validation, then the same API call. */
  async function mobileSubmitLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const check = normalizePhone(phone);
    if (!check.valid) {
      setPhoneError(check.reason);
      shakeAuth();
      return;
    }
    setPhoneError(null);
    setBusy(true);
    try {
      const { user } = await api.login(check.phone, password);
      setUser(user);
      setWelcomeFlag();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      shakeAuth();
    } finally {
      setBusy(false);
    }
  }

  /** Mobile create-account: validation, then the same signup request. */
  async function mobileSubmitSignup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSignupStatus(null);
    const check = normalizePhone(signupPhone);
    if (!check.valid) {
      setPhoneError(check.reason);
      shakeAuth();
      return;
    }
    setPhoneError(null);
    if (signupPassword !== signupConfirm) {
      setError("Passwords do not match");
      shakeAuth();
      return;
    }
    setBusy(true);
    try {
      await api.signup(signupName, check.phone, signupPassword);
      setSignupStatus("Request sent — the owner must approve this account before you can sign in.");
      setSignupName("");
      setSignupPhone("");
      setSignupPassword("");
      setSignupConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      shakeAuth();
    } finally {
      setBusy(false);
    }
  }

  async function saveNotify() {
    setNotifyStatus(null);
    try {
      await api.saveNotifySettings({
        emails: notifyEmails,
        signup: notifySignup,
        member: notifyMember,
        bill: notifyBill,
        ...(resendKey.trim() ? { resendApiKey: resendKey.trim() } : {}),
      });
      setResendKey("");
      await loadNotify();
      setNotifyStatus("Notification settings saved");
    } catch (err) {
      setNotifyStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function testNotify() {
    setNotifyStatus("Sending test…");
    try {
      const r = await api.testNotify();
      setNotifyStatus(`Test email sent to ${(r.to ?? []).join(", ")}`);
    } catch (err) {
      setNotifyStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function addMember() {
    setTeamStatus(null);
    try {
      await api.addUser(memberName, memberPhone, memberPassword, memberRole, memberAccessUntil || undefined);
      setTeamStatus("Member added");
      setMemberName("");
      setMemberPhone("");
      setMemberPassword("");
      setMemberRole("staff");
      setMemberAccessUntil("");
      await loadMembers();
    } catch (err) {
      setTeamStatus(err instanceof Error ? err.message : String(err));
    }
  }

  function togglePermission(role: "ca" | "staff", moduleKey: ModuleKey, action: PermissionAction) {
    setRoleMatrix((current) => {
      if (!current) return current;
      return {
        ...current,
        [role]: {
          ...current[role],
          [moduleKey]: {
            ...current[role][moduleKey],
            [action]: !current[role][moduleKey][action],
          },
        },
      };
    });
  }

  async function saveRoles() {
    if (!roleMatrix) return;
    setRolesSaving(true);
    setRolesMsg(null);
    try {
      const ca = await api.saveRolePermissions("ca", roleMatrix.ca);
      const staff = await api.saveRolePermissions("staff", roleMatrix.staff);
      setRoleMatrix({ owner: roleMatrix.owner, ca: ca.permissions, staff: staff.permissions });
      setRolesMsg("Permissions saved");
    } catch (err) {
      setRolesMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRolesSaving(false);
    }
  }

  async function saveResetPassword() {
    if (!resetTarget) return;
    try {
      await api.resetUserPassword(resetTarget.id, resetPassword);
      setTeamStatus(`Password reset for ${resetTarget.name}`);
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setTeamStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleMember(member: Member) {
    try {
      await api.setUserActive(member.id, !member.active);
      setTeamStatus(`${member.name} ${member.active ? "disabled" : "enabled"}`);
      await loadMembers();
    } catch (err) {
      setTeamStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function emailBill(id: number) {
    setEmailStatus("Sending…");
    try {
      const result = await api.emailBill(id);
      setEmailStatus(`Emailed to ${result.to}`);
    } catch (err) {
      setEmailStatus(err instanceof Error ? err.message : String(err));
    }
  }

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
      setAiMessages((m) => [...m, { role: "assistant", content: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setAiBusy(false);
    }
  }

  function whatsappBill(bill: BillDetail, shopName: string) {
    const link = buildWhatsAppLink(bill.customerPhone, billWhatsAppText(bill, shopName));
    if (!link) {
      setEmailStatus("Add the customer's phone in the bill first");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    setEmailStatus("WhatsApp opened — press Send");
  }

  async function openBill(id: number) {
    setError(null);
    try {
      setBill((await api.bill(id)).bill);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (checking) {
    return (
      <main className="grid min-h-viewport place-items-center">
        <LoadingMark />
      </main>
    );
  }

  if (!user) {
    const resolved = resolveTheme(themeMode);
    return (
      <>
      {/* MOBILE: bottom-sheet auth (max-width 767px only) */}
      <main className="md:hidden">
        <div className="auth-screen">
          <div className="auth-hero">
            <button
              type="button"
              aria-label={`Theme: ${resolved === "dark" ? "Dark" : resolved === "contrast" ? "Contrast" : "Light"}`}
              className="auth-theme-btn"
              onClick={() =>
                setMode(resolved === "light" ? "dark" : resolved === "dark" ? "contrast" : "light")
              }
            >
              {resolved === "dark" ? (
                <IconMoon size={20} />
              ) : resolved === "contrast" ? (
                <IconContrast size={20} />
              ) : (
                <IconSun size={20} />
              )}
            </button>
            <span className="auth-logo">
              <IconCoffeeNav size={30} />
            </span>
            <h1 className="auth-brand">
              SREE DURGA HARIHARA
              <br />
              ENTERPRISES
            </h1>
            <p className="auth-tagline">Billing, stock &amp; accounts for the shop</p>
          </div>

          <div className={`auth-sheet ${authShake ? "auth-shake" : ""}`}>
            {authMode === "login" ? (
              <form className="auth-form" onSubmit={mobileSubmitLogin} noValidate>
                <div className="auth-head">
                  <h2 className="auth-heading">Welcome back</h2>
                  <p className="auth-subtitle">Sign in to continue</p>
                </div>
                <div className="auth-fields">
                  <div>
                    <label className="label" htmlFor="m-phone">Phone number</label>
                    <div className={`auth-input ${phoneError ? "has-error" : ""}`}>
                      <span className="prefix">+91</span>
                      <input
                        id="m-phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={10}
                        placeholder="10-digit mobile"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.currentTarget.value.replace(/\D/g, "").slice(0, 10));
                          setPhoneError(null);
                        }}
                      />
                    </div>
                    {phoneError && <p className="auth-field-error" role="alert">{phoneError}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="m-password">Password</label>
                    <div className={`auth-input ${error ? "has-error" : ""}`}>
                      <input
                        id="m-password"
                        type={showLoginPw ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        className="peek"
                        aria-label={showLoginPw ? "Hide password" : "Show password"}
                        onClick={() => setShowLoginPw((v) => !v)}
                      >
                        {showLoginPw ? <IconEyeOff size={18} /> : <IconEyeOpen size={18} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="auth-forgot"
                      onClick={() => showToast("Ask the shop owner to reset your password")}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>
                {error && <p className="auth-field-error" role="alert">{error}</p>}
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? <IconLoader size={20} className="animate-spin" /> : "Sign in"}
                </button>
                <button
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode("signup");
                    setError(null);
                    setPhoneError(null);
                    setSignupStatus(null);
                  }}
                >
                  New here? Create account
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={mobileSubmitSignup} noValidate>
                <div className="auth-head">
                  <h2 className="auth-heading">Create account</h2>
                  <p className="auth-subtitle">Join the team</p>
                </div>
                <div className="auth-fields">
                  <div>
                    <label className="label" htmlFor="m-name">Your name</label>
                    <div className="auth-input">
                      <input
                        id="m-name"
                        autoComplete="name"
                        value={signupName}
                        onChange={(e) => setSignupName(e.currentTarget.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="m-sphone">Phone number</label>
                    <div className={`auth-input ${phoneError ? "has-error" : ""}`}>
                      <span className="prefix">+91</span>
                      <input
                        id="m-sphone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={10}
                        placeholder="10-digit mobile"
                        value={signupPhone}
                        onChange={(e) => {
                          setSignupPhone(e.currentTarget.value.replace(/\D/g, "").slice(0, 10));
                          setPhoneError(null);
                        }}
                      />
                    </div>
                    {phoneError && <p className="auth-field-error" role="alert">{phoneError}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="m-spassword">Password (6+)</label>
                    <div className="auth-input">
                      <input
                        id="m-spassword"
                        type={showSignupPw ? "text" : "password"}
                        autoComplete="new-password"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.currentTarget.value)}
                      />
                      <button
                        type="button"
                        className="peek"
                        aria-label={showSignupPw ? "Hide password" : "Show password"}
                        onClick={() => setShowSignupPw((v) => !v)}
                      >
                        {showSignupPw ? <IconEyeOff size={18} /> : <IconEyeOpen size={18} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="m-confirm">Confirm password</label>
                    <div className={`auth-input ${error ? "has-error" : ""}`}>
                      <input
                        id="m-confirm"
                        type={showSignupPw ? "text" : "password"}
                        autoComplete="new-password"
                        value={signupConfirm}
                        onChange={(e) => setSignupConfirm(e.currentTarget.value)}
                      />
                    </div>
                  </div>
                </div>
                {error && <p className="auth-field-error" role="alert">{error}</p>}
                {signupStatus && (
                  <p className="auth-field-error" role="status" style={{ color: "var(--c-success-ink)" }}>
                    {signupStatus}
                  </p>
                )}
                <button className="auth-submit" type="submit" disabled={busy}>
                  {busy ? <IconLoader size={20} className="animate-spin" /> : "Request account"}
                </button>
                <button
                  type="button"
                  className="auth-switch"
                  onClick={() => {
                    setAuthMode("login");
                    setError(null);
                    setPhoneError(null);
                  }}
                >
                  Already have an account? Sign in
                </button>
              </form>
            )}
          </div>
        </div>
      </main>

      {/* DESKTOP: split-screen card (unchanged) */}
      <main className="hidden min-h-viewport md:grid md:grid-cols-2">
        {/* Left: the café photo with a brown gradient overlay (desktop only) */}
        <div className="relative hidden overflow-hidden bg-[#4a3325] md:block">
          {loginPhotoOk ? (
            <img
              src="/assets/login-bg.webp"
              alt=""
              loading="eager"
              decoding="async"
              onError={() => setLoginPhotoOk(false)}
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(160deg, rgba(58,40,28,0.92) 0%, rgba(74,51,37,0.78) 45%, rgba(28,22,18,0.94) 100%)",
            }}
          />
          <div className="relative flex h-full flex-col justify-between p-10 text-[#F7F1E8]">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#F7F1E8]/15 text-[#F7F1E8]">
                <IconCoffeeNav size={22} />
              </span>
              <p className="text-[12px] font-semibold uppercase leading-[1.4] tracking-[0.14em]">
                SREE DURGA HARIHARA
                <br />
                ENTERPRISES
              </p>
            </div>
            <div>
              <p className="font-display text-3xl leading-tight text-[#F7F1E8]">Billing, stock &amp; accounts</p>
              <p className="mt-2 max-w-sm text-sm text-[#E0D2C4]">
                Every bill, purchase and expense in one place — with live profit and turnover for the
                financial year.
              </p>
            </div>
          </div>
        </div>

        {/* Right: the form */}
        <div className="flex items-center justify-center bg-bg px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="card w-full max-w-sm p-6">
            <div className="mb-6">
              {/* On mobile the logo sits above the form (the photo panel is hidden). */}
              <span className="mb-3 grid size-10 place-items-center rounded-xl bg-primary text-on-primary md:hidden">
                <IconCoffeeNav />
              </span>
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-[13px] font-semibold uppercase leading-snug tracking-wide">
                  SREE DURGA HARIHARA ENTERPRISES
                </h1>
                <ThemeToggle />
              </div>
              <p className="mt-1 text-sm text-muted">Sign in to the web edition.</p>
            </div>
          {authMode === "login" ? (
            <form className="space-y-4" onSubmit={signIn}>
              <div>
                <label className="label" htmlFor="phone">Phone number</label>
                <input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} autoFocus />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              </div>
              {error && <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{error}</p>}
              <button className="btn btn-primary w-full" type="submit" disabled={busy}>Sign in</button>
              <button type="button" className="w-full text-sm text-muted underline" onClick={() => { setAuthMode("signup"); setError(null); setSignupStatus(null); }}>
                Create account
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={requestAccount}>
              <div>
                <label className="label" htmlFor="signup-name">Your name</label>
                <input id="signup-name" className="input" value={signupName} onChange={(e) => setSignupName(e.currentTarget.value)} autoFocus />
              </div>
              <div>
                <label className="label" htmlFor="signup-phone">Phone number</label>
                <input id="signup-phone" className="input" value={signupPhone} onChange={(e) => setSignupPhone(e.currentTarget.value)} />
              </div>
              <div>
                <label className="label" htmlFor="signup-password">Password (6+)</label>
                <input id="signup-password" type="password" className="input" value={signupPassword} onChange={(e) => setSignupPassword(e.currentTarget.value)} />
              </div>
              <div>
                <label className="label" htmlFor="signup-confirm">Confirm password</label>
                <input id="signup-confirm" type="password" className="input" value={signupConfirm} onChange={(e) => setSignupConfirm(e.currentTarget.value)} />
              </div>
              {error && <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{error}</p>}
              {signupStatus && <p role="status" className="rounded bg-success-soft px-3 py-2 text-sm text-success-ink">{signupStatus}</p>}
              <button className="btn btn-primary w-full" type="submit" disabled={busy}>Request account</button>
              <button type="button" className="w-full text-sm text-muted underline" onClick={() => { setAuthMode("login"); setError(null); }}>
                Back to sign in
              </button>
            </form>
          )}
          </div>
        </div>
      </main>
      </>
    );
  }

  const allNavGroups: {
    heading: string | null;
    links: { key: View; label: string; icon: ReactNode; module?: ModuleKey }[];
  }[] = [
    {
      heading: null,
      links: [{ key: "dashboard", label: "Dashboard", icon: <IconDashboard size={16} /> }],
    },
    {
      heading: "Sales",
      links: [
        { key: "billing", label: "New Bill", icon: <IconBill size={16} /> },
        { key: "bills", label: "Invoices", icon: <IconInvoice size={16} /> },
      ],
    },
    {
      heading: "Inventory",
      links: [
        { key: "items", label: "Items", icon: <IconItems size={16} /> },
        { key: "purchases", label: "Purchases", icon: <IconPurchases size={16} /> },
        { key: "roasting", label: "Roasting", icon: <IconStock size={16} />, module: "stock" },
        { key: "stock", label: "Stock Check", icon: <IconStock size={16} /> },
      ],
    },
    {
      heading: "Contacts",
      links: [{ key: "customers", label: "Customers", icon: <IconTeam size={16} /> }],
    },
    {
      heading: "Team",
      links: [{ key: "team-chat", label: "Team Chat", icon: <IconUsers size={16} />, module: "chat" }],
    },
    {
      heading: "Money",
      links: [
        { key: "expenses", label: "Expenses", icon: <IconExpenses size={16} /> },
        { key: "suppliers", label: "Supplier Dues", icon: <IconPurchases size={16} /> },
        { key: "investments", label: "Investments", icon: <IconInvestments size={16} /> },
        { key: "reports", label: "Reports", icon: <IconReports size={16} /> },
      ],
    },
    {
      heading: "Admin",
      links: [
        { key: "activity", label: "Activity", icon: <IconActivity size={16} /> },
        { key: "team", label: "Team", icon: <IconTeam size={16} /> },
        { key: "settings", label: "Settings", icon: <IconSettings size={16} /> },
      ],
    },
  ];

  // Only show tabs the signed-in role can view.
  const navGroups = allNavGroups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => can(link.module ?? viewModule(link.key), "view")),
    }))
    .filter((group) => group.links.length > 0);

  return (
    <>
      {/* The toast host is always there (it is the global way of telling the
          member that something happened). */}
      <ToastHost />
      {/* Everything that is due after a sign-in — one thing at a time. The
          banners sit above the app shell so they are full width. */}
      <div className="px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-6">
        <NotificationsHost
          signedInElsewhere={signedInElsewhere}
          startTour={tourToStart}
          onTourStarted={() => setTourToStart(null)}
        />
      </div>
      <div className="min-h-viewport md:flex">
      {/* Desktop: the rail is sticky and exactly one viewport tall, so it stays put
          while only the main content scrolls. The nav scrolls internally when the
          links outgrow the screen; the footer stays pinned at the bottom. */}
      <aside className="nav-texture sticky top-0 hidden h-viewport w-60 shrink-0 self-start flex-col bg-nav px-3 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] text-nav-text md:flex">
        <div className="relative z-10 mb-6 flex items-start gap-3 px-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-nav-text/15 text-nav-text">
            <IconCoffeeNav />
          </span>
          <p className="min-w-0 flex-1 text-[10px] font-semibold uppercase leading-[1.35] tracking-[0.12em] text-nav-text">
            SREE DURGA HARIHARA
            <br />
            ENTERPRISES
          </p>
        </div>
        <nav className="thin-scrollbar relative z-10 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {navGroups.map((group, groupIndex) => (
            <div key={group.heading ?? `group-${groupIndex}`}>
              {group.heading ? (
                <p className="mb-1 px-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-nav-muted/80">
                  {group.heading}
                </p>
              ) : null}
              <div className="flex flex-col gap-0.5">
                {group.links.map((link) => (
                  <button
                    key={link.key}
                    data-tour={link.key === "team-chat" ? "team-chat" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition-colors ${
                      view === link.key
                        ? "border-accent bg-nav-active font-medium text-nav-text shadow-sm"
                        : "border-transparent text-nav-muted hover:bg-nav-hover hover:text-nav-text"
                    }`}
                    onClick={() => { setView(link.key); setBill(null); }}
                  >
                    <span className="shrink-0 opacity-90">{link.icon}</span>
                    {link.label}
                    {link.key === "team-chat" && unread.total > 0 && (
                      <span className="unread-badge ml-auto">
                        {unread.total > 99 ? "99+" : unread.total}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="relative z-10 mt-auto shrink-0 space-y-3 px-2 pt-6 text-[11px]">
          <ThemeToggle onDark />
          {isAndroid && (
            <a
              href="/sdhhe.apk"
              download="SDHHE.apk"
              className="block rounded-lg bg-nav-text/10 px-3 py-2 text-center text-[11px] font-medium text-nav-text transition-colors hover:bg-nav-text/20"
            >
              📲 Install the Android app
            </a>
          )}
          <div className="space-y-1">
            <p className="text-nav-muted">{user.name} · {user.role}</p>
            <button
              className="underline text-nav-muted"
              onClick={() =>
                void api.logout().then(() => {
                  clearWelcomeFlag();
                  setUser(null);
                })
              }
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile: icon-only header + a side drawer that opens when the menu is tapped */}
      <div className="md:hidden">
        {/* The top bar is 3.5rem tall + the notch inset; the chat page's
            height calc in styles.css (.chat-shell) counts on exactly this. */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-nav px-3 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] text-nav-text">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-nav-text/15 text-nav-text">
              <IconCoffeeNav size={22} />
            </span>
            {/* The full brand name crowds tiny phones — a short mark from 360px
                up, the icon alone below that. The theme switch moved into the
                drawer so the header keeps only menu + sign out. */}
            <p className="hidden min-w-0 text-xs font-semibold uppercase tracking-[0.12em] min-[360px]:block">
              SDHHE
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="tap-44 relative grid size-11 place-items-center rounded-lg text-nav-text hover:bg-nav-hover"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
              {!menuOpen && unread.total > 0 && <span className="unread-dot" aria-hidden="true" />}
            </button>
            <button
              type="button"
              aria-label="Sign out"
              className="tap-44 grid size-11 place-items-center rounded-lg text-nav-text hover:bg-nav-hover"
              onClick={() =>
                void api.logout().then(() => {
                  clearWelcomeFlag();
                  setUser(null);
                })
              }
            >
              <IconSignOut size={19} />
            </button>
          </div>
        </header>

        {menuOpen ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 cursor-default bg-[#1C1612]/50"
              onClick={() => setMenuOpen(false)}
            />
            <aside className="nav-texture thin-scrollbar fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto bg-nav px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-nav-text">
              <div className="relative z-10 mb-5 flex items-start gap-3 px-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-nav-text/15 text-nav-text">
                  <IconCoffeeNav />
                </span>
                <p className="min-w-0 flex-1 text-[10px] font-semibold uppercase leading-[1.35] tracking-[0.12em]">
                  SREE DURGA HARIHARA
                  <br />
                  ENTERPRISES
                </p>
              </div>
              <nav className="relative z-10 flex flex-col gap-4">
                {navGroups.map((group, groupIndex) => (
                  <div key={group.heading ?? `drawer-${groupIndex}`}>
                    {group.heading ? (
                      <p className="mb-1 px-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-nav-muted/80">
                        {group.heading}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-0.5">
                      {group.links.map((link) => (
                        <button
                          key={link.key}
                          data-tour={link.key === "team-chat" ? "team-chat" : undefined}
                          className={`tap-44 flex items-center gap-2.5 rounded-lg border-l-2 px-3 py-2.5 text-left text-sm transition-colors ${
                            view === link.key
                              ? "border-accent bg-nav-active font-medium text-nav-text shadow-sm"
                              : "border-transparent text-nav-muted hover:bg-nav-hover hover:text-nav-text"
                          }`}
                          onClick={() => {
                            setView(link.key);
                            setBill(null);
                            setMenuOpen(false);
                          }}
                        >
                          <span className="shrink-0 opacity-90">{link.icon}</span>
                          {link.label}
                          {link.key === "team-chat" && unread.total > 0 && (
                            <span className="unread-badge ml-auto">
                              {unread.total > 99 ? "99+" : unread.total}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
              <div className="relative z-10 mt-auto space-y-2 px-2 pt-6 text-[11px]">
                {isAndroid && (
                  <a
                    href="/sdhhe.apk"
                    download="SDHHE.apk"
                    className="block rounded-lg bg-nav-text/10 px-3 py-2 text-center text-[11px] font-medium text-nav-text transition-colors hover:bg-nav-text/20"
                  >
                    📲 Install the Android app
                  </a>
                )}
                <ThemeToggle onDark />
                <p className="text-nav-muted">{user.name} · {user.role}</p>
                <button
                  className="flex items-center gap-1.5 text-nav-muted underline"
                  onClick={() =>
                void api.logout().then(() => {
                  clearWelcomeFlag();
                  setUser(null);
                })
              }
                >
                  <IconSignOut size={14} /> Sign out
                </button>
              </div>
            </aside>
          </>
        ) : null}
      </div>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">
        {error && <p role="alert" className="mb-4 rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{error}</p>}

        {view === "dashboard" && (
          <>
          <section className="card space-y-3 p-4" data-testid="web-ai-chat">
            <h2 className="text-lg font-semibold tracking-tight">Ask AI</h2>
            <div className="max-h-72 space-y-2 overflow-y-auto text-sm" data-testid="web-ai-messages">
              {aiMessages.length === 0 && (
                <p className="text-muted">Ask anything read-only about your shop — sales, stock, expenses.</p>
              )}
              {aiMessages.map((m, i) => (
                <p key={i} className={m.role === "user" ? "text-right" : ""}>
                  <span className={"inline-block rounded-lg px-3 py-1.5 " + (m.role === "user" ? "bg-surface-2" : "bg-surface-3")}>
                    {m.content}
                  </span>
                </p>
              ))}
              {aiBusy && (
                <p>
                  <span className="inline-block animate-pulse rounded-lg bg-surface-3 px-3 py-1.5">
                    Thinking… (reading your data — can take up to a minute)
                  </span>
                </p>
              )}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void askAi(); }}>
              <input
                className="input flex-1"
                value={aiInput}
                onChange={(e) => setAiInput(e.currentTarget.value)}
                placeholder="e.g. total sales this month?"
                aria-label="Ask AI"
              />
              <button className="btn btn-primary" type="submit" disabled={aiBusy}>
                {aiBusy ? "Asking…" : "Ask"}
              </button>
            </form>
          </section>
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight md:text-2xl">
                  <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
                  Dashboard
                </h1>
                <p className="mt-0.5 text-xs text-muted">Sales, stock, expenses and money in rotation — live.</p>
              </div>
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
              {[
                {
                  label: "Today's sales",
                  value: money(stats?.today_sales ?? 0),
                  hint: "",
                  icon: <IconIndianRupee size={16} />,
                  tone: "bg-accent-soft text-accent-ink",
                },
                {
                  label: "This month",
                  value: money(stats?.month_sales ?? 0),
                  hint: "",
                  icon: <IconBarChart size={16} />,
                  tone: "bg-secondary-soft text-secondary-ink",
                },
                {
                  label: "Month profit",
                  value: money(stats?.month_profit ?? 0),
                  hint: "",
                  icon: <IconInvestments size={16} />,
                  tone: "bg-success-soft text-success-ink",
                },
                {
                  label: "Month expenses",
                  value: money(stats?.month_expenses ?? 0),
                  hint: "",
                  icon: <IconExpenses size={16} />,
                  tone: "bg-error-soft text-error-ink",
                },
                {
                  label: "Credit given",
                  value: money(stats?.credit_paise ?? 0),
                  hint: `${stats?.credit_bills ?? 0} unpaid bills`,
                  icon: <IconBill size={16} />,
                  tone: "bg-accent-soft text-accent-ink",
                },
              ].map((card) => (
                <div key={card.label} className="card card-hover p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{card.label}</p>
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${card.tone}`}>
                      {card.icon}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{card.value}</p>
                  {card.hint ? <p className="mt-0.5 text-[11px] text-muted">{card.hint}</p> : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setShowLowStock((open) => !open)}
                aria-expanded={showLowStock}
                className={`card card-hover p-4 text-left transition ${
                  lowStockCount > 0 ? "border-accent bg-accent-soft" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Low stock items</p>
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${lowStockCount > 0 ? "bg-accent text-on-primary" : "bg-surface-2 text-muted"}`}>
                    <IconStock size={16} />
                  </span>
                </div>
                <p className={`mt-2 text-2xl font-semibold tracking-tight ${lowStockCount > 0 ? "text-accent-ink" : ""}`}>
                  {lowStockCount}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">{lowStockCount > 0 ? "View items" : "All good"}</p>
              </button>
            </div>

            {rotation && (
              <section className="space-y-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                    <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
                    Working capital &amp; rotation
                  </h2>
                  <p className="text-xs text-muted">
                    This month to date · as of {formatDate(rotation.asOfDate)}
                  </p>
                </div>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
                  <div className="card card-hover p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Amount in rotation</p>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink"><IconExpenses size={16} /></span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{money(rotation.amountInRotationPaise)}</p>
                    <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-muted">
                      <span>Stock<br /><span className="font-medium text-ink">{money(rotation.stockValuePaise)}</span></span>
                      <span>Cash<br /><span className="font-medium text-ink">{money(rotation.cashInBankPaise)}</span></span>
                      <span>Credit<br /><span className="font-medium text-ink">{money(rotation.creditOutstandingPaise)}</span></span>
                    </div>
                  </div>
                  <div className="card card-hover p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Rotation this month</p>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary-soft text-secondary-ink"><IconRefresh size={16} /></span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{rotation.rotationTimes.toFixed(2)}×</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {rotation.daysToRotate === null ? "No sales yet" : `${rotation.daysToRotate.toFixed(1)} days to rotate`}
                    </p>
                  </div>
                  <div className="card card-hover p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Inventory turnover</p>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary"><IconStock size={16} /></span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{rotation.inventoryTurnover.toFixed(2)}×</p>
                    <p className="mt-0.5 text-[11px] text-muted">COGS ÷ stock value</p>
                  </div>
                  <div className="card card-hover p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Net profit (after expenses)</p>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success-soft text-success-ink"><IconInvestments size={16} /></span>
                    </div>
                    <p className={`mt-2 text-2xl font-semibold tracking-tight ${rotation.netProfitPaise < 0 ? "text-error-ink" : ""}`}>
                      {money(rotation.netProfitPaise)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Gross {money(rotation.grossProfitPaise)} − expenses {money(rotation.expensesPaise)}
                    </p>
                  </div>
                  <div className="card card-hover p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Stock value</p>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary"><IconItems size={16} /></span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{money(rotation.stockValuePaise)}</p>
                    <p className="mt-0.5 text-[11px] text-muted">At batch cost</p>
                  </div>
                  <div className="card card-hover p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Cash in bank</p>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink"><IconBanknote size={16} /></span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight">{money(rotation.cashInBankPaise)}</p>
                    <p className="mt-0.5 text-[11px] text-muted">From the cash ledger</p>
                  </div>
                </div>
                <div className="card p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium">Rotation trend (net sales, last 30 days)</h2>
                  </div>
                  <RotationChart data={rotation.trend} />
                </div>
              </section>
            )}

            {showLowStock && (
              <ResponsiveTable
                title="Low stock items"
                headerRight={<button className="btn-mini" onClick={() => setShowLowStock(false)}>Close</button>}
                rows={lowStockItems}
                rowKey={(item) => item.id}
                minWidthClass="min-w-[520px]"
                widths={["w-[50%]", "w-[25%]", "w-[25%]"]}
                columns={[
                  { key: "item", header: "Item", cell: (item) => <span className="font-medium">{item.name}</span> },
                  { key: "stock", header: "Stock left", align: "right", cell: (item) => <span className="text-accent-ink">{qty(item.stockLeftBase, item.unit)}</span> },
                  { key: "min", header: "Minimum", align: "right", cell: (item) => qty(item.minStockBase, item.unit) },
                ]}
                empty={<p className="text-sm text-muted">All items are above their minimum stock.</p>}
              />
            )}

            {/* Quick add expense — one row, defaults to general. */}
            {can("expenses", "create") && (
            <div className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium">Quick expense</h2>
                <button className="btn-mini" onClick={() => setView("expenses")}>Full form →</button>
              </div>
              <div className="grid items-stretch gap-2 sm:grid-cols-[2fr_1fr_auto]">
                <input
                  className="input"
                  placeholder="Category (e.g. Rent, Tea)"
                  value={expense.category}
                  onChange={(e) => setExpense({ ...expense, category: e.currentTarget.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") void addExpenseNow(); }}
                />
                <input
                  className="input"
                  type="number"
                  placeholder="Amount ₹"
                  value={expense.amount}
                  onChange={(e) => setExpense({ ...expense, amount: e.currentTarget.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") void addExpenseNow(); }}
                />
                <button className="btn btn-primary h-full whitespace-nowrap" disabled={expenseSaving} onClick={() => void addExpenseNow()}>
                  <span className="flex items-center gap-1.5"><IconPlus size={15} /> {expenseSaving ? "Adding…" : "Add"}</span>
                </button>
              </div>
              {expenseMsg && <p role="status" className="mt-2 text-sm text-muted">{expenseMsg}</p>}
            </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card flex flex-col p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium">Last 14 days</h2>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-chart-1" /> Sales</span>
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-chart-5" /> Expenses</span>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <SalesChart data={daily} />
                </div>
              </div>
              <div className="card p-4">
                <h2 className="mb-3 text-sm font-medium">Expenses by category (month)</h2>
                {categories.length === 0 ? (
                  <EmptyState
                    compact
                    illustration="expenses"
                    title="No expenses this month"
                    message="Add rent, transport or any other cost to see the split."
                    actionLabel={can("expenses", "create") ? "Add expense" : undefined}
                    onAction={can("expenses", "create") ? () => setView("expenses") : undefined}
                  />
                ) : (
                  <Donut items={categories.map((c) => ({ label: c.category, value: Number(c.total) }))} />
                )}
              </div>
            </div>
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-medium">Recent activity</h2>
              <ul className="divide-y divide-line text-sm">
                {activity.slice(0, DASHBOARD_ACTIVITY_ROWS).map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                    <span>{row.summary}</span>
                    <span className="flex items-baseline gap-1.5 text-xs">
                      <span className="text-muted opacity-70">{row.actor}</span>
                      <span className="text-muted opacity-50">· {relativeTime(row.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {can("activity", "view") && (
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    className="text-xs text-muted underline hover:text-ink"
                    onClick={() => setView("activity")}
                  >
                    View all activity →
                  </button>
                </div>
              )}
            </div>
          </section>
          </>
        )}

        {view === "reports" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Profit &amp; turnover</h1>
                <p className="text-sm text-muted">
                  {report ? `Financial year ${report.finYear} · ${formatDate(report.startDate)} to ${formatDate(report.endDate)}` : "Pick a financial year."}
                </p>
              </div>
              <select className="input max-w-44" value={finYear} onChange={(e) => setFinYear(e.currentTarget.value)}>
                {finYears.map((year) => (
                  <option key={year} value={year}>
                    FY {year}
                  </option>
                ))}
              </select>
            </div>
            {reportsMsg && <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{reportsMsg}</p>}
            {report && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Turnover", money(report.turnoverPaise), `${report.salesCount} deals`],
                    ["Total purchases", money(report.totalPurchasesPaise), `stock ${money(report.purchaseValuePaise)} + ${money(report.purchaseExpensesPaise)}`],
                    ["Gross profit", money(report.grossProfitPaise), `after COGS ${money(report.cogsPaise)}`],
                    ["Net profit", money(report.netProfitPaise), `sales ${money(report.saleExpensesPaise)} · general ${money(report.generalExpensesPaise)}`],
                  ].map(([label, value, hint]) => (
                    <div key={label} className="card p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
                      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
                    </div>
                  ))}
                </div>

                <ResponsiveTable
                  rows={deals}
                  rowKey={(deal) => deal.saleId}
                  minWidthClass="min-w-[720px]"
                  widths={["w-[10%]", "w-[12%]", "w-[18%]", "w-[12%]", "w-[11%]", "w-[11%]", "w-[10%]", "w-[10%]", "w-[6%]"]}
                  columns={[
                    { key: "deal", header: "Deal", cell: (deal) => <span className="font-medium">{deal.billNo}</span> },
                    { key: "date", header: "Date", cell: (deal) => formatDate(deal.date), className: "whitespace-nowrap" },
                    { key: "customer", header: "Customer", cell: (deal) => deal.customerName ?? "Walk-in" },
                    { key: "sale", header: "Sale value", align: "right", cell: (deal) => money(deal.saleValuePaise) },
                    { key: "cogs", header: "COGS", align: "right", cell: (deal) => money(deal.cogsPaise) },
                    { key: "gross", header: "Gross", align: "right", cell: (deal) => money(deal.grossProfitPaise) },
                    { key: "saleExp", header: "Sale exp.", align: "right", cell: (deal) => money(deal.saleExpensesPaise) },
                    { key: "net", header: "Net profit", align: "right", cell: (deal) => <span className="font-medium">{money(deal.netProfitPaise)}</span> },
                    {
                      key: "percent",
                      header: "%",
                      align: "right",
                      cell: (deal) => <span className={`badge ${deal.profitPercent >= 0 ? "badge-ok" : "badge-bad"}`}>{deal.profitPercent}%</span>,
                    },
                  ]}
                  empty={<p className="text-sm text-muted">No deals in this financial year.</p>}
                />

                <ResponsiveTable
                  title="Closing stock"
                  headerRight={<span className="text-sm text-muted">{money(report.closingStockValuePaise)}</span>}
                  rows={report.closingStock.filter((row) => row.qtyBase > 0)}
                  rowKey={(row) => row.itemId}
                  minWidthClass="min-w-[520px]"
                  widths={["w-[40%]", "w-[20%]", "w-[20%]", "w-[20%]"]}
                  columns={[
                    { key: "item", header: "Item", cell: (row) => <span className="font-medium">{row.name}</span> },
                    { key: "qty", header: "Quantity", align: "right", cell: (row) => qty(row.qtyBase, row.unit) },
                    { key: "avg", header: "Avg cost", align: "right", cell: (row) => money(row.avgCostPaise) },
                    { key: "value", header: "Value", align: "right", cell: (row) => money(row.valuePaise) },
                  ]}
                  empty={<p className="text-sm text-muted">No stock on hand.</p>}
                />
              </>
            )}
          </section>
        )}

        {view === "customers" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Customers</h1>
                <p className="text-sm text-muted">Saved client details — picked by name when you bill.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input max-w-52"
                  placeholder="Search name, phone, GSTIN…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.currentTarget.value)}
                />
                {can("customers", "create") && (
                  <button
                    className="btn btn-primary whitespace-nowrap"
                    onClick={() => setCustomerForm({ id: null, name: "", phone: "", email: "", gstin: "", address: "" })}
                  >
                    <span className="flex items-center gap-1.5"><IconPlus size={15} /> Add customer</span>
                  </button>
                )}
              </div>
            </div>
            {customerForm && (
              <div className="card max-w-3xl space-y-3 p-4">
                <h2 className="text-sm font-medium">{customerForm.id === null ? "Add customer" : "Edit customer"}</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="input" placeholder="Customer name *" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.currentTarget.value })} />
                  <input className="input" placeholder="Phone" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.currentTarget.value })} />
                  <input className="input" placeholder="Email" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.currentTarget.value })} />
                  <input className="input" placeholder="GSTIN (optional — leave blank if no GST)" value={customerForm.gstin} onChange={(e) => setCustomerForm({ ...customerForm, gstin: e.currentTarget.value.toUpperCase() })} />
                  <input className="input sm:col-span-2" placeholder="Address" value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.currentTarget.value })} />
                </div>
                {customerMsg && <p role="status" className="rounded bg-surface-2 px-3 py-2 text-sm text-muted">{customerMsg}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-primary"
                    disabled={customerSaving}
                    onClick={() => void (customerForm.id === null ? createCustomerNow() : updateCustomerNow())}
                  >
                    {customerSaving ? "Saving…" : customerForm.id === null ? "Create customer" : "Update customer"}
                  </button>
                  <button className="btn-mini" disabled={customerSaving} onClick={() => setCustomerForm(null)}>Cancel</button>
                  <span className="text-xs text-muted">
                    GSTIN is optional. Saved clients are matched by phone or GSTIN — saving again updates the same record.
                  </span>
                </div>
              </div>
            )}
            <ResponsiveTable
              rows={customers}
              rowKey={(customer) => customer.id}
              minWidthClass="min-w-[720px]"
              widths={["w-[22%]", "w-[14%]", "w-[16%]", "w-[9%]", "w-[13%]", "w-[12%]", "w-[14%]"]}
              columns={[
                {
                  key: "customer",
                  header: "Customer",
                  cell: (customer) => (
                    <span className="flex items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary-soft text-[11px] font-semibold text-secondary-ink">
                        {customer.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium">{customer.name}</span>
                    </span>
                  ),
                },
                { key: "phone", header: "Phone", cell: (customer) => customer.phone ?? "—" },
                { key: "gstin", header: "GSTIN", cell: (customer) => customer.gstin ?? "—" },
                { key: "bills", header: "Bills", align: "right", cell: (customer) => customer.billCount },
                { key: "billed", header: "Billed", align: "right", cell: (customer) => money(customer.billedPaise) },
                {
                  key: "credit",
                  header: "Credit",
                  align: "right",
                  cell: (customer) =>
                    customer.creditPaise > 0 ? (
                      <span className="badge badge-warn">{money(customer.creditPaise)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  mobileLabel: "Actions",
                  cell: (customer) => (
                    <span className="flex flex-wrap justify-end gap-2">
                      {can("customers", "edit") && (
                        <button
                          className="btn-mini"
                          onClick={() =>
                            setCustomerForm({
                              id: customer.id,
                              name: customer.name,
                              phone: customer.phone ?? "",
                              email: customer.email ?? "",
                              gstin: customer.gstin ?? "",
                              address: customer.address ?? "",
                            })
                          }
                        >
                          Edit
                        </button>
                      )}
                      {can("customers", "delete") && (
                        <button
                          className="btn-mini btn-mini-danger"
                          onClick={async () => {
                            if (!window.confirm(`Remove ${customer.name} from the customer master?`)) return;
                            try {
                              await api.deleteCustomer(customer.id);
                              setCustomers((await api.customers(customerSearch)).customers);
                              setCustomerMsg(`${customer.name} removed`);
                            } catch (err) {
                              setCustomerMsg(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  illustration="invoices"
                  title="No customers yet"
                  message="Client details are saved automatically when you bill them."
                  actionLabel={can("billing", "create") ? "New bill" : undefined}
                  onAction={can("billing", "create") ? () => { setView("billing"); setBill(null); } : undefined}
                />
              }
            />
            {customerMsg && <p role="status" className="text-sm text-muted">{customerMsg}</p>}
          </section>
        )}

        {view === "purchases" && (() => {
          const purchaseRatePaise = Math.round(Number(purchase.rate || "0") * 100);
          const purchaseQty = Number(purchase.qty || "0");
          const purchaseTotalPaise = purchaseQty > 0 ? Math.round(purchaseQty * purchaseRatePaise) : 0;
          return (
            <section className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Purchases</h1>
                <p className="text-sm text-muted">Record stock you buy from suppliers.</p>
              </div>

              <div className="card p-4">
                <FormRow desktop="min-[1200px]:grid-cols-[1fr_2fr_1fr_1fr_1fr_1.2fr_auto]">
                  <div className="space-y-1">
                    <label className="label">Date</label>
                    <input
                      className="input"
                      type="date"
                      value={purchase.date}
                      onChange={(e) => setPurchase({ ...purchase, date: e.currentTarget.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Item</label>
                    <div className="relative">
                      <IconPackage size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <select className="input input-icon" value={purchase.itemId} onChange={(e) => setPurchase({ ...purchase, itemId: e.currentTarget.value === "" ? "" : Number(e.currentTarget.value) })}>
                        <option value="">Choose item…</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Qty</label>
                    <div className="relative">
                      <IconScale size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input className="input input-icon" type="number" placeholder="0" value={purchase.qty} onChange={(e) => setPurchase({ ...purchase, qty: e.currentTarget.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Rate ₹</label>
                    <div className="relative">
                      <IconIndianRupee size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input className="input input-icon" type="number" placeholder="0" value={purchase.rate} onChange={(e) => setPurchase({ ...purchase, rate: e.currentTarget.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Transport ₹</label>
                    <div className="relative">
                      <IconTruck size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input className="input input-icon" type="number" placeholder="0" value={purchase.expenses} onChange={(e) => setPurchase({ ...purchase, expenses: e.currentTarget.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Supplier</label>
                    <div className="relative">
                      <IconStore size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input className="input input-icon" placeholder="Supplier" value={purchase.supplier} onChange={(e) => setPurchase({ ...purchase, supplier: e.currentTarget.value })} />
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:col-span-full sm:flex-row sm:items-center min-[1200px]:col-span-1 min-[1200px]:flex-col min-[1200px]:items-stretch">
                    <span className="whitespace-nowrap text-sm text-muted">
                      Total: <span className="font-semibold text-ink">{money(purchaseTotalPaise)}</span>
                    </span>
                    {can("purchases", "create") && (
                      <button className="btn btn-primary w-full whitespace-nowrap min-[1200px]:w-auto" onClick={() => void addPurchaseNow()} disabled={purchaseSaving}>
                        {purchaseSaving ? "Saving…" : "Save purchase"}
                      </button>
                    )}
                  </div>
                </FormRow>
                {purchaseMsg && <p role="status" className="mt-2 text-sm text-muted">{purchaseMsg}</p>}
              </div>

              <ResponsiveTable
                title="Recent purchases"
                rows={purchasesList}
                rowKey={(p) => p.id}
                minWidthClass="min-w-[900px]"
                widths={user?.role === "owner"
                  ? ["w-[10%]", "w-[22%]", "w-[10%]", "w-[12%]", "w-[10%]", "w-[13%]", "w-[10%]", "w-[13%]"]
                  : ["w-[12%]", "w-[24%]", "w-[12%]", "w-[14%]", "w-[12%]", "w-[15%]", "w-[11%]"]}
                columns={[
                  { key: "date", header: "Date", cell: (p) => formatDate(p.purchase_date), className: "whitespace-nowrap" },
                  { key: "item", header: "Item", cell: (p) => <span className="font-medium">{p.name}</span> },
                  { key: "qty", header: "Qty", align: "right", cell: (p) => qty(p.qty_base, p.unit) },
                  { key: "rate", header: "Rate/kg", align: "right", cell: (p) => money(p.unit_price_paise) },
                  { key: "transport", header: "Transport", align: "right", cell: (p) => money(p.expenses_paise) },
                  { key: "supplier", header: "Supplier", cell: (p) => p.supplier_name ?? "—" },
                  { key: "total", header: "Total", align: "right", cell: (p) => money(p.total_paise) },
                  ...(user?.role === "owner"
                    ? [
                        {
                          key: "actions",
                          header: "",
                          align: "right" as const,
                          mobileLabel: "Actions",
                          hideOnMobile: true,
                          cell: (p: PurchaseRow) => (
                            <button className="btn-mini" onClick={() => openPurchaseEdit(p)}>
                              Edit
                            </button>
                          ),
                        },
                      ]
                    : []),
                ]}
                empty={
                  <EmptyState
                    illustration="purchases"
                    title="No purchases yet"
                    message="Record what you buy — the weighted-average cost is updated automatically."
                  />
                }
              />

              {editingPurchase && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1C1612]/50 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-4">
                  <div className="card max-h-viewport-85 w-full max-w-lg space-y-3 overflow-y-auto p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-semibold tracking-tight">Edit purchase — {editingPurchase.name}</h2>
                      <button className="btn-mini" disabled={purchaseEditSaving} onClick={() => setEditingPurchase(null)}>Close</button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="label">Date</label>
                        <input className="input" type="date" value={purchaseEdit.date} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, date: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Supplier</label>
                        <input className="input" placeholder="Supplier name" list="purchase-supplier-options" value={purchaseEdit.supplier} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, supplier: e.currentTarget.value })} />
                        <datalist id="purchase-supplier-options">
                          {suppliersList.map((s) => <option key={s.id} value={s.name} />)}
                        </datalist>
                      </div>
                      <div className="space-y-1">
                        <label className="label">Qty ({editingPurchase.unit})</label>
                        <input className="input" type="number" value={purchaseEdit.qty} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, qty: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Rate ₹ / {editingPurchase.unit}</label>
                        <input className="input" type="number" value={purchaseEdit.rate} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, rate: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Transport ₹</label>
                        <input className="input" type="number" value={purchaseEdit.expenses} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, expenses: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Payment mode</label>
                        <select className="input" value={purchaseEdit.paymentMode} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, paymentMode: e.currentTarget.value })}>
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Card">Card</option>
                          <option value="Credit">Credit</option>
                        </select>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <label className="label">Note</label>
                        <input className="input" placeholder="Note" value={purchaseEdit.note} onChange={(e) => setPurchaseEdit({ ...purchaseEdit, note: e.currentTarget.value })} />
                      </div>
                    </div>
                    {purchaseEditError && (
                      <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{purchaseEditError}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button className="btn-mini" disabled={purchaseEditSaving} onClick={() => setEditingPurchase(null)}>Cancel</button>
                      <button className="btn btn-primary" disabled={purchaseEditSaving} onClick={() => void savePurchaseEdit()}>
                        {purchaseEditSaving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })()}

        {view === "roasting" && can("stock", "view") && (() => {
          const weightItems = items.filter((item) => item.unit === "kg" || item.unit === "60 kg bag");
          const raw = items.find((item) => item.id === roastForm.rawItemId);
          const roasted = items.find((item) => item.id === roastForm.roastedItemId);
          const preview = roastPreview();
          const rawQtyBase = raw ? Math.round((Number(roastForm.rawQty) || 0) * unitFactor(raw.unit)) : 0;
          const rawCostEstimate = raw ? Math.round((rawQtyBase * raw.avgCostPaise) / unitFactor(raw.unit)) : 0;
          const suggestedPerUnit = preview && roasted
            ? Math.round((preview.suggestedPricePaise * unitFactor(roasted.unit)) / 1000)
            : 0;
          return (
            <section className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Roasting</h1>
                <p className="text-sm text-muted">
                  Convert raw seeds to roasted seeds. Standard yield 1.200 kg raw → 1 kg roasted; the charge is ₹ per kg roasted.
                </p>
              </div>

              <div className="card p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <label className="label">Raw item</label>
                    <select className="input" value={roastForm.rawItemId} onChange={(e) => setRoastForm({ ...roastForm, rawItemId: e.currentTarget.value === "" ? "" : Number(e.currentTarget.value) })}>
                      <option value="">Choose raw…</option>
                      {weightItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Roasted item</label>
                    <select className="input" value={roastForm.roastedItemId} onChange={(e) => setRoastForm({ ...roastForm, roastedItemId: e.currentTarget.value === "" ? "" : Number(e.currentTarget.value) })}>
                      <option value="">Choose roasted…</option>
                      {weightItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="label">Raw qty ({raw?.unit ?? "unit"})</label>
                    <input className="input" type="number" placeholder="0" value={roastForm.rawQty} onChange={(e) => setRoastForm({ ...roastForm, rawQty: e.currentTarget.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Yield (raw ÷ roasted)</label>
                    <input className="input" type="number" step="0.001" value={roastForm.yield} onChange={(e) => setRoastForm({ ...roastForm, yield: e.currentTarget.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Roasting ₹ / kg roasted</label>
                    <input className="input" type="number" placeholder="0" value={roastForm.charge} onChange={(e) => setRoastForm({ ...roastForm, charge: e.currentTarget.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Date</label>
                    <input className="input" type="date" value={roastForm.date} onChange={(e) => setRoastForm({ ...roastForm, date: e.currentTarget.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Margin % (suggested price)</label>
                    <input className="input" type="number" value={roastForm.margin} onChange={(e) => setRoastForm({ ...roastForm, margin: e.currentTarget.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Note</label>
                    <input className="input" placeholder="Optional" value={roastForm.note} onChange={(e) => setRoastForm({ ...roastForm, note: e.currentTarget.value })} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    Create the roasted product in Items first (e.g. ROASTED {raw?.name ?? "…"}).
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-mini"
                      onClick={() => {
                        setView("items");
                        setItemForm({
                          id: null,
                          name: raw ? `ROASTED ${raw.name}` : "",
                          unit: raw?.unit ?? "kg",
                          category: raw?.category ?? "",
                          hsnCode: raw?.hsnCode ?? "",
                          minStock: "",
                          imageUrl: "",
                        });
                      }}
                    >
                      Add roasted item
                    </button>
                    <button className="btn btn-primary" disabled={roastSaving} onClick={() => void saveRoasting()}>
                      {roastSaving ? "Saving…" : "Save roasting"}
                    </button>
                  </div>
                </div>
                {roastMsg && <p role="status" className="mt-2 text-sm text-muted">{roastMsg}</p>}
              </div>

              {preview && (
                <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Roasted output</p>
                    <p className="mt-1 font-semibold">{roasted ? qty(preview.roastedQtyBase, roasted.unit) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Raw cost (est.)</p>
                    <p className="mt-1 font-semibold">{money(rawCostEstimate)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Roasting charge</p>
                    <p className="mt-1 font-semibold">{money(preview.chargePaise)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Total cost</p>
                    <p className="mt-1 font-semibold">{money(preview.totalCostPaise)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Cost / kg</p>
                    <p className="mt-1 font-semibold">{money(preview.costPerKgPaise)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Suggested / {roasted?.unit ?? "unit"}</p>
                    <p className="mt-1 font-semibold text-accent-ink">{money(suggestedPerUnit)}</p>
                  </div>
                </div>
              )}

              <ResponsiveTable
                title="Roasting history"
                rows={roastingsList}
                rowKey={(row) => row.id}
                minWidthClass="min-w-[860px]"
                widths={["w-[10%]", "w-[18%]", "w-[18%]", "w-[8%]", "w-[10%]", "w-[11%]", "w-[10%]", "w-[15%]"]}
                columns={[
                  { key: "date", header: "Date", cell: (row) => formatDate(row.roastDate), className: "whitespace-nowrap" },
                  { key: "raw", header: "Raw", cell: (row) => `${row.rawItemName} · ${qty(row.rawQtyBase, row.rawUnit)}` },
                  { key: "roasted", header: "Roasted", cell: (row) => `${row.roastedItemName} · ${qty(row.roastedQtyBase, row.roastedUnit)}` },
                  { key: "yield", header: "Yield", align: "right", cell: (row) => (row.yieldBp / 10000).toFixed(3) },
                  { key: "charge", header: "Charge", align: "right", cell: (row) => money(row.chargePaise) },
                  { key: "cost", header: "Total cost", align: "right", cell: (row) => money(row.totalCostPaise) },
                  { key: "perKg", header: "Cost/kg", align: "right", cell: (row) => money(row.costPerKgPaise) },
                  { key: "suggested", header: "Suggested/kg", align: "right", cell: (row) => money(row.suggestedPricePaise) },
                ]}
                empty={
                  <EmptyState
                    illustration="items"
                    title="No roasting batches yet"
                    message="Pick a raw item and a roasted item above to record the first batch."
                  />
                }
              />
            </section>
          );
        })()}

        {view === "stock" && (() => {
          const picked = items.find((i) => i.id === stock.itemId);
          const unit = picked?.unit ?? "kg";
          const currentStockBase = stockBatches.reduce((sum, b) => sum + b.qty_remaining, 0);
          return (
            <section className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Stock Check</h1>
                <p className="text-sm text-muted">Record usage, wastage or the stock counted on the shelf.</p>
              </div>

              <div className="card p-4">
                <FormRow desktop="min-[1200px]:grid-cols-[1fr_1fr_1fr_1.5fr_auto]">
                  <div className="space-y-1">
                    <label className="label" htmlFor="stock-item">Item</label>
                    <select
                      id="stock-item"
                      className="input"
                      value={stock.itemId}
                      onChange={(e) => void pickStockItem(e.currentTarget.value === "" ? "" : Number(e.currentTarget.value))}
                    >
                      <option value="">Choose item…</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="label" htmlFor="stock-type">Type</label>
                    <select
                      id="stock-type"
                      className="input"
                      value={stock.type}
                      onChange={(e) => setStock({ ...stock, type: e.currentTarget.value })}
                    >
                      <option value="USAGE">Used</option>
                      <option value="WASTAGE">Wastage</option>
                      <option value="STOCK_CHECK">Stock left</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="label" htmlFor="stock-qty">Quantity</label>
                      {stock.itemId !== "" && (
                        <span className="text-xs text-muted">
                          Stock: <span className="font-medium text-ink">{qty(currentStockBase, unit)}</span>
                        </span>
                      )}
                    </div>
                    <input
                      id="stock-qty"
                      className="input"
                      type="number"
                      placeholder={stock.type === "STOCK_CHECK" ? "Stock left" : "Quantity"}
                      value={stock.qty}
                      onChange={(e) => setStock({ ...stock, qty: e.currentTarget.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label" htmlFor="stock-note">Note</label>
                    <input
                      id="stock-note"
                      className="input"
                      placeholder="Optional"
                      value={stock.note}
                      onChange={(e) => setStock({ ...stock, note: e.currentTarget.value })}
                    />
                  </div>
                  {can("stock", "create") && (
                    <button className="btn btn-primary w-full whitespace-nowrap sm:col-span-full min-[1200px]:col-span-1 min-[1200px]:w-auto" onClick={() => void saveStockNow()}>Save entry</button>
                  )}
                </FormRow>
                {stockMsg && <p role="status" className="mt-2 text-sm text-muted">{stockMsg}</p>}
              </div>

              {/* Recent entries */}
              <ResponsiveTable
                title="Recent entries"
                headerRight={<span className="text-xs text-muted">Last 30 entries</span>}
                rows={stockEntries}
                rowKey={(row) => row.id}
                minWidthClass="min-w-[760px]"
                widths={["w-[16%]", "w-[24%]", "w-[13%]", "w-[15%]", "w-[18%]", "w-[14%]"]}
                columns={[
                  { key: "date", header: "Date", cell: (row) => (row.createdAt ? formatDateTime(row.createdAt) : formatDate(row.date)), className: "whitespace-nowrap" },
                  { key: "item", header: "Item", cell: (row) => <span className="font-medium">{row.item}</span> },
                  {
                    key: "type",
                    header: "Type",
                    cell: (row) => (
                      <span className={`badge ${
                        row.type === "STOCK_CHECK" ? "badge-info" : row.type === "WASTAGE" ? "badge-bad" : "badge-warn"
                      }`}>
                        {STOCK_TYPE_LABEL[row.type] ?? row.type}
                      </span>
                    ),
                  },
                  { key: "qty", header: "Quantity", align: "right", cell: (row) => qty(row.qtyBase, row.unit) },
                  { key: "note", header: "Note", cell: (row) => row.note ?? "—", className: "break-words" },
                  { key: "user", header: "User", cell: (row) => row.user ?? "—", className: "whitespace-nowrap" },
                ]}
                empty={<p className="text-sm text-muted">No stock entries yet.</p>}
              />
            </section>
          );
        })()}

        {view === "expenses" && (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Expenses</h1>

            <div className="card p-4">
              <FormRow desktop="min-[1200px]:grid-cols-[1fr_1fr_1.2fr_1fr_1.2fr_1.6fr_auto]">
                <div className="space-y-1">
                  <label className="label" htmlFor="expense-date">Date</label>
                  <div className="relative">
                    <IconCalendar size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="expense-date" className="input input-icon" type="date" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.currentTarget.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="expense-type">Type</label>
                  <div className="relative">
                    <IconTag size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <select id="expense-type" className="input input-icon" value={expense.type} onChange={(e) => setExpense({ ...expense, type: e.currentTarget.value })}>
                      <option value="general">General</option>
                      <option value="purchase">Purchase</option>
                      <option value="sale">Sale</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="expense-category">Category</label>
                  <div className="relative">
                    <IconTag size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      id="expense-category"
                      className="input input-icon"
                      list="expense-categories"
                      placeholder="Choose or type"
                      value={expense.category}
                      onChange={(e) => setExpense({ ...expense, category: e.currentTarget.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="expense-amount">Amount ₹</label>
                  <div className="relative">
                    <IconIndianRupee size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="expense-amount" className="input input-icon" type="number" placeholder="0" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.currentTarget.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="expense-paid-to">Paid to</label>
                  <div className="relative">
                    <IconUser size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="expense-paid-to" className="input input-icon" placeholder="Who was paid" value={expense.paidTo} onChange={(e) => setExpense({ ...expense, paidTo: e.currentTarget.value })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="expense-note">Note</label>
                  <div className="relative">
                    <IconStickyNote size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="expense-note" className="input input-icon" placeholder="Optional" value={expense.note} onChange={(e) => setExpense({ ...expense, note: e.currentTarget.value })} />
                  </div>
                </div>
                {can("expenses", "create") && (
                  <button className="btn btn-primary w-full whitespace-nowrap sm:col-span-full min-[1200px]:col-span-1 min-[1200px]:w-auto" disabled={expenseSaving} onClick={() => void addExpenseNow()}>{expenseSaving ? "Saving…" : "Add expense"}</button>
                )}
              </FormRow>
              <datalist id="expense-categories">
                {["Rent", "Tea", "Transport", "Salary", "Electricity", "Other"].map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              {expenseMsg && <p role="status" className="mt-2 text-sm text-muted">{expenseMsg}</p>}
            </div>

            <ResponsiveTable
              title="Recent expenses"
              headerRight={
                <span className="text-sm text-muted">
                  This month: <span className="font-semibold text-ink">{money(monthExpensesPaise)}</span>
                </span>
              }
              rows={expensesList}
              rowKey={(x) => x.id}
              minWidthClass="min-w-[760px]"
              widths={user?.role === "owner"
                ? ["w-[13%]", "w-[17%]", "w-[15%]", "w-[26%]", "w-[13%]", "w-[16%]"]
                : ["w-[15%]", "w-[20%]", "w-[18%]", "w-[32%]", "w-[15%]"]}
              columns={[
                { key: "date", header: "Date", cell: (x) => formatDate(x.date), className: "whitespace-nowrap" },
                { key: "category", header: "Category", cell: (x) => <span className="font-medium">{x.category}</span> },
                { key: "paidTo", header: "Paid to", cell: (x) => x.paidTo ?? "—" },
                { key: "note", header: "Note", cell: (x) => x.note ?? "—", className: "break-words" },
                { key: "amount", header: "Amount", align: "right", cell: (x) => money(x.amountPaise) },
                ...(user?.role === "owner"
                  ? [
                      {
                        key: "actions",
                        header: "",
                        align: "right" as const,
                        mobileLabel: "Actions",
                        hideOnMobile: true,
                        cell: (x: ExpenseRow) => (
                          <span className="flex flex-wrap justify-end gap-2">
                            <button className="btn-mini" onClick={() => openExpenseEdit(x)}>Edit</button>
                            <button className="btn-mini btn-mini-danger" onClick={() => void deleteExpenseRow(x)}>Delete</button>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
              empty={
                <EmptyState
                  illustration="expenses"
                  title="No expenses yet."
                  message="Add your first one above."
                />
              }
            />

              {editingExpense && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1C1612]/50 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-center sm:p-4">
                  <div className="card max-h-viewport-85 w-full max-w-lg space-y-3 overflow-y-auto p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-semibold tracking-tight">Edit expense — {editingExpense.category}</h2>
                      <button className="btn-mini" disabled={expenseEditSaving} onClick={() => setEditingExpense(null)}>Close</button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="label">Date</label>
                        <input className="input" type="date" value={expenseEdit.date} onChange={(e) => setExpenseEdit({ ...expenseEdit, date: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Type</label>
                        <select className="input" value={expenseEdit.type} onChange={(e) => setExpenseEdit({ ...expenseEdit, type: e.currentTarget.value })}>
                          <option value="general">General</option>
                          <option value="purchase">Purchase</option>
                          <option value="sale">Sale</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="label">Category</label>
                        <input className="input" list="expense-categories" value={expenseEdit.category} onChange={(e) => setExpenseEdit({ ...expenseEdit, category: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Amount ₹</label>
                        <input className="input" type="number" value={expenseEdit.amount} onChange={(e) => setExpenseEdit({ ...expenseEdit, amount: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Paid to</label>
                        <input className="input" value={expenseEdit.paidTo} onChange={(e) => setExpenseEdit({ ...expenseEdit, paidTo: e.currentTarget.value })} />
                      </div>
                      <div className="space-y-1">
                        <label className="label">Payment mode</label>
                        <select className="input" value={expenseEdit.paymentMode} onChange={(e) => setExpenseEdit({ ...expenseEdit, paymentMode: e.currentTarget.value })}>
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Card">Card</option>
                          <option value="Credit">Credit</option>
                        </select>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <label className="label">Note</label>
                        <input className="input" value={expenseEdit.note} onChange={(e) => setExpenseEdit({ ...expenseEdit, note: e.currentTarget.value })} />
                      </div>
                    </div>
                    {expenseEditError && (
                      <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">{expenseEditError}</p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button className="btn-mini" disabled={expenseEditSaving} onClick={() => setEditingExpense(null)}>Cancel</button>
                      <button className="btn btn-primary" disabled={expenseEditSaving} onClick={() => void saveExpenseEdit()}>
                        {expenseEditSaving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </section>
        )}

        {view === "suppliers" && can("suppliers", "view") && (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Supplier Dues</h1>
            <p className="text-sm text-muted">
              What you owe suppliers · total outstanding{" "}
              <span className={supplierDuesList.reduce((s, d) => s + d.outstanding_paise, 0) > 0 ? "font-medium text-error-ink" : "text-muted"}>
                {money(supplierDuesList.reduce((s, d) => s + d.outstanding_paise, 0))}
              </span>
            </p>

            {/* Add supplier */}
            <div className="card p-4">
              <div className="flex items-center justify-between space-y-2 sm:space-y-0 sm:flex-row">
                <div>
                  <h2 className="text-sm font-medium">Add supplier</h2>
                </div>
              </div>
              <FormRow desktop="min-[1200px]:grid-cols-[1fr_1fr_1.2fr_auto]">
                <div className="space-y-1">
                  <label className="label" htmlFor="supplier-name">Name</label>
                  <input id="supplier-name" className="input" value={addSupplier.name} onChange={(e) => setAddSupplier({ ...addSupplier, name: e.currentTarget.value })} />
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="supplier-phone">Phone</label>
                  <input id="supplier-phone" className="input" type="tel" value={addSupplier.phone} onChange={(e) => setAddSupplier({ ...addSupplier, phone: e.currentTarget.value })} />
                </div>
                {can("suppliers", "create") && (
                  <button className="btn btn-primary min-[1200px]:w-auto whitespace-nowrap" onClick={() => void addSupplierNow()} disabled={addSupplierBusy}>
                    {addSupplierBusy ? "Adding…" : "Add supplier"}
                  </button>
                )}
                {addSupplierMsg && <p className="mt-2 text-sm text-muted">{addSupplierMsg}</p>}
              </FormRow>
            </div>

            {/* Supplier dues table */}
            <div className="card p-4">
              <ResponsiveTable
                title="Supplier dues"
                rows={supplierDuesList}
                rowKey={(row) => row.id}
                minWidthClass="min-w-[640px]"
                widths={["w-[25%]", "w-[15%]", "w-[20%]", "w-[20%]", "w-[20%]"]}
                columns={[
                  { key: "name", header: "Supplier", cell: (row) => <span className="font-medium">{row.name}</span> },
                  { key: "phone", header: "Phone", cell: (row) => row.phone ?? "—" },
                  { key: "purchased", header: "Purchased", align: "right", cell: (row) => money(row.total_purchased_paise) },
                  { key: "paid", header: "Paid", align: "right", cell: (row) => money(row.total_paid_paise) },
                  {
                    key: "outstanding",
                    header: "Outstanding",
                    align: "right",
                    cell: (row) => (
                      <span className={`font-medium ${row.outstanding_paise > 0 ? "text-error-ink" : "text-success-ink"}`}>
                        {row.outstanding_paise > 0 ? money(row.outstanding_paise) : "Paid"}
                      </span>
                    ),
                  },
                ]}
                empty={<p className="text-sm text-muted">No suppliers yet. Add your first one above.</p>}
              />
            </div>

            {/* Record payment */}
            <div className="card p-4">
              <div className="flex items-center justify-between space-y-2 sm:space-y-0 sm:flex-row">
                <div>
                  <h2 className="text-sm font-medium">Record payment to supplier</h2>
                  <p className="text-sm text-muted">Select a purchase with an outstanding balance and enter the amount paid.</p>
                </div>
              </div>
              <FormRow desktop="min-[1200px]:grid-cols-[1.4fr_1fr_1fr_1fr_1.4fr_auto]">
                <div className="space-y-1">
                  <label className="label" htmlFor="payment-purchase">Purchase</label>
                  <select id="payment-purchase" className="input" value={String(recordPayment.purchaseId ?? "")} onChange={(e) => setRecordPayment({ ...recordPayment, purchaseId: Number(e.currentTarget.value) || "" as number | "" })}>
                    <option value="">— select purchase —</option>
                    {purchasesList.filter((p) => p.total_paise > p.paid_paise).map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} · {p.purchase_date} · outstanding {money(p.total_paise - p.paid_paise)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="payment-amount">Amount ₹</label>
                  <input id="payment-amount" className="input" type="number" placeholder="0" value={recordPayment.amount} onChange={(e) => setRecordPayment({ ...recordPayment, amount: e.currentTarget.value })} />
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="payment-date">Date</label>
                  <input id="payment-date" className="input" type="date" value={recordPayment.paymentDate} onChange={(e) => setRecordPayment({ ...recordPayment, paymentDate: e.currentTarget.value })} />
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="payment-mode">Mode</label>
                  <select id="payment-mode" className="input" value={recordPayment.paymentMode} onChange={(e) => setRecordPayment({ ...recordPayment, paymentMode: e.currentTarget.value })}>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="payment-note">Note</label>
                  <input id="payment-note" className="input" placeholder="Optional" value={recordPayment.note} onChange={(e) => setRecordPayment({ ...recordPayment, note: e.currentTarget.value })} />
                </div>
                {can("suppliers", "create") && (
                  <button className="btn btn-primary min-[1200px]:w-auto whitespace-nowrap" onClick={() => void recordSupplierPaymentNow()} disabled={recordPaymentBusy || !recordPayment.purchaseId}>
                    {recordPaymentBusy ? "Recording…" : "Record payment"}
                  </button>
                )}
                {recordPaymentMsg && <p className="mt-2 text-sm text-muted">{recordPaymentMsg}</p>}
              </FormRow>
            </div>

            {/* Recent payments */}
            <div className="card p-4">
              <ResponsiveTable
                title="Recent payments"
                rows={supplierPaymentsList}
                rowKey={(row) => row.id}
                minWidthClass="min-w-[640px]"
                widths={["w-[15%]", "w-[25%]", "w-[20%]", "w-[15%]", "w-[25%]"]}
                columns={[
                  { key: "payment_date", header: "Date", cell: (row) => formatDate(row.payment_date), className: "whitespace-nowrap" },
                  { key: "item_name", header: "Purchase", cell: (row) => <span className="font-medium">{row.item_name}</span> },
                  { key: "amount", header: "Amount", align: "right", cell: (row) => money(row.amount_paise) },
                  { key: "mode", header: "Mode", cell: (row) => row.payment_mode ?? "—" },
                  { key: "note", header: "Note", cell: (row) => row.note ?? "—", className: "break-words" },
                ]}
                empty={<p className="text-sm text-muted">No payments yet.</p>}
              />
            </div>
          </section>
        )}

        {view === "investments" && can("investments", "view") && (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Investments</h1>
            <div className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Total invested</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">{money(investTotal)}</p>
            </div>
            <div className="card space-y-3 p-4">
              <div className="grid gap-2 sm:grid-cols-4">
                <input className="input" placeholder="Investor name" value={investment.name} onChange={(e) => setInvestment({ ...investment, name: e.currentTarget.value })} />
                <input className="input" type="number" placeholder="Amount ₹" value={investment.amount} onChange={(e) => setInvestment({ ...investment, amount: e.currentTarget.value })} />
                <input className="input" type="date" value={investment.date} onChange={(e) => setInvestment({ ...investment, date: e.currentTarget.value })} />
                <input className="input" placeholder="Note" value={investment.note} onChange={(e) => setInvestment({ ...investment, note: e.currentTarget.value })} />
              </div>
              {can("investments", "create") && (
                <button className="btn btn-primary" onClick={() => void addInvestmentNow()}>Add investment</button>
              )}
              {investmentMsg && <p role="status" className="text-sm text-muted">{investmentMsg}</p>}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <ResponsiveTable
                rows={investments}
                rowKey={(row) => row.id}
                minWidthClass="min-w-[520px]"
                widths={["w-[25%]", "w-[35%]", "w-[25%]", "w-[15%]"]}
                columns={[
                  { key: "date", header: "Date", cell: (row) => formatDate(row.invested_on), className: "whitespace-nowrap" },
                  { key: "investor", header: "Investor", cell: (row) => <span className="font-medium">{row.investor_name}</span> },
                  { key: "amount", header: "Amount", align: "right", cell: (row) => money(row.amount_paise) },
                  {
                    key: "actions",
                    header: "",
                    align: "right",
                    mobileLabel: "Actions",
                    cell: (row) => (
                      can("investments", "delete") ? (
                        <button className="btn-mini btn-mini-danger" onClick={() => void removeInvestment(row.id)}>
                          <IconTrash /> Delete
                        </button>
                      ) : null
                    ),
                  },
                ]}
                empty={<p className="text-sm text-muted">No investments yet.</p>}
              />
              <div className="card p-4">
                <h2 className="mb-3 text-sm font-medium">By investor</h2>
                {investments.length === 0 ? (
                  <p className="text-sm text-muted">No investments yet.</p>
                ) : (
                  <Donut items={Object.entries(investments.reduce<Record<string, number>>((acc, row) => { acc[row.investor_name] = (acc[row.investor_name] ?? 0) + row.amount_paise; return acc; }, {})).map(([label, value]) => ({ label, value }))} />
                )}
              </div>
            </div>
          </section>
        )}

        {view === "bills" && (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Invoices</h1>
            <ResponsiveTable
              rows={bills}
              rowKey={(row) => row.id}
              minWidthClass="min-w-[640px]"
              widths={["w-[16%]", "w-[13%]", "w-[20%]", "w-[14%]", "w-[15%]", "w-[22%]"]}
              columns={[
                { key: "billNo", header: "Bill no", cell: (row) => <span className="font-medium">{row.billNo}</span> },
                { key: "date", header: "Date", cell: (row) => formatDate(row.saleDate), className: "whitespace-nowrap" },
                { key: "customer", header: "Customer", cell: (row) => row.customerName ?? "Walk-in" },
                { key: "total", header: "Total", align: "right", cell: (row) => money(row.totalPaise) },
                {
                  key: "status",
                  header: "Status",
                  cell: (row) =>
                    row.cancelled ? (
                      <span className="badge badge-bad">Cancelled</span>
                    ) : row.paidPaise < row.totalPaise ? (
                      <span className="badge badge-warn" title="Credit still due">
                        Credit {money(row.totalPaise - row.paidPaise)}
                      </span>
                    ) : (
                      <span className="badge badge-ok">Paid</span>
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  mobileLabel: "Actions",
                  cell: (row) => {
                    const canDelete = can("bills", "delete");
                    const view = <button className="btn-mini" onClick={() => void openBill(row.id)}><IconEye /> View</button>;
                    const deleteButton = canDelete ? (
                      <button
                        className="btn-mini btn-destructive"
                        onClick={async () => {
                          if (window.confirm(`Delete bill ${row.billNo}? This cannot be undone.`)) {
                            try {
                              await api.deleteBill(row.id);
                              setBills((await api.bills()).bills);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }
                        }}
                      >
                        Delete
                      </button>
                    ) : null;

                    if (row.cancelled) {
                      // If cancelled, show delete button if allowed, else show cancelled label
                      return canDelete ? (
                        <span className="flex flex-wrap justify-end gap-2">
                          {deleteButton}
                          {view}
                        </span>
                      ) : (
                        <span className="btn-mini">Cancelled</span>
                      );
                    }

                    // For non-cancelled bills
                    const canEdit = can("bills", "edit");
                    const isPaid = row.paidPaise >= row.totalPaise;

                    if (isPaid || !canEdit) {
                      // If paid or cannot edit, show view and delete (if allowed)
                      return (
                        <span className="flex flex-wrap justify-end gap-2">
                          {deleteButton}
                          {view}
                        </span>
                      );
                    }

                    // Can edit and not paid: show record payment, view, and delete
                    return (
                      <span className="flex flex-wrap justify-end gap-2">
                        {deleteButton}
                        <button
                          className="btn-mini"
                          onClick={async () => {
                            const input = window.prompt(
                              `Amount received (bill ${row.billNo})`,
                              ((row.totalPaise - row.paidPaise) / 100).toFixed(2),
                            );
                            if (input === null) return;
                            const amount = Math.round(Number(input) * 100);
                            if (!Number.isFinite(amount) || amount <= 0) {
                              setError("Enter a valid amount");
                              return;
                            }
                            try {
                              const res = await api.recordPayment(row.id, amount);
                              setBills((await api.bills()).bills);
                              void api.stats().then((r) => setStats(r.stats)).catch(() => {});
                              setError(
                                res.payment.creditPaise > 0
                                  ? `₹${(res.payment.creditPaise / 100).toFixed(2)} credit still due`
                                  : "Payment received — bill fully paid",
                              );
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          Record payment
                        </button>
                        {view}
                      </span>
                    );
                  },
                },
              ]}
              empty={
                <EmptyState
                  illustration="invoices"
                  title="No invoices yet"
                  message="Bills you raise will be listed here with their payment status."
                  actionLabel={can("billing", "create") ? "New bill" : undefined}
                  onAction={can("billing", "create") ? () => { setView("billing"); setBill(null); } : undefined}
                />
              }
            />

            {bill && shop && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold tracking-tight">Bill preview</h2>
                  <div className="flex items-center gap-3">
                    {can("bills", "export") && (
                      <>
                        <button className="btn btn-primary" onClick={() => void emailBill(bill.id)}>Email bill</button>
                        <button className="btn" onClick={() => whatsappBill(bill, shop.name)}>WhatsApp bill</button>
                      </>
                    )}
                    <button className="btn-mini" onClick={() => setBill(null)}>Close</button>
                  </div>
                </div>
                {emailStatus && <p className="text-sm text-muted" role="status">{emailStatus}</p>}
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  <iframe title={`Bill ${bill.billNo}`} className="h-[70vh] w-full lg:h-[1080px]" srcDoc={buildBillHtml(bill as never, shop)} />
                </div>
              </section>
            )}
          </section>
        )}

        {view === "billing" && (
          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">New Bill</h1>
              <p className="text-sm text-muted">Raise a GST invoice — customer, items and totals update live.</p>
            </div>

            <div className="grid items-stretch gap-4 lg:grid-cols-3">
              {/* Left: customer + items */}
              <div className="flex flex-col gap-4 lg:col-span-2">
                {/* Customer */}
                <div className="card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Customer</h2>
                    {pickedCustomer && (
                      <button className="btn-mini" onClick={() => { setPickedCustomer(null); setBillCustomer({ name: "", phone: "", email: "", gstin: "" }); }}>Clear</button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="label">Pick saved client</label>
                      <CustomerPicker
                        customers={customers}
                        value={pickedCustomer}
                        onSearch={setCustomerSearch}
                        onPick={(customer) => {
                          setPickedCustomer(customer);
                          setBillCustomer({
                            name: customer.name,
                            phone: customer.phone ?? "",
                            email: customer.email ?? "",
                            gstin: customer.gstin ?? "",
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="label">Customer name</label>
                      <input className="input h-10" placeholder="Walk-in or name" value={billCustomer.name} onChange={(e) => setBillCustomer({ ...billCustomer, name: e.currentTarget.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="label">Phone</label>
                      <input className="input h-10" placeholder="Phone" value={billCustomer.phone} onChange={(e) => setBillCustomer({ ...billCustomer, phone: e.currentTarget.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="label">Email (for bill)</label>
                      <input className="input h-10" placeholder="Email" value={billCustomer.email} onChange={(e) => setBillCustomer({ ...billCustomer, email: e.currentTarget.value })} />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="label">GSTIN (optional)</label>
                      <input className="input h-10 max-w-sm" placeholder="Leave blank if no GST" value={billCustomer.gstin} onChange={(e) => setBillCustomer({ ...billCustomer, gstin: e.currentTarget.value.toUpperCase() })} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {pickedCustomer
                      ? "Saved client — their details are updated in the master with this bill."
                      : "New client? Their details are saved into the customer master with this bill."}
                  </p>
                </div>

                {/* Items */}
                <div className="card flex flex-col p-4 lg:flex-1">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Items</h2>
                  <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                    <div className="space-y-1">
                      <label className="label h-5 whitespace-nowrap leading-5">Item</label>
                      <ItemPicker
                        items={items}
                        value={draft.itemId}
                        onChange={(id) => {
                          const picked = items.find((item) => item.id === id);
                          setDraft({ ...draft, itemId: id, hsn: picked?.hsnCode ?? "" });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="label h-5 whitespace-nowrap leading-5">Qty ({items.find((i) => i.id === draft.itemId)?.unit ?? "unit"})</label>
                      <input className="input h-10" type="number" placeholder="0" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.currentTarget.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="label h-5 whitespace-nowrap leading-5">Rate ₹</label>
                      <input className="input h-10" type="number" placeholder="0" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.currentTarget.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="label h-5 whitespace-nowrap leading-5">HSN</label>
                      <input className="input h-10" placeholder="—" value={draft.hsn} onChange={(e) => setDraft({ ...draft, hsn: e.currentTarget.value })} />
                    </div>
                    {can("billing", "create") && (
                      <button className="btn btn-primary h-10 whitespace-nowrap" onClick={addBillLine}>+ Add</button>
                    )}
                  </div>

                  {draftItem && draftItem.avgCostPaise > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
                      <span>
                        Avg cost: <b className="text-ink">{money(draftItem.avgCostPaise)}</b> / {draftItem.unit}
                      </span>
                      <span className="flex items-center gap-1">
                        Margin
                        <input
                          className="input h-7 w-16 px-2 text-base sm:text-xs"
                          type="number"
                          value={billMargin}
                          onChange={(e) => setBillMargin(e.currentTarget.value)}
                        />
                        %
                      </span>
                      <span>
                        Suggested: <b className="text-ink">{money(draftSuggestedPaise)}</b> / {draftItem.unit}
                      </span>
                      <button
                        type="button"
                        className="btn-mini"
                        onClick={() => setDraft({ ...draft, rate: (draftSuggestedPaise / 100).toFixed(2) })}
                      >
                        Use suggested
                      </button>
                    </div>
                  )}

                  {billLines.length > 0 ? (
                    <ResponsiveTable
                      className="mt-4 shadow-none"
                      rows={billLines.map((line, idx) => ({ ...line, idx }))}
                      rowKey={(line) => line.idx}
                      minWidthClass="min-w-[520px]"
                      widths={["w-[38%]", "w-[15%]", "w-[15%]", "w-[17%]", "w-[15%]"]}
                      columns={[
                        { key: "item", header: "Item", cell: (line) => <span className="font-medium">{line.name}</span> },
                        { key: "qty", header: "Qty", align: "right", cell: (line) => qty(line.qtyBase, line.unit) },
                        { key: "rate", header: "Rate", align: "right", cell: (line) => money(line.ratePaise) },
                        { key: "amount", header: "Amount", align: "right", cell: (line) => money(line.totalPaise) },
                        {
                          key: "remove",
                          header: "",
                          align: "right",
                          mobileLabel: "Actions",
                          cell: (line) => (
                            <button className="btn-mini" onClick={() => setBillLines(billLines.filter((_, i) => i !== line.idx))}>Remove</button>
                          ),
                        },
                      ]}
                    />
                  ) : (
                    <div className="mt-4 flex flex-1 items-center justify-center">
                      <p className="rounded-lg bg-surface-2 px-3 py-3 text-center text-sm text-muted">
                        No items yet — pick an item, enter qty &amp; rate, then Add.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: sticky summary */}
              <div className="lg:col-span-1">
                <div className="card space-y-4 p-4 lg:sticky lg:top-6 lg:mr-8">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Summary</h2>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="label">Date</label>
                      <input className="input h-10" type="date" value={billDate} onChange={(e) => setBillDate(e.currentTarget.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="label">Payment</label>
                      <select className="input h-10" value={billMode} onChange={(e) => setBillMode(e.currentTarget.value)}>
                        <option>Cash</option><option>UPI</option><option>Card</option><option>Credit</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="label">GST rate</label>
                      <select className="input h-10" value={billGst} onChange={(e) => setBillGst(e.currentTarget.value)}>
                        <option value="0">0%</option><option value="500">5%</option><option value="1200">12%</option><option value="1800">18%</option><option value="2800">28%</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="label">Discount ₹</label>
                      <input className="input h-10" type="number" placeholder="0" value={billDiscount} onChange={(e) => setBillDiscount(e.currentTarget.value)} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="label">Delivery / sale expenses ₹</label>
                      <input className="input h-10" type="number" placeholder="0" value={billSaleExpenses} onChange={(e) => setBillSaleExpenses(e.currentTarget.value)} />
                    </div>
                  </div>

                  {/* Totals breakdown */}
                  <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
                    <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(billSubtotal)}</dd></div>
                    {gstIntraState ? (
                      <>
                        <div className="flex justify-between"><dt className="text-muted">CGST ({gstRatePercent / 2}%)</dt><dd>{money(cgstPaise)}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted">SGST ({gstRatePercent / 2}%)</dt><dd>{money(sgstPaise)}</dd></div>
                      </>
                    ) : (
                      <div className="flex justify-between"><dt className="text-muted">IGST ({gstRatePercent}%)</dt><dd>{money(billGstPaise)}</dd></div>
                    )}
                    <div className="flex justify-between"><dt className="text-muted">Discount (−)</dt><dd>− {money(billDiscountPaise)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Delivery (+)</dt><dd>+ {money(Math.round(Number(billSaleExpenses || 0) * 100))}</dd></div>
                  </dl>
                  <div className="flex items-center justify-between border-t border-line pt-3">
                    <span className="text-sm font-semibold uppercase tracking-wider text-muted">Total</span>
                    <span className="text-2xl font-semibold tracking-tight">{money(billTotal)}</span>
                  </div>

                  {can("billing", "create") && (
                    <>
                      <button className="btn btn-primary w-full justify-center" onClick={() => void saveBill()} disabled={billLines.length === 0}>
                        <span className="flex items-center justify-center gap-1.5"><IconBill size={15} /> Save bill</span>
                      </button>
                      {billLines.length === 0 && <p className="text-center text-xs text-muted">Add at least one item to save.</p>}
                    </>
                  )}
                  {billMsg && <p role="status" className="rounded bg-surface-2 px-3 py-2 text-center text-sm">{billMsg}</p>}
                  {lastBillId && <button className="btn btn-secondary w-full justify-center" onClick={() => void openBill(lastBillId).then(() => setView("bills"))}>View last bill</button>}
                </div>
              </div>
            </div>
          </section>
        )}

        {view === "items" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Items</h1>
              {can("items", "create") && (
                <button className="btn btn-primary" onClick={() => setItemForm({ id: null, name: "", unit: "kg", category: "", hsnCode: "", minStock: "", imageUrl: "" })}>
                  <span className="flex items-center gap-1.5"><IconPlus size={15} /> Add item</span>
                </button>
              )}
            </div>
            {itemForm && (
              <div className="card max-w-3xl space-y-2 p-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <input className="input" placeholder="Item name" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.currentTarget.value })} />
                  <select className="input" value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.currentTarget.value })}>
                    <option value="kg">kg</option><option value="60 kg bag">60 kg bag</option>
                  </select>
                  <input className="input" placeholder="Category" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.currentTarget.value })} />
                  <input className="input" placeholder="HSN code" value={itemForm.hsnCode} onChange={(e) => setItemForm({ ...itemForm, hsnCode: e.currentTarget.value })} />
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => void saveItem()}>Save</button>
                    <button className="btn-mini" onClick={() => setItemForm(null)}>Cancel</button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-surface-2 text-muted">
                    {itemForm.imageUrl ? (
                      <img src={itemForm.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <IconImage size={16} />
                    )}
                  </span>
                  <input
                    className="input max-w-md flex-1"
                    placeholder="Image link (https://…png) — optional"
                    value={itemForm.imageUrl}
                    onChange={(e) => setItemForm({ ...itemForm, imageUrl: e.currentTarget.value })}
                  />
                </div>
              </div>
            )}
            {itemsMsg && <p role="status" className="text-sm text-muted">{itemsMsg}</p>}
            <ResponsiveTable
              rows={items}
              rowKey={(item) => item.id}
              minWidthClass="min-w-[680px]"
              widths={["w-[26%]", "w-[12%]", "w-[8%]", "w-[16%]", "w-[14%]", "w-[24%]"]}
              columns={[
                {
                  key: "item",
                  header: "Item",
                  cell: (item) => (
                    <span className="flex items-center gap-2">
                      <ItemThumb item={item} />
                      <span className="font-medium">{item.name}</span>
                    </span>
                  ),
                },
                { key: "hsn", header: "HSN", cell: (item) => item.hsnCode ?? "—" },
                { key: "unit", header: "Unit", cell: (item) => item.unit },
                { key: "category", header: "Category", cell: (item) => item.category ?? "—" },
                { key: "stock", header: "Stock left", align: "right", cell: (item) => qty(item.stockLeftBase, item.unit) },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  mobileLabel: "Actions",
                  cell: (item) => (
                    <span className="flex flex-wrap justify-end gap-2">
                      {can("items", "edit") && (
                        <button className="btn-mini" onClick={() => setItemForm({ id: item.id, name: item.name, unit: item.unit, category: item.category ?? "", hsnCode: item.hsnCode ?? "", minStock: String(item.minStockBase / unitFactor(item.unit)), imageUrl: item.imageUrl ?? "" })}><IconEdit /> Edit</button>
                      )}
                      <button className="btn-mini" onClick={() => void openLots(item)}>Lots</button>
                      {can("items", "delete") && (
                        <button
                          className="btn-mini btn-mini-danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${item.name}?`)) return;
                            try {
                              await api.deleteItem(item.id);
                              setItems((await api.items()).items);
                              setItemsMsg(`${item.name} deleted`);
                            } catch (err) {
                              setItemsMsg(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </span>
                  ),
                },
              ]}
              empty={
                <EmptyState
                  illustration="items"
                  title="No items yet"
                  message="Add the products you buy and sell — stock, cost and profit follow automatically."
                  actionLabel={can("items", "create") ? "Add item" : undefined}
                  onAction={can("items", "create") ? () => setItemForm({ id: null, name: "", unit: "kg", category: "", hsnCode: "", minStock: "", imageUrl: "" }) : undefined}
                />
              }
            />

            {lotItem && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">
                    Lots — {lotItem.name}
                    <span className="ml-2 text-sm font-normal text-muted">per purchase batch</span>
                  </h2>
                  <button className="btn-mini" onClick={() => { setLotItem(null); setLotLedger(null); setLotError(null); setExpandedLot(null); }}>Close</button>
                </div>
                {lotLoading && <p className="text-sm text-muted">Loading lots…</p>}
                {lotError && <p role="status" className="text-sm text-error-ink">{lotError}</p>}
                {lotLedger && (
                  <>
                    {lotLedger.batches.length === 0 ? (
                      <div className="card p-4 text-sm text-muted">No purchase lots for this item yet.</div>
                    ) : (
                      <div className="card">
                        <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full min-w-[860px] text-left text-sm">
                          <thead>
                            <tr>
                              <th className="px-3 py-2">Lot</th>
                              <th className="px-3 py-2">Purchased</th>
                              <th className="px-3 py-2">Supplier</th>
                              <th className="px-3 py-2 text-right">Bought</th>
                              <th className="px-3 py-2 text-right">Unit cost</th>
                              <th className="px-3 py-2 text-right">Sold qty</th>
                              <th className="px-3 py-2 text-right">Sold value</th>
                              <th className="px-3 py-2 text-right">Profit</th>
                              <th className="px-3 py-2 text-right">Pending</th>
                              <th className="px-3 py-2 text-right">Pending value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lotLedger.batches.map((row) => {
                              const open = expandedLot === row.batchId;
                              return (
                                <Fragment key={row.batchId}>
                                  <tr
                                    className="cursor-pointer border-t border-line hover:bg-surface-2"
                                    onClick={() => setExpandedLot(open ? null : row.batchId)}
                                  >
                                    <td className="px-3 py-2">
                                      <span className="inline-flex items-center gap-1 font-medium">
                                        {open ? <IconClose size={13} /> : <IconEye />}#{row.batchId}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">{formatDate(row.purchaseDate)}</td>
                                    <td className="px-3 py-2">{row.supplierName ?? "—"}</td>
                                    <td className="px-3 py-2 text-right">{qty(row.qtyOriginal, lotLedger.unit)}</td>
                                    <td className="px-3 py-2 text-right">{money(row.unitPricePaise)}</td>
                                    <td className="px-3 py-2 text-right">{qty(row.qtySold, lotLedger.unit)}</td>
                                    <td className="px-3 py-2 text-right">{money(row.soldValuePaise)}</td>
                                    <td className={`px-3 py-2 text-right ${row.profitPaise >= 0 ? "text-success-ink" : "text-error-ink"}`}>{money(row.profitPaise)}</td>
                                    <td className="px-3 py-2 text-right">{qty(row.qtyRemaining, lotLedger.unit)}</td>
                                    <td className="px-3 py-2 text-right">{money(row.pendingValuePaise)}</td>
                                  </tr>
                                  {open && (
                                    <tr className="border-t border-line bg-surface-2/60">
                                      <td colSpan={10} className="px-3 py-3">
                                        {row.sales.length === 0 ? (
                                          <p className="text-xs text-muted">Nothing sold from this lot yet.</p>
                                        ) : (
                                          <div className="overflow-x-auto">
                                            <table className="w-full min-w-[560px] text-left text-xs">
                                              <thead>
                                                <tr className="text-muted">
                                                  <th className="px-2 py-1">Bill</th>
                                                  <th className="px-2 py-1">Date</th>
                                                  <th className="px-2 py-1">Customer</th>
                                                  <th className="px-2 py-1 text-right">Qty from this lot</th>
                                                  <th className="px-2 py-1 text-right">Sale rate</th>
                                                  <th className="px-2 py-1 text-right">Revenue share</th>
                                                  <th className="px-2 py-1 text-right">COGS</th>
                                                  <th className="px-2 py-1 text-right">Profit</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {row.sales.map((sale) => (
                                                  <tr key={`${row.batchId}-${sale.billNo}-${sale.saleDate}`} className="border-t border-line/60">
                                                    <td className="px-2 py-1 font-medium">{sale.billNo}</td>
                                                    <td className="px-2 py-1">{formatDate(sale.saleDate)}</td>
                                                    <td className="px-2 py-1">{sale.customerName ?? "—"}</td>
                                                    <td className="px-2 py-1 text-right">{qty(sale.qtyTaken, lotLedger.unit)}</td>
                                                    <td className="px-2 py-1 text-right">{money(sale.unitPricePaise)}</td>
                                                    <td className="px-2 py-1 text-right">{money(sale.revenuePaise)}</td>
                                                    <td className="px-2 py-1 text-right">{money(sale.cogsPaise)}</td>
                                                    <td className={`px-2 py-1 text-right ${sale.profitPaise >= 0 ? "text-success-ink" : "text-error-ink"}`}>{money(sale.profitPaise)}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                        </div>
                        <div className="space-y-2 p-3 sm:hidden">
                          {lotLedger.batches.map((row) => {
                            const open = expandedLot === row.batchId;
                            return (
                              <div key={row.batchId} className="rounded-lg border border-line p-3">
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between gap-2 text-left"
                                  onClick={() => setExpandedLot(open ? null : row.batchId)}
                                >
                                  <span className="flex items-center gap-1.5 text-sm font-medium">
                                    {open ? <IconClose size={13} /> : <IconEye />}#{row.batchId} · {formatDate(row.purchaseDate)}
                                  </span>
                                  <span className="text-xs text-muted">{open ? "Hide sales" : "Sales"}</span>
                                </button>
                                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  <div className="flex justify-between gap-2"><span className="text-muted">Bought</span><span>{qty(row.qtyOriginal, lotLedger.unit)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Unit cost</span><span>{money(row.unitPricePaise)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Sold qty</span><span>{qty(row.qtySold, lotLedger.unit)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Sold value</span><span>{money(row.soldValuePaise)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Profit</span><span className={row.profitPaise >= 0 ? "text-success-ink" : "text-error-ink"}>{money(row.profitPaise)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Pending</span><span>{qty(row.qtyRemaining, lotLedger.unit)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Pending value</span><span>{money(row.pendingValuePaise)}</span></div>
                                  <div className="flex justify-between gap-2"><span className="text-muted">Supplier</span><span className="truncate">{row.supplierName ?? "—"}</span></div>
                                </div>
                                {open && (
                                  <div className="mt-2 space-y-1.5 border-t border-line pt-2 text-xs">
                                    {row.sales.length === 0 ? (
                                      <p className="text-muted">Nothing sold from this lot yet.</p>
                                    ) : (
                                      row.sales.map((sale) => (
                                        <div key={`${row.batchId}-${sale.billNo}-${sale.saleDate}`} className="flex items-center justify-between gap-2">
                                          <span className="min-w-0 truncate">{sale.billNo} · {formatDate(sale.saleDate)}</span>
                                          <span className="shrink-0 text-muted">{qty(sale.qtyTaken, lotLedger.unit)} · {money(sale.profitPaise)}</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </section>
        )}

        {view === "team" && can("team", "view") && (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Team</h1>
            <div className="flex flex-wrap items-center gap-2">
              <button className={`btn-mini ${teamTab === "members" ? "btn-mini-ok" : ""}`} onClick={() => setTeamTab("members")}>Members</button>
              {user.role === "owner" && (
                <button className={`btn-mini ${teamTab === "roles" ? "btn-mini-ok" : ""}`} onClick={() => setTeamTab("roles")}>Roles &amp; permissions</button>
              )}
            </div>
            {teamTab === "members" && (
              <>
            {usage.length > 0 && (
              <ResponsiveTable
                title={
                  <div className="flex items-start gap-2">
                    <IconBarChart size={16} className="mt-0.5 shrink-0 text-muted" />
                    <div>
                      <h2 className="text-sm font-medium">Usage</h2>
                      <p className="text-xs text-muted">Who logged in, when they signed out and how long they were active.</p>
                    </div>
                  </div>
                }
                rows={usage}
                rowKey={(row) => row.userId}
                minWidthClass="min-w-[720px]"
                widths={["w-[30%]", "w-[10%]", "w-[14%]", "w-[23%]", "w-[23%]"]}
                columns={[
                  {
                    key: "member",
                    header: "Member",
                    cell: (row) => (
                      <span className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary-soft text-[11px] font-semibold text-secondary-ink">
                          {initials(row.name)}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {row.name}
                          <RolePill role={row.role as Role} />
                        </span>
                      </span>
                    ),
                  },
                  { key: "sessions", header: "Sessions", align: "right", cell: (row) => row.sessions },
                  { key: "active", header: "Active time", align: "right", cell: (row) => formatDuration(row.activeSeconds) },
                  { key: "login", header: "Last login", cell: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "—"), className: "whitespace-nowrap" },
                  {
                    key: "logout",
                    header: "Last logout",
                    className: "whitespace-nowrap",
                    cell: (row) => {
                      const online =
                        row.lastLoginAt != null &&
                        (row.lastLogoutAt == null || new Date(row.lastLoginAt) > new Date(row.lastLogoutAt));
                      if (online) {
                        return (
                          <span className="inline-flex items-center gap-1.5 text-xs text-success-ink">
                            <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                            Online now
                          </span>
                        );
                      }
                      return row.lastLogoutAt ? formatDateTime(row.lastLogoutAt) : "—";
                    },
                  },
                ]}
              />
            )}

            {/* Members */}
            <div className="card space-y-3 p-4">
              <div className="flex items-center gap-2">
                <IconUsers size={16} className="text-muted" />
                <h2 className="text-sm font-medium">Members</h2>
              </div>
              {members.map((member) => {
                const isSelf = member.id === user.id;
                return (
                  <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-sm last:border-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary-soft text-[11px] font-semibold text-secondary-ink">
                        {initials(member.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <b>{member.name}</b>
                          {isSelf && <span className="text-xs text-muted">(you)</span>}
                          <RolePill role={member.role} />
                          {member.accessUntil && (
                            <span className="text-xs text-muted">until {formatDate(member.accessUntil)}</span>
                          )}
                          {member.pending && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-ink">awaiting approval</span>}
                          {!member.pending && !member.active && <span className="rounded-full bg-error-soft px-2 py-0.5 text-xs text-error-ink">disabled</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">{maskPhone(member.phone)}</span>
                      </span>
                    </span>
                    {member.pending ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <select
                          className="input"
                          value={approveRole[member.id] ?? "staff"}
                          onChange={(e) => setApproveRole({ ...approveRole, [member.id]: e.currentTarget.value as Role })}
                        >
                          <option value="staff">Staff</option>
                          <option value="ca">CA (Accountant)</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button className="btn-mini btn-mini-ok" onClick={() => void api.approveUser(member.id, approveRole[member.id] ?? "staff").then(loadMembers).then(() => setTeamStatus(`${member.name} approved`))}>Approve</button>
                        <button className="btn-mini btn-mini-danger" onClick={() => void api.rejectUser(member.id).then(loadMembers).then(() => setTeamStatus("Request rejected"))}>Reject</button>
                      </span>
                    ) : !isSelf && can("team", "edit") ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <select
                          className="input"
                          value={member.role}
                          disabled={member.role === "owner"}
                          onChange={(e) => {
                            const role = e.currentTarget.value as Role;
                            void api.setUserRole(member.id, role).then(loadMembers).then(() => setTeamStatus(`${member.name} is now ${role}`));
                          }}
                        >
                          <option value="staff">Staff</option>
                          <option value="ca">CA (Accountant)</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button
                          className="btn-mini whitespace-nowrap"
                          title="Reset password"
                          aria-label={`Reset password for ${member.name}`}
                          onClick={() => { setResetTarget(member); setResetPassword(""); }}
                        >
                          <IconKey size={13} /> Reset
                        </button>
                        {member.active ? (
                          member.role !== "owner" && (
                            <button
                              className="btn-mini btn-mini-danger whitespace-nowrap"
                              title="Disable member"
                              aria-label={`Disable ${member.name}`}
                              onClick={() => {
                                if (window.confirm(`Disable ${member.name}? They will not be able to sign in.`)) {
                                  void toggleMember(member);
                                }
                              }}
                            >
                              <IconUserX size={13} /> Disable
                            </button>
                          )
                        ) : (
                          <button
                            className="btn-mini btn-mini-ok whitespace-nowrap"
                            title="Enable member"
                            aria-label={`Enable ${member.name}`}
                            onClick={() => void toggleMember(member)}
                          >
                            <IconUserCheck size={13} /> Enable
                          </button>
                        )}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {resetTarget && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3">
                  <span className="text-sm">New password for <b>{resetTarget.name}</b>:</span>
                  <input className="input flex-1" type="password" autoComplete="new-password" value={resetPassword} onChange={(e) => setResetPassword(e.currentTarget.value)} />
                  <button className="btn btn-primary" onClick={() => void saveResetPassword()}>Save</button>
                  <button className="btn-mini" onClick={() => setResetTarget(null)}>Cancel</button>
                </div>
              )}
            </div>

            {/* Add member */}
            <div className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <IconUserPlus size={16} className="text-muted" />
                <h2 className="text-sm font-medium">Add member</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="label" htmlFor="member-name">Name</label>
                  <div className="relative">
                    <IconUser size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="member-name" className="input input-icon" autoComplete="off" placeholder="Full name" value={memberName} onChange={(e) => setMemberName(e.currentTarget.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-phone">Phone</label>
                  <div className="relative">
                    <IconPhone size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="member-phone" className="input input-icon" autoComplete="off" placeholder="10 digits" value={memberPhone} onChange={(e) => setMemberPhone(e.currentTarget.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-password">Password</label>
                  <div className="relative">
                    <IconLock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input id="member-password" className="input input-icon" type="password" autoComplete="new-password" placeholder="6+ characters" value={memberPassword} onChange={(e) => setMemberPassword(e.currentTarget.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-role">Role</label>
                  <select id="member-role" className="input" value={memberRole} onChange={(e) => setMemberRole(e.currentTarget.value as Role)}>
                    <option value="staff">Staff</option>
                    <option value="ca">CA (Accountant)</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-access-until">Access until (optional)</label>
                  <input id="member-access-until" className="input" type="date" value={memberAccessUntil} onChange={(e) => setMemberAccessUntil(e.currentTarget.value)} />
                  <p className="text-xs text-muted">The account is disabled automatically after this date.</p>
                </div>
              </div>
              {can("team", "create") && (
                <button className="btn btn-primary mt-3" onClick={() => void addMember()}>Add member</button>
              )}
              {teamStatus && <p role="status" className="mt-2 text-sm text-muted">{teamStatus}</p>}
            </div>
              </>
            )}

            {teamTab === "roles" && user.role === "owner" && (
              <div className="card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <IconSettings size={16} className="mt-0.5 shrink-0 text-muted" />
                    <div>
                      <h2 className="text-sm font-medium">Roles &amp; permissions</h2>
                      <p className="text-xs text-muted">Owner always has full access. Changes are logged in Activity.</p>
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => void saveRoles()} disabled={rolesSaving || !roleMatrix}>
                    {rolesSaving ? "Saving…" : "Save changes"}
                  </button>
                </div>
                {rolesMsg && <p role="status" className="mb-2 text-sm text-muted">{rolesMsg}</p>}
                {!roleMatrix ? (
                  <LoadingMark />
                ) : (
                  (["ca", "staff"] as const).map((role) => (
                    <div key={role} className="mb-5 last:mb-0">
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <RolePill role={role} />
                        <span className="font-normal text-muted">{role === "ca" ? "Accountant" : "Staff"}</span>
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-left text-sm">
                          <thead>
                            <tr>
                              <th className="px-3 py-2">Module</th>
                              {PERMISSION_ACTIONS.map((action) => (
                                <th key={action} className="px-3 py-2 text-center">{ACTION_LABELS[action]}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {MODULES.map((moduleKey) => (
                              <tr key={moduleKey} className="border-t border-line">
                                <td className="px-3 py-2 font-medium">{MODULE_LABELS[moduleKey]}</td>
                                {PERMISSION_ACTIONS.map((action) => (
                                  <td key={action} className="px-3 py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={roleMatrix[role][moduleKey][action]}
                                      onChange={() => togglePermission(role, moduleKey, action)}
                                      aria-label={`${MODULE_LABELS[moduleKey]} ${ACTION_LABELS[action]} for ${role}`}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        )}

        {view === "settings" && can("settings", "view") && (
          <section className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Settings</h1>
            <div className="card space-y-3 p-4">
              <div>
                <h2 className="text-sm font-medium">Stock costing</h2>
                <p className="text-sm text-muted">
                  Weighted average keeps one average cost per item; FIFO costs each sale from the oldest batch.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <select
                  className="input max-w-56"
                  value={costingMethod}
                  disabled={!can("settings", "edit")}
                  onChange={(e) => {
                    const method = e.currentTarget.value as "WAC" | "FIFO";
                    setCostingMethodState(method);
                    void api.setCostingMethod(method).then(() => setCostingMsg(`Costing method set to ${method}`));
                  }}
                >
                  <option value="WAC">Weighted average (WAC)</option>
                  <option value="FIFO">FIFO (batch-wise)</option>
                </select>
                {costingMsg && <span className="text-sm text-muted">{costingMsg}</span>}
              </div>
            </div>
            <div className="card space-y-4 p-4">
              <div>
                <h2 className="text-sm font-medium">Email notifications</h2>
                <p className="text-sm text-muted">
                  Owner alerts for signups, member changes and staff bills.{" "}
                  <b>{emailConfigured ? "Email configured ✓" : "Email NOT configured (add RESEND_API_KEY)"}</b>
                </p>
              </div>
              <div className="space-y-1">
                <label className="label" htmlFor="notify-emails">Notify these emails (comma separated)</label>
                <input id="notify-emails" className="input" value={notifyEmails} onChange={(e) => setNotifyEmails(e.currentTarget.value)} />
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={notifySignup} onChange={(e) => setNotifySignup(e.currentTarget.checked)} /> New account requests</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={notifyMember} onChange={(e) => setNotifyMember(e.currentTarget.checked)} /> Member changes</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={notifyBill} onChange={(e) => setNotifyBill(e.currentTarget.checked)} /> Staff-created bills</label>
              </div>
              <div className="space-y-1">
                <label className="label" htmlFor="resend-key">Resend API key (stored encrypted in the database)</label>
                <input id="resend-key" type="password" className="input" placeholder={emailConfigured ? "Key saved ✓ — enter a new key to replace" : "re_…"} value={resendKey} onChange={(e) => setResendKey(e.currentTarget.value)} />
                <p className="text-xs text-muted">Encrypted with the Worker secret; never shown again. Prefer the Cloudflare secret for extra safety.</p>
              </div>
              {can("settings", "edit") && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={() => void saveNotify()}>Save settings</button>
                  <button className="btn btn-secondary" onClick={() => void testNotify()}>Send test email</button>
                </div>
              )}
              {notifyStatus && <p role="status" className="text-sm text-muted">{notifyStatus}</p>}
            </div>
            <div className="card space-y-3 p-4">
              <div>
                <h2 className="text-sm font-medium">In-app notifications</h2>
                <p className="text-sm text-muted">
                  Small cards after you sign in. Saved to your account, so it applies on every device.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showWelcomeBanner}
                  onChange={(e) => void saveWelcomeBanner(e.currentTarget.checked)}
                />
                Show welcome message after login
              </label>
              {welcomeBannerMsg && <p role="status" className="text-sm text-muted">{welcomeBannerMsg}</p>}
            </div>
          </section>
        )}

        {view === "team-chat" && can("chat", "view") && (
          <TeamChat user={user} initialRoom={chatTargetRoom ?? undefined} />
        )}

        {view === "settings" && (
          <section className="space-y-3 card p-4">
            <div>
              <h2 className="text-sm font-medium">Help</h2>
              <p className="text-sm text-muted">Take a short tour of the app.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {TOURS.map((tour) => (
                <button
                  key={tour.id}
                  type="button"
                  className="btn-mini"
                  onClick={() => setTourToStart(tour.id)}
                >
                  {tour.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {view === "settings" && user?.role === "owner" && (
          <AnnouncementsAdmin />
        )}

        {view === "settings" && (
          <section className="space-y-3 card p-4">
            <div>
              <h2 className="text-sm font-medium">Recent logins</h2>
              <p className="text-sm text-muted">
                The last 10 sign-ins of your account. One device at a time: signing in somewhere else closes
                the old session.
              </p>
            </div>
            <ul className="divide-y divide-line text-sm">
              {loginHistory.length === 0 && (
                <li className="py-2 text-muted">No logins yet.</li>
              )}
              {loginHistory.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium text-ink">
                    {entry.browser ?? "Unknown browser"}
                    {entry.os ? ` · ${entry.os}` : ""}
                  </span>
                  {entry.current && <span className="badge badge-ok">this device</span>}
                  <span className="text-xs text-muted">
                    {new Date(entry.createdAt).toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view === "settings" && user?.role === "owner" && (
          <section className="space-y-3 card p-4">
            <div>
              <h2 className="text-sm font-medium">Sign out everybody</h2>
              <p className="text-sm text-muted">
                Every signed-in member is signed out at once — the web sessions die immediately and every
                member has to sign in again. Use it when a phone or a computer may be left open.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (!window.confirm("Sign out every member now?")) return;
                  void api
                    .logoutEveryone()
                    .then(() => {
                      setLogoutAllStatus("Everybody is signed out ✓");
                      setUser(null);
                    })
                    .catch((err) => setLogoutAllStatus(err instanceof Error ? err.message : String(err)));
                }}
              >
                Sign out everybody now
              </button>
              {logoutAllStatus && <p role="status" className="text-sm text-muted">{logoutAllStatus}</p>}
            </div>
          </section>
        )}

        {view === "activity" && (() => {          const actors = [...new Set(activity.map((row) => row.actor))].sort();
          const shown = activity.filter((row) => !activityFilter || row.actor === activityFilter);
          const days = shown.reduce<Record<string, ActivityRow[]>>((acc, row) => {
            const day = new Date(row.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
            (acc[day] ??= []).push(row);
            return acc;
          }, {});
          const dot = (event: string) =>
            event.startsWith("sale")
              ? "bg-chart-2"
              : event.startsWith("purchase")
                ? "bg-chart-3"
                : event.startsWith("expense")
                  ? "bg-chart-4"
                  : event.startsWith("user")
                    ? "bg-chart-1"
                    : event.startsWith("investment")
                      ? "bg-chart-6"
                      : event.startsWith("item")
                        ? "bg-chart-5"
                        : "bg-chart-6";
          return (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Activity</h1>
                  <p className="text-sm text-muted">{shown.length} events · who did what, when</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input max-w-52" value={activityFilter} onChange={(e) => setActivityFilter(e.currentTarget.value)}>
                    <option value="">All members</option>
                    {actors.map((actor) => (
                      <option key={actor} value={actor}>{actor}</option>
                    ))}
                  </select>
                  <button
                    className="btn-mini"
                    disabled={activityBusy}
                    onClick={() => void refreshActivity()}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {Object.entries(days).map(([day, rows]) => (
                <div key={day} className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{day}</p>
                  <div className="card divide-y divide-line">
                    {rows.map((row) => (
                      <div key={row.id} className="flex items-start gap-3 p-3">
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot(row.event)}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{row.summary}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {new Date(row.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                            <span className="mx-1.5">·</span>
                            <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{row.actor}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {shown.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
              {activityHasMore && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    className="btn-mini"
                    disabled={activityBusy}
                    onClick={() => void loadMoreActivity()}
                  >
                    {activityBusy ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </section>
          );
        })()}
      </main>
      {/* The floating chat button — everywhere except Team Chat / Login / Register. */}
      {view !== "team-chat" && (
        <ChatFab
          onOpen={() => {
            setChatTargetRoom(onlyUnreadRoom());
            setView("team-chat");
          }}
        />
      )}
    </div>
    </>
  );
}
