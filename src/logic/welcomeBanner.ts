/**
 * The one-time welcome-banner flag (Phase 15 fix).
 *
 * The "Welcome back" banner must appear ONLY right after a successful login
 * — never on a page refresh, a tab change, a token refresh or a new tab.
 *
 * How: the login success handler in the web app calls `setWelcomeFlag()`
 * (sessionStorage — per tab, gone when the tab closes). The notification
 * host calls `consumeWelcomeFlag()` exactly once on mount: the first read
 * returns true and clears the flag, so nothing later in the same tab (a
 * refresh, a reconnect) can show the banner again, and a new tab has an
 * empty sessionStorage anyway.
 */
export const WELCOME_FLAG_KEY = "sdhhe:just-logged-in";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Called from the login success handler only. */
export function setWelcomeFlag(): void {
  storage()?.setItem(WELCOME_FLAG_KEY, "1");
}

/**
 * Read the flag once and clear it immediately — the banner shows only for
 * the first consumer after a real login.
 */
export function consumeWelcomeFlag(): boolean {
  const store = storage();
  if (!store?.getItem(WELCOME_FLAG_KEY)) return false;
  store.removeItem(WELCOME_FLAG_KEY);
  return true;
}

/** Called on logout — the flag must not survive into the next session. */
export function clearWelcomeFlag(): void {
  storage()?.removeItem(WELCOME_FLAG_KEY);
}
