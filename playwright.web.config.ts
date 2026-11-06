import { defineConfig, devices } from "@playwright/test";

/**
 * The web edition (Team Chat) — Playwright against the Vite dev server.
 *
 * The chat screens talk to the Cloudflare Worker; the specs here mock that
 * worker, so the suite runs anywhere (no database, no account).
 */
export default defineConfig({
  testDir: "./e2e-web",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["line"]],
  use: { baseURL: "http://127.0.0.1:5173" },
  webServer: {
    command: "npm --prefix web run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
