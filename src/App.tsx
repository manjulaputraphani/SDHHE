import { useCallback, useEffect, useState, type ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./App.css";
import Layout from "./components/Layout";
import { DbProvider } from "./lib/db-context";
import { getSecret, SECRET_KEYS } from "./lib/secrets";
import { watchSystemTheme } from "./lib/theme";
import { setAuditActor } from "./db/activity";
import { can, setCurrentPermissions } from "./db/permissions";
import type { ModuleKey, PermissionAction } from "./logic/permissions";
import AddPurchase from "./pages/AddPurchase";
import Billing from "./pages/Billing";
import Bills from "./pages/Bills";
import Chat from "./pages/Chat";
import ComingSoon from "./pages/ComingSoon";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import Analysis from "./pages/Analysis";
import Expenses from "./pages/Expenses";
import Items from "./pages/Items";
import Lock from "./pages/Lock";
import Purchases from "./pages/Purchases";
import Reports from "./pages/Reports";
import Sales from "./pages/Sales";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import StockCheck from "./pages/StockCheck";
import Suppliers from "./pages/Suppliers";
import Suggestions from "./pages/Suggestions";
import TeamChat from "./pages/TeamChat";
type Phase = "loading" | "setup" | "login" | "home";

/** Block a desktop route when the signed-in role lacks the permission. */
function Guarded({
  module,
  action = "view",
  children,
}: {
  module: ModuleKey;
  action?: PermissionAction;
  children: ReactNode;
}) {
  if (!can(module, action)) {
    return <main className="p-8 text-sm text-muted">You do not have permission to open this screen.</main>;
  }
  return <>{children}</>;
}

/** The desktop app signs itself out after 30 minutes of inactivity. */
const IDLE_LOCK_MS = 30 * 60 * 1000;

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [url, setUrl] = useState<string | null>(null);

  /** No saved connection → setup. Saved connection → ask for the PIN. */
  const bootstrap = useCallback(async () => {
    try {
      const savedUrl = await getSecret(SECRET_KEYS.DATABASE_URL);
      if (savedUrl) {
        setUrl(savedUrl);
        setPhase("login");
      } else {
        setUrl(null);
        setPhase("setup");
      }
    } catch {
      // Keychain unreachable → let the user set things up again.
      setUrl(null);
      setPhase("setup");
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => watchSystemTheme(), []);

  /**
   * The idle lock: half an hour without a mouse or a key press signs the member
   * out of the desktop app (the web edition does the same on the server).
   */
  useEffect(() => {
    if (phase !== "home") return;
    let lastActivity = Date.now();
    const mark = () => {
      lastActivity = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, mark, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity < IDLE_LOCK_MS) return;
      window.clearInterval(timer);
      setAuditActor(null);
      setCurrentPermissions(null);
      setPhase("login");
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      for (const name of events) window.removeEventListener(name, mark);
    };
  }, [phase]);

  if (phase === "loading") {
    return <main className="p-8 text-sm text-muted">Loading…</main>;
  }

  if (phase === "setup") {
    return <Setup onDone={() => void bootstrap()} />;
  }

  if (phase === "login") {
    return <Lock url={url ?? ""} onLogin={() => setPhase("home")} />;
  }

  return (
    <DbProvider url={url}>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Guarded module="dashboard"><Dashboard /></Guarded>} />
            <Route path="items" element={<Guarded module="items"><Items /></Guarded>} />
            <Route path="suggestions" element={<Guarded module="dashboard"><Suggestions /></Guarded>} />
            <Route path="chat" element={<Guarded module="dashboard"><Chat /></Guarded>} />
            <Route path="purchases" element={<Guarded module="purchases"><Purchases /></Guarded>} />
            <Route path="purchases/new" element={<Guarded module="purchases" action="create"><AddPurchase /></Guarded>} />
            <Route path="stock-check" element={<Guarded module="stock"><StockCheck /></Guarded>} />
            <Route path="billing" element={<Guarded module="billing"><Billing /></Guarded>} />
            <Route path="bills" element={<Guarded module="bills"><Bills /></Guarded>} />
            <Route path="sales" element={<Guarded module="bills"><Sales /></Guarded>} />
            <Route path="expenses" element={<Guarded module="expenses"><Expenses /></Guarded>} />
            <Route path="suppliers" element={<Guarded module="expenses"><Suppliers /></Guarded>} />
            <Route path="reports" element={<Guarded module="reports"><Reports /></Guarded>} />
            <Route path="team-chat" element={<Guarded module="chat"><TeamChat /></Guarded>} />
            <Route path="analytics" element={<Guarded module="dashboard"><Analytics /></Guarded>} />
            <Route path="analysis" element={<Guarded module="reports"><Analysis /></Guarded>} />
            <Route
              path="settings"
              element={
                <Guarded module="settings">
                  <Settings
                    onLock={() => {
                      setAuditActor(null);
                      setCurrentPermissions(null);
                      setPhase("login");
                    }}
                    onReset={() => {
                      setUrl(null);
                      setAuditActor(null);
                      setCurrentPermissions(null);
                      setPhase("setup");
                    }}
                  />
                </Guarded>
              }
            />
            <Route path="*" element={<ComingSoon title="Not found" />} />
          </Route>
        </Routes>
      </HashRouter>
    </DbProvider>
  );
}
