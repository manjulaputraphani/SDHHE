/**
 * The toast host (Phase 15, component 4).
 *
 * The toasts are stacked in the bottom-right corner on a big screen and in
 * the bottom-centre on a phone (they must not cover the navigation).
 */
import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast, type ToastType } from "./toastStore";

const TONE: Record<ToastType, string> = {
  success: "border-success-soft bg-success-soft text-success-ink",
  error: "border-error-soft bg-error-soft text-error-ink",
  warning: "border-accent-soft bg-accent-soft text-accent-ink",
  info: "border-line bg-surface-2 text-ink",
};

const ICON: Record<ToastType, string> = {
  success: "✓",
  error: "!",
  warning: "!",
  info: "i",
};

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      <div aria-live="polite" aria-atomic="false" className="contents">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-none flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg ${TONE[toast.type]}`}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface/60 text-[11px] font-semibold"
            >
              {ICON[toast.type]}
            </span>
            <p className="min-w-0 flex-1">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="pointer-events-auto shrink-0 rounded px-1 text-xs opacity-70 hover:opacity-100"
              aria-label="Close notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
