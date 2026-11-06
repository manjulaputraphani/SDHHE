/**
 * The phone notifications toggle (Phase 16) — Cloudflare Web Push.
 *
 * The browser subscribes with the app's VAPID key and the Worker sends the
 * pushes. No third-party app is needed. The plumbing lives in pushSetup —
 * the app also subscribes by default (once), this button shows the state
 * and lets the member switch it off.
 */
import { useEffect, useState } from "react";
import { ensurePushSubscription, pushSupported } from "./pushSetup";
import { api } from "../../api";
import { showToast } from "./toastStore";

export default function PushToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setOn(Boolean(subscription)))
      .catch(() => undefined);
  }, []);

  async function subscribe() {
    setBusy(true);
    try {
      const outcome = await ensurePushSubscription();
      if (outcome === "on") {
        setOn(true);
        showToast("Phone notifications are on", "success");
      } else if (outcome === "permission") {
        showToast("The notifications need your permission", "warning");
      } else if (outcome === "no-keys") {
        showToast("The push keys are not configured yet", "error");
      } else if (outcome !== "unsupported") {
        showToast("Notifications could not be turned on", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api.pushUnsubscribe(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setOn(false);
      showToast("Phone notifications are off", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!pushSupported()) return null;

  return (
    <button
      type="button"
      className="btn-mini"
      disabled={busy}
      onClick={() => (on ? void unsubscribe() : void subscribe())}
      title="Notifications on your phone, even when the app is closed"
    >
      {on ? "🔔 Notifications on" : "🔕 Turn on notifications"}
    </button>
  );
}
