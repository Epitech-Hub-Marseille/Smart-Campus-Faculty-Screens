import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the page runs on Vite and the agent on 3000; the page still talks to "its own host".
const agent = process.env.AGENT_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  // Workspace packages are used from their sources in development, so the contract needs no rebuild.
  resolve: { conditions: ["source"] },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 700 },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/live": { target: agent.replace(/^http/, "ws"), ws: true },
      "/media": agent,
      "/audio": agent,
      "/health": agent,
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], globals: false },
});
