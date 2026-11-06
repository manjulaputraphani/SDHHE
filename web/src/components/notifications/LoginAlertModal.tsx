/**
 * The "signed in somewhere else" window (Phase 15, component 7).
 *
 * When the member signs in on another device, the old session is closed and
 * this window explains why.
 */
import { useRef } from "react";
import { useFocusTrap } from "./useFocusTrap";

export default function LoginAlertModal({
  onClose,
  newLogin,
}: {
  onClose: () => void;
  newLogin?: { browser?: string | null; os?: string | null; at?: string | null } | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:items-center sm:p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="login-alert-title"
        className="card w-full max-w-sm p-5"
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink"
        >
          !
        </span>
        <h2 id="login-alert-title" className="mt-3 text-base font-semibold text-ink">
          You were signed out
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your account was signed in on another device, so this session was closed.
        </p>
        {newLogin?.browser && (
          <p className="mt-2 text-xs text-muted">
            New sign-in: {newLogin.browser}
            {newLogin.os ? ` on ${newLogin.os}` : ""}
            {newLogin.at ? ` · ${new Date(newLogin.at).toLocaleString("en-IN")}` : ""}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
