/**
 * The "More" bottom sheet (mobile, max-width 767px ONLY) — every other
 * screen grouped like the desktop sidebar, plus the theme switch, the signed
 * in member and Sign out. The Android back / iOS swipe-back closes this sheet
 * first (useBackGuard).
 */
import { useRef, type ReactNode } from "react";
import { useBackGuard } from "../lib/mobile";
import ThemeToggle from "../ThemeToggle";
import AndroidAppInstall from "./AndroidAppInstall";
import { IconClose, IconSignOut } from "./icons";

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);

  if (!open) return null;
  return (
    <div className="sheet-layer more-sheet-layer" role="dialog" aria-label="More">
      <button
        type="button"
        aria-label="Close menu"
        className="sheet-backdrop"
        onClick={onClose}
      />
      <div
        className="more-sheet"
        onTouchStart={(event) => {
          // Only a pull from the top of the list drags the sheet down; while
          // the menu itself is scrolled the list keeps its own momentum.
          if ((scrollRef.current?.scrollTop ?? 0) <= 0) {
            dragStartY.current = event.touches[0]?.clientY ?? null;
          }
        }}
        onTouchMove={(event) => {
          if (dragStartY.current == null) return;
          const y = event.touches[0]?.clientY ?? dragStartY.current;
          if (y - dragStartY.current > 80) {
            dragStartY.current = null;
            onClose();
          }
        }}
        onTouchEnd={() => {
          dragStartY.current = null;
        }}
      >
        <div className="sheet-grabber" />
        <div className="more-sheet__header">
          <h2 className="more-sheet__title">More</h2>
          <button
            type="button"
            aria-label="Close"
            className="more-sheet__close tap-44"
            onClick={onClose}
          >
            <IconClose size={18} />
          </button>
        </div>
        <div ref={scrollRef} className="thin-scrollbar more-sheet__scroll">
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
          <div className="more-sheet__download">
            <AndroidAppInstall
              className="more-sheet__download-link tap-44"
              hintClassName="more-sheet__download-hint"
            />
          </div>
          <div className="more-sheet__theme">
            <ThemeToggle />
          </div>
          <div className="more-sheet__account">
            <span className="more-sheet__avatar" aria-hidden="true">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <div className="more-sheet__who">
              <p className="more-sheet__name">{userName}</p>
              <p className="more-sheet__role">{userRole}</p>
            </div>
            <button type="button" className="more-sheet__signout tap-44" onClick={onSignOut}>
              <IconSignOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
