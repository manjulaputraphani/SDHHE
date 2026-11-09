/**
 * The shared push plumbing (Phase 16 + the default-on rule of 2026-11-07).
 *
 * One function does the whole round-trip: ask for the permission (if the
 * browser still shows the prompt), register the service worker, subscribe
 * with the VAPID key and tell the Worker. It is idempotent — a browser that
 * is already subscribed only re-syncs its endpoint.
 */
import { api } from "../../api";

export type PushOutcome = "on" | "permission" | "no-keys" | "unsupported" | "error";

/** Can this browser receive the team pushes at all? */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Subscribe THIS browser to the message pushes (idempotent). */
export async function ensurePushSubscription(): Promise<PushOutcome> {
  if (!pushSupported()) return "unsupported";
  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return "permission";

    const { publicKey } = await api.pushKey();
    if (!publicKey) return "no-keys";

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(
      atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    // Always create a FRESH subscription — the old one may be bound to a
    // different VAPID key (VapidPkHashMismatch), so reuse is never safe.
    const old = await registration.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as unknown as BufferSource,
    });
    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";
    await api.pushSubscribe({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
    return "on";
  } catch {
    return "error";
  }
}

/** Has the member already answered the one automatic permission prompt? */
export function pushAsked(): boolean {
  try {
    return localStorage.getItem("sdhhe-push-asked") === "1";
  } catch {
    return true;
  }
}

/** Remember that the one automatic prompt happened (never nag twice). */
export function markPushAsked(): void {
  try {
    localStorage.setItem("sdhhe-push-asked", "1");
  } catch {
    // Private mode — the prompt may come back after a reload, that is fine.
  }
}
