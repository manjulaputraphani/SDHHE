/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The app screens are heavy (the Settings screen re-renders everything on
    // every keystroke), so the default 5 s was too tight for a loaded CI
    // runner — the tests were timing out although the app was fine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // DB tests need a live database — run them with `npm run test:db`, never in the normal suite.
    // The Playwright specs (desktop e2e/ and web e2e-web/) are not unit tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.int.test.ts", "e2e/**", "e2e-web/**"],
  },
}));
