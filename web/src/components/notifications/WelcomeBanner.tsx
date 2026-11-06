/**
 * The welcome banner (Phase 15, fixed in the Phase 15 fix).
 *
 * "Welcome back, {name}!" — a small toast-style card pinned to the TOP-RIGHT,
 * never a full-width block. It is shown ONLY right after a real login (the
 * host passes justLoggedIn), auto-hides after 6 seconds, and the ✕ closes it
 * immediately. "Don't show again" turns the member's DB setting off.
 */
import { useEffect } from "react";

export type WelcomeBannerProps = {
  name: string;
  lastLoginAt: string | null;
  onDismiss: () => void;
  /** Turns the member's show_welcome_banner setting off (persisted in Neon). */
  onDontShowAgain: () => void;
};

/** Auto-hide after 6 seconds. */
const AUTO_HIDE_MS = 6000;

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function WelcomeBanner({
  name,
  lastLoginAt,
  onDismiss,
  onDontShowAgain,
}: WelcomeBannerProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className="card flex w-80 max-w-[calc(100vw-1.5rem)] items-start gap-3 p-3.5 shadow-lg"
      role="status"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink"
      >
        {(name || "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Welcome back, {name}!</p>
        <p className="mt-0.5 text-xs text-muted">
          {lastLoginAt
            ? `Your last sign-in was ${when(lastLoginAt)}.`
            : "This is your first sign-in — have a look around."}
        </p>
        <button
          type="button"
          onClick={onDontShowAgain}
          className="mt-1 text-[11px] text-muted underline transition-colors hover:text-ink"
        >
          Don&apos;t show again
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="tap-44 grid shrink-0 place-items-center rounded px-1.5 text-xs text-muted transition-colors hover:text-ink"
        aria-label="Close the welcome message"
      >
        ✕
      </button>
    </div>
  );
}
