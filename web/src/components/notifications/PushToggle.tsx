/**
 * The phone notifications toggle (Phase 16) — Cloudflare Web Push.
 *
 * The browser subscribes with the app's VAPID key and the Worker sends the
 * pushes. No third-party app is needed.
 */
import { useEffect, useState } from "react";
import { api } from "../../api";
import { showToast } from "./toastStore";

function toBase64Url(bytes: ArrayBuffer): string {
  const array = new Uint8Array(bytes);
  let text = "";
  for (const byte of array) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function PushToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((subscription) => setOn(Boolean(subscription)))
      .catch(() => undefined);
  }, []);

  async function subscribe() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        showToast("The notifications need your permission", "warning");
        return;
      }
      const { publicKey } = await api.pushKey();
      if (!publicKey) {
        showToast("The push keys are not configured yet", "error");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const key = Uint8Array.from(
        atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (char) => char.charCodeAt(0),
      );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as unknown as BufferSource,
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      await api.pushSubscribe({
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      setOn(true);
      showToast("Phone notifications are on", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
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

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;

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
