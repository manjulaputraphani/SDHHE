/**
 * The "More" bottom sheet (mobile, max-width 767px ONLY) — every other
 * screen grouped like the desktop sidebar, plus the theme switch, the signed
 * in member and Sign out. The Android back / iOS swipe-back closes this sheet
 * first (useBackGuard).
 */
import type { ReactNode } from "react";
import { useBackGuard } from "../lib/mobile";
import ThemeToggle from "../ThemeToggle";
import AndroidAppInstall from "./AndroidAppInstall";
import PushToggle from "./notifications/PushToggle";
import { IconContrast, IconMoon, IconSignOut, IconSun } from "./icons";

export type MoreGroup = {
  heading: string | null;
  links: { key: string; label: string; icon: ReactNode; module?: string }[];
};

/** The tabs already have their own buttons — the sheet lists the REST. */
const TAB_KEYS = new Set(["dashboard", "billing", "team-chat"]);

export default function MoreSheet({
  open,
  onClose,
  groups,
  view,
  onNavigate,
  userName,
  userRole,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  groups: MoreGroup[];
  view: string;
  onNavigate: (key: string) => void;
  userName: string;
  userRole: string;
  onSignOut: () => void;
}) {
  useBackGuard(open, onClose);
  if (!open) return null;
  return (
    <div className="sheet-layer" role="dialog" aria-label="More">
      <button
        type="button"
        aria-label="Close menu"
        className="sheet-backdrop"
        onClick={onClose}
      />
      <div className="more-sheet">
        <div className="sheet-grabber" />
        <div className="thin-scrollbar max-h-[70dvh] overflow-y-auto px-3 pb-2">
          {groups.map((group, groupIndex) => {
            const links = group.links.filter((link) => !TAB_KEYS.has(link.key));
            if (links.length === 0) return null;
            return (
              <div key={group.heading ?? `group-${groupIndex}`} className="mb-2">
                {group.heading ? (
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    {group.heading}
                  </p>
                ) : null}
                <div className="flex flex-col gap-0.5">
                  {links.map((link) => (
                    <button
                      key={link.key}
                      type="button"
                      className={`more-sheet__row tap-44 ${view === link.key ? "more-sheet__row--active" : ""}`}
                      onClick={() => {
                        onNavigate(link.key);
                        onClose();
                      }}
                    >
                      <span className="more-sheet__icon">{link.icon}</span>
                      {link.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="more-sheet__footer">
          <div className="more-sheet__theme">
            <IconSun size={16} />
            <ThemeToggle />
            <IconMoon size={15} />
            <IconContrast size={15} />
          </div>
          {/* Mobile: notifications toggle + APK download (both were desktop-only). */}
          <div className="flex items-center gap-2 px-3 py-2">
            <PushToggle />
          </div>
          {typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent) && (
            <AndroidAppInstall
              className="block rounded-lg bg-surface-2 px-3 py-2 text-center text-[11px] font-medium text-ink transition-colors hover:bg-surface-3"
              hintClassName="px-3 text-[10px] leading-snug text-muted"
            />
          )}
          <div className="more-sheet__user">
            <p className="truncate text-sm font-semibold text-ink">{userName}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">{userRole}</p>
          </div>
          <button type="button" className="more-sheet__row more-sheet__row--danger tap-44" onClick={onSignOut}>
            <span className="more-sheet__icon">
              <IconSignOut size={18} />
            </span>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
