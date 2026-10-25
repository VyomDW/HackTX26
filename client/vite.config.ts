import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    host: "127.0.0.1",
    port: 5176,
    strictPort: true,
    // Same-origin HTTP to the server, so phones on the LAN avoid CORS (used by voice uploads).
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET || "http://localhost:8787", rewrite: (p) => p.replace(/^\/api/, "") },
      "/ws": { target: process.env.API_PROXY_TARGET || "http://localhost:8787", ws: true },
    },
  },
});
