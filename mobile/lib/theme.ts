/**
 * SREE DURGA HARIHARA ENTERPRISES — theme tokens.
 *
 * The same colour palette as the web app (light / dark / contrast) mapped to
 * React Native StyleSheet values. Light is default; dark and contrast swap
 * the tokens so every screen adapts.
 */

export type ThemeMode = "light" | "dark" | "contrast";

export type ThemeColors = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  secondary: string;
  secondaryInk: string;
  ink: string;
  muted: string;
  line: string;
  success: string;
  successInk: string;
  successSoft: string;
  error: string;
  errorInk: string;
  errorSoft: string;
  badgeTotal: string;
  badgeContact: string;
  badgeText: string;
  readTick: string;
  shadow: string;
};

/** Light theme — warm cream page, coffee-brown brand (same as web). */
export const lightColors: ThemeColors = {
  bg: "#f7f1e8",
  surface: "#ffffff",
  surface2: "#fbf5ec",
  surface3: "#f2e8da",
  primary: "#6f4e37",
  primaryHover: "#5b3f2c",
  onPrimary: "#f7f1e8",
  accent: "#c8963e",
  accentSoft: "#f7ebd6",
  accentInk: "#7f5c1e",
  secondary: "#7a8b5a",
  secondaryInk: "#5c6b41",
  ink: "#3b2a20",
  muted: "#7d6b5d",
  line: "#e6d9c8",
  success: "#4f8a4b",
  successInk: "#3c7539",
  successSoft: "#e9f5ea",
  error: "#b84a3a",
  errorInk: "#a83e30",
  errorSoft: "#fdf0f0",
  badgeTotal: "#c2410c",
  badgeContact: "#2e8b57",
  badgeText: "#ffffff",
  readTick: "#34b7f1",
  shadow: "rgba(59, 42, 32, 0.10)",
};

/** Dark theme — deep coffee background, latte text (same as web). */
export const darkColors: ThemeColors = {
  ...lightColors,
  bg: "#1c1612",
  surface: "#2a211b",
  surface2: "#322821",
  surface3: "#3d3129",
  primary: "#c8a27c",
  primaryHover: "#d8b48f",
  onPrimary: "#1c1612",
  accent: "#e0b060",
  accentSoft: "#3a2c19",
  accentInk: "#e0b060",
  secondary: "#9db07a",
  secondaryInk: "#9db07a",
  ink: "#f2e8dc",
  muted: "#b5a595",
  line: "#3a2e25",
  shadow: "transparent",
};

/** Contrast theme — white surfaces, espresso ink (same as web). */
export const contrastColors: ThemeColors = {
  ...lightColors,
  bg: "#ffffff",
  surface: "#ffffff",
  surface2: "#f4ede4",
  surface3: "#e9dfd3",
  primary: "#3e2a1f",
  primaryHover: "#2a1c14",
  accent: "#6b4f3a",
  accentInk: "#6b4f3a",
  ink: "#1a0f08",
  muted: "#4a3b30",
  line: "#3e2a1f",
  shadow: "transparent",
};

const MODES: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
  contrast: contrastColors,
};

export function getColors(mode: ThemeMode): ThemeColors {
  return MODES[mode] ?? lightColors;
}
