/**
 * The bottom navigation bar (mobile, max-width 767px ONLY) — 5 tabs with
 * always-visible labels and a caramel pill behind the active icon (Material 3
 * style). The Chats tab badge comes from the ONE shared unread store (the same
 * numbers as the desktop sidebar badge, the chat rows and the tab title).
 *
 * Hidden while an open chat / info page owns the screen and while the phone
 * keyboard is open (see useImmersive / useKeyboardOpen).
 */
import { useState, useSyncExternalStore, type ReactElement } from "react";
import { getUnread, subscribeUnread } from "../unread";
import { formatTabBadge, useImmersive, useKeyboardOpen } from "../lib/mobile";
import MoreSheet, { type MoreGroup } from "./MoreSheet";
import {
  IconBill,
  IconDashboard,
  IconMenu,
  IconMessagesSquare,
  IconPackage,
} from "./icons";

type Tab = { key: string; label: string; icon: (props: { size?: number }) => ReactElement };

const TABS: Tab[] = [
  { key: "dashboard", label: "Home", icon: IconDashboard },
  { key: "billing", label: "New Bill", icon: IconBill },
  { key: "team-chat", label: "Chats", icon: IconMessagesSquare },
  { key: "stock", label: "Stock", icon: IconPackage },
];

export default function BottomNav({
  view,
  onNavigate,
  groups,
  userName,
  userRole,
  onSignOut,
}: {
  view: string;
  onNavigate: (key: string) => void;
  groups: MoreGroup[];
  userName: string;
  userRole: string;
  onSignOut: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const immersive = useImmersive();
  const keyboardOpen = useKeyboardOpen();
  const unread = useSyncExternalStore(subscribeUnread, getUnread, getUnread);
  const chatBadge = formatTabBadge(unread.total);

  // Hidden: open chat, Group info page, keyboard open (login has no shell).
  if (immersive || keyboardOpen) return null;

  /** Any nav tap closes the sheet — including the More tab itself. */
  function navigate(key: string) {
    setMoreOpen(false);
    onNavigate(key);
  }

  return (
    <>
      <nav className="bottom-nav" aria-label="Main">
        {TABS.map((tab) => {
          const active = !moreOpen && view === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              className={`bottom-nav__tab tap-44 ${active ? "bottom-nav__tab--active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(tab.key)}
            >
              <span className="bottom-nav__icon">
                <span className="bottom-nav__pill" aria-hidden="true" />
                <Icon size={22} />
                {tab.key === "team-chat" && chatBadge && (
                  <span className="bottom-nav__badge" aria-hidden="true">
                    {chatBadge}
                  </span>
                )}
              </span>
              <span className="bottom-nav__label">{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`bottom-nav__tab tap-44 ${moreOpen ? "bottom-nav__tab--active" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="bottom-nav__icon">
            <span className="bottom-nav__pill" aria-hidden="true" />
            <IconMenu size={22} />
          </span>
          <span className="bottom-nav__label">More</span>
        </button>
      </nav>
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        groups={groups}
        view={view}
        onNavigate={navigate}
        userName={userName}
        userRole={userRole}
        onSignOut={onSignOut}
      />
    </>
  );
}
