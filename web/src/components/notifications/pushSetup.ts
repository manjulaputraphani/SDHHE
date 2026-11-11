/**
 * The shared push plumbing (Phase 16 + the default-on rule of 2026-11-07,
 * FCM cutover 2026-11-11).
 *
 * One function does the whole round-trip: ask for the permission (if the
 * browser still shows the prompt), register the service worker, then try
 * FCM first (the same Firebase project as the Android app) and fall back to
 * the VAPID Web Push path when the Firebase web config is not there yet.
 * Either way the browser ends up with EXACTLY ONE subscription — a second
 * one would push every message twice.
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

/**
 * The Firebase web config (project settings → your web app → the SDK snippet).
 * It is intentionally absent until the owner adds the Web app in the Firebase
 * console — then FCM takes over and the VAPID path below stops being used.
 */
function firebaseWebConfig():
  | { apiKey: string; appId: string; projectId: string; messagingSenderId: string }
  | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined;
  if (!apiKey || !appId || !projectId || !messagingSenderId) return null;
  return { apiKey, appId, projectId, messagingSenderId };
}

/**
 * Ask Firebase for this browser's FCM registration token (null when the web
 * config is missing or anything fails — the caller falls back to VAPID).
 * The existing /sw.js registration is passed in on purpose: Firebase would
 * otherwise try to register a /firebase-messaging-sw.js that does not exist.
 */
async function fcmRegistrationToken(registration: ServiceWorkerRegistration): Promise<string | null> {
  const config = firebaseWebConfig();
  if (!config) return null;
  try {
    const { initializeApp } = await import("firebase/app");
    const { getMessaging, getToken } = await import("firebase/messaging");
    const messaging = getMessaging(initializeApp(config));
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
      ...(vapidKey ? { vapidKey } : {}),
    });
    return token || null;
  } catch (err) {
    console.error("push: FCM registration failed, using Web Push instead:", err instanceof Error ? err.message : String(err));
    return null;
  }
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

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    // Always start from a clean slate — a browser carries ONE subscription.
    // The old one may be bound to a different VAPID key (VapidPkHashMismatch),
    // and a browser that switches transport must drop its old row too.
    const previous = await registration.pushManager.getSubscription();
    if (previous) {
      try {
        await previous.unsubscribe();
      } catch {
        // Old subscription already gone — that's fine.
      }
    }
    const previousEndpoint = previous?.toJSON().endpoint;

    // 1) FCM — the same send path as the Android app. Needs the Firebase web
    //    config in web/.env; without it this returns null immediately.
    const fcmToken = await fcmRegistrationToken(registration);
    if (fcmToken) {
      // The server stores the token AND forgets the old VAPID row (passed as
      // `endpoint`) so this browser is never pushed twice.
      await api.pushSubscribeFcm(fcmToken, previousEndpoint);
      return "on";
    }

    // 2) Web Push with our own VAPID key (Phase 16 — unchanged fallback).
    const { publicKey } = await api.pushKey();
    if (!publicKey) return "no-keys";
    const key = Uint8Array.from(
      atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
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
  } catch (err) {
    console.error("push: subscription failed:", err instanceof Error ? err.message : String(err));
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
