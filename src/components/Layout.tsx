import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import CoffeeIcon from "./CoffeeIcon";
import ThemeToggle from "./ThemeToggle";
import { getAuditActor } from "../db/activity";
import { can } from "../db/permissions";
import type { ModuleKey, PermissionAction } from "../logic/permissions";

type Link = { to: string; label: string; end?: boolean; module: ModuleKey; action?: PermissionAction };

const GROUPS: { heading: string; links: Link[] }[] = [
  {
    heading: "Overview",
    links: [
      { to: "/", label: "Dashboard", end: true, module: "dashboard" },
      { to: "/suggestions", label: "Suggestions", module: "dashboard" },
      { to: "/chat", label: "Ask AI", module: "dashboard" },
    ],
  },
  {
    heading: "Stock",
    links: [
      { to: "/items", label: "Items", module: "items" },
      { to: "/purchases", label: "Purchases", module: "purchases" },
      { to: "/purchases/new", label: "Add Purchase", module: "purchases", action: "create" },
      { to: "/stock-check", label: "Stock Check", module: "stock" },
      { to: "/billing", label: "GST Billing", module: "billing" },
      { to: "/bills", label: "Bills", module: "bills" },
      { to: "/sales", label: "Sales", module: "bills" },
    ],
  },
  {
    heading: "Money",
    links: [
      { to: "/expenses", label: "Expenses", module: "expenses" },
      { to: "/suppliers", label: "Supplier Dues", module: "expenses" },
      { to: "/reports", label: "Reports", module: "reports" },
      { to: "/analytics", label: "Analytics", module: "dashboard" },
      { to: "/analysis", label: "Batch Analysis", module: "reports" },
    ],
  },
  {
    heading: "System",
    links: [{ to: "/settings", label: "Settings", module: "settings" }],
  },
];

export default function Layout() {
  const actor = getAuditActor();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const groups = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => can(link.module, link.action ?? "view")),
  })).filter((group) => group.links.length > 0);

  // On desktop, always show sidebar. On mobile, hide until opened.
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="flex min-h-screen bg-bg text-ink relative">
      {/* Mobile top bar */}
      {isMobile && (
        <header className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between bg-surface border-b border-line px-4 py-3">
          <button
            type="button"
            className="rounded-lg bg-surface-2 px-3 py-2 text-ink hover:bg-surface-3"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-[15px] text-ink tracking-tight">
            SREE DURGA HARIHARA
          </span>
          <ThemeToggle onDark className="ml-auto" />
        </header>
      )}

      {/* Sidebar */}
      <aside
        className={`
          transition-all duration-300 ease-in-out
          flex h-screen flex-col overflow-y-auto bg-nav text-nav-text border-r border-nav-line
          ${isMobile
            ? `fixed top-0 left-0 z-50 w-64 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`
            : "sticky top-0 w-60 shrink-0"}
        `}
      >
        <div className="flex items-center gap-3 border-b border-nav-line px-4 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-nav-text/15 text-nav-text">
            <CoffeeIcon />
          </span>
          <span className={isMobile ? "hidden" : "min-w-0"}>
            <span className="block text-[11.5px] font-semibold uppercase leading-snug tracking-[0.08em] text-nav-text">
              SREE DURGA HARIHARA ENTERPRISES
            </span>
            <span className="mt-1 block text-[9.5px] uppercase tracking-[0.2em] text-nav-muted">
              Inventory · Billing · Accounts
            </span>
          </span>
          {isMobile && (
            <button
              type="button"
              className="ml-auto rounded-lg bg-nav-text/10 p-2 text-nav-text hover:bg-nav-text/20"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.heading} className="mb-3">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-muted">
                {group.heading}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      `rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-nav-active font-medium text-nav-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          : "text-nav-muted hover:bg-nav-hover hover:text-nav-text"
                      }`
                    }
                    onClick={() => {
                      if (isMobile) setSidebarOpen(false);
                    }}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-nav-line px-5 py-3">
          <ThemeToggle onDark className="mb-3" />
          <p className="text-[11px] text-nav-muted">{actor.name} · {(actor.role ?? "staff").toUpperCase()}</p>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`min-w-0 flex-1 transition-all duration-300 ${
          isMobile ? "pt-16" : ""
        }`}
      >
        <main className={`mx-auto max-w-6xl px-8 py-8 ${isMobile ? "px-4 pt-2 pb-4" : "px-8 py-8"}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
