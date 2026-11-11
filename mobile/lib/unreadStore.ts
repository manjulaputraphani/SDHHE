/**
 * A tiny global store for the total unread chat count (Phase 18).
 *
 * The bottom-bar Chats tab shows it as a badge, so the indicator lives on
 * EVERY screen (Dashboard included, the owner's landing page) — the same way
 * the web sidebar shows the unread chip.
 *
 * Sources: the root layout polls /api/chat/conversations while signed in, and
 * the chats list keeps it fresh on every load (focus / 15s poll / room exit).
 */

let total = 0;
const listeners = new Set<() => void>();

export function setUnreadTotal(value: number): void {
  const next = Math.max(0, Math.floor(value));
  if (next === total) return;
  total = next;
  listeners.forEach((fn) => fn());
}

export function getUnreadTotal(): number {
  return total;
}

export function subscribeUnreadTotal(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
