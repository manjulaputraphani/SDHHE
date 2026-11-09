/**
 * The mobile layout (max-width 767px ONLY) — shared hooks and the tiny
 * "immersive" store that hides the app header and the bottom nav while a
 * chat or its info page owns the full screen.
 *
 * Desktop (≥768px) never sets the store, so nothing changes there.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** The new mobile layout is max-width 767px ONLY. */
export const MOBILE_QUERY = "(max-width: 767px)";

/** Is this a phone-sized viewport? (re-renders on resize) */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/** Is the phone keyboard open? (the visual viewport shrinks on iOS/Android) */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      if (!window.matchMedia(MOBILE_QUERY).matches) {
        setOpen(false);
        return;
      }
      setOpen(window.innerHeight - vv.height > 120);
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);
  return open;
}

/** The tab badge text — "99+" above 99, "" when there is nothing to show. */
export function formatTabBadge(count: number): string {
  if (!(count > 0)) return "";
  return count > 99 ? "99+" : String(count);
}

// ---- "Immersive": the open chat / info page owns the whole screen ----

let immersive = false;
const listeners = new Set<() => void>();

export function getImmersive(): boolean {
  return immersive;
}

export function setImmersive(next: boolean): void {
  if (immersive === next) return;
  immersive = next;
  for (const listener of listeners) listener();
}

export function subscribeChrome(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding for the immersive flag (used by the app shell). */
export function useImmersive(): boolean {
  return useSyncExternalStore(subscribeChrome, getImmersive, getImmersive);
}

// ---- Android back / iOS swipe-back: one history entry per open layer ----

type BackLayer = { onBack: () => void; pending: boolean };
const layers: BackLayer[] = [];
let installed = false;
let silentUntil = 0;

/**
 * Is the current popstate a silent one (a layer closed itself and dropped its
 * history entry)? Every popstate listener must skip these — the app's URL
 * sync would otherwise "navigate" on a pop that changed nothing.
 */
export function isSilentPop(): boolean {
  return Date.now() < silentUntil;
}

function onPopstate(): void {
  if (isSilentPop()) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  top.pending = false; // the browser already dropped the entry
  top.onBack(); // close the layer — its cleanup removes it from the stack
}

/**
 * While `active`, a hardware/swipe back closes THIS layer (sheet, info page,
 * open chat) instead of leaving the app. Closing the layer from the screen
 * drops its history entry silently. Last registered = first to close.
 */
export function useBackGuard(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!active) return;
    if (!installed) {
      installed = true;
      window.addEventListener("popstate", onPopstate);
    }
    // The layer always calls the LATEST onBack (the closures change every render).
    const layer: BackLayer = { onBack: () => latest.current(), pending: true };
    layers.push(layer);
    window.history.pushState({ ...(window.history.state ?? {}), sdhheLayer: true }, "");
    return () => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      // Closed from the screen itself — drop the sentinel entry quietly.
      if (layer.pending) {
        layer.pending = false;
        silentUntil = Date.now() + 250;
        window.history.back();
      }
    };
  }, [active]);
}
