/**
 * The global toast store (Phase 15, component 4).
 *
 * A tiny store instead of a context: any module can call `showToast(...)`
 * without a provider, and the host renders whatever is in the store.
 */
export type ToastType = "success" | "error" | "warning" | "info";

export type Toast = {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(toasts: Toast[]) => void>();

function publish() {
  for (const listener of listeners) listener(toasts);
}

/** Listen to the toasts (the host does). */
export function subscribeToasts(listener: (toasts: Toast[]) => void): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

/** The toasts that are on screen right now. */
export function getToasts(): Toast[] {
  return toasts;
}

/** Show a toast. It hides itself after `duration` milliseconds (3–5 seconds). */
export function showToast(
  message: string,
  type: ToastType = "info",
  duration = 4000,
): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, type, duration }].slice(-4);
  publish();
  if (duration > 0) {
    window.setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

/** Close a toast. */
export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id);
  publish();
}
