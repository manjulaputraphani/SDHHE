/**
 * The "what's new" window (Phase 15, component 5).
 *
 * It opens once per member after a new release. "Got it" closes it, "Take the
 * tour" starts the product tour. The focus stays inside, Esc closes it and the
 * background is dimmed.
 */
import { useRef } from "react";
import { useFocusTrap } from "./useFocusTrap";

export type ReleaseData = {
  id: number;
  version: string;
  title: string;
  items: string[];
  imageUrl: string | null;
};

export default function WhatsNewModal({
  release,
  onClose,
  onTakeTour,
}: {
  release: ReleaseData;
  onClose: () => void;
  onTakeTour: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="card max-h-viewport-85 w-full max-w-md overflow-y-auto p-5"
      >
        {release.imageUrl && (
          <img
            src={release.imageUrl}
            alt=""
            className="mb-3 max-h-40 w-full rounded-xl border border-line object-cover"
          />
        )}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Version {release.version}
        </p>
        <h2 id="whats-new-title" className="mt-1 text-lg font-semibold text-ink">
          {release.title}
        </h2>
        <ul className="mt-3 space-y-2">
          {release.items.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-ink">
              <span aria-hidden="true" className="mt-0.5 text-accent-ink">
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
          <button type="button" className="btn btn-secondary" onClick={onTakeTour}>
            Take the tour
          </button>
        </div>
      </div>
    </div>
  );
}
