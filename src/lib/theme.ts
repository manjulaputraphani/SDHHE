/**
 * Theme handling for the coffee-house palette (shared by the desktop app and the web edition).
 *
 * - Three modes: "light", "dark" and "system" (follows prefers-color-scheme).
 * - The mode is stored in localStorage; the resolved theme is written to
 *   <html data-theme="light|dark"> so the CSS variables can swap.
 * - index.html runs the same resolution inline before first paint, so there is no flash.
 */

export type ThemeMode = "light" | "dark" | "system" | "contrast";
export type ResolvedTheme = "light" | "dark" | "contrast";

const STORAGE_KEY = "sdhhe-theme";

function readStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" || value === "contrast"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

function writeStoredMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / storage blocked — the theme still works for this session */
  }
}

export function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return prefersDark() ? "dark" : "light";
  return mode;
}
/** Writes the resolved theme onto <html>. Returns the resolved theme. */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

/* ---- tiny external store so every toggle instance stays in sync ---- */

let currentMode: ThemeMode = readStoredMode();
const listeners = new Set<() => void>();

export function getMode(): ThemeMode {
  return currentMode;
}

export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Switches the theme and animates the 200ms cross-fade. */
export function setMode(mode: ThemeMode): void {
  currentMode = mode;
  writeStoredMode(mode);
  const root = document.documentElement;
  root.classList.add("theme-anim");
  applyTheme(mode);
  window.setTimeout(() => root.classList.remove("theme-anim"), 260);
  emit();
}

/** Keeps "system" mode in sync with the OS while the app is open. */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (currentMode !== "system") return;
    const root = document.documentElement;
    root.classList.add("theme-anim");
    applyTheme("system");
    window.setTimeout(() => root.classList.remove("theme-anim"), 260);
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
