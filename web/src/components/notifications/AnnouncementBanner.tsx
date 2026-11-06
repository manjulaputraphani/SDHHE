/**
 * The announcement banner (Phase 15, component 3).
 *
 * A full-width bar at the top of every page: news, updates or offers. It can
 * be closed, and the dismissal is remembered in the database — so it does not
 * come back on the other device either.
 */
export type AnnouncementKind = "info" | "success" | "warning" | "critical";

export type AnnouncementData = {
  id: number;
  title: string;
  message: string;
  kind: AnnouncementKind;
  linkLabel: string | null;
  linkUrl: string | null;
};

const TONE: Record<AnnouncementKind, string> = {
  info: "border-line bg-surface-2 text-ink",
  success: "border-success-soft bg-success-soft text-success-ink",
  warning: "border-accent-soft bg-accent-soft text-accent-ink",
  critical: "border-error-soft bg-error-soft text-error-ink",
};

export default function AnnouncementBanner({
  announcement,
  onDismiss,
}: {
  announcement: AnnouncementData;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${TONE[announcement.kind]}`}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{announcement.title}</p>
        <p className="mt-0.5 text-sm opacity-90">{announcement.message}</p>
        {announcement.linkUrl && (
          <a
            href={announcement.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-block text-sm font-medium underline underline-offset-2"
          >
            {announcement.linkLabel || "Open"}
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(announcement.id)}
        className="tap-44 grid shrink-0 place-items-center rounded px-1.5 text-xs opacity-70 hover:opacity-100"
        aria-label={`Close the announcement: ${announcement.title}`}
      >
        ✕
      </button>
    </div>
  );
}
