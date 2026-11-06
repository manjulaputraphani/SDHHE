/**
 * The welcome banner (Phase 15, component 1).
 *
 * "Welcome back, {name}!" with the time of the last sign-in. It can be
 * closed and stays closed for the rest of the session.
 */
export type WelcomeBannerProps = {
  name: string;
  lastLoginAt: string | null;
  onDismiss: () => void;
};

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

export default function WelcomeBanner({ name, lastLoginAt, onDismiss }: WelcomeBannerProps) {
  return (
    <div className="card flex items-start gap-3 p-4" role="status">
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
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded px-1.5 text-xs text-muted hover:text-ink"
        aria-label="Close the welcome message"
      >
        ✕
      </button>
    </div>
  );
}
