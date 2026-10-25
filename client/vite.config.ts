import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    host: true,
    port: 5173,
    // Same-origin HTTP to the server, so phones on the LAN avoid CORS (used by voice uploads).
    proxy: {
      "/api": { target: "http://localhost:8787", rewrite: (p) => p.replace(/^\/api/, "") },
      "/generated": { target: "http://localhost:8787" },
    },
  },
});
