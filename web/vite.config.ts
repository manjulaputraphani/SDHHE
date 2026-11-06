import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: { allow: [".."] },
    // The Team Chat socket lives under /api as well, so the dev proxy has to
    // forward WebSocket upgrades too (ws: true).
    proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true } },
  },
});
