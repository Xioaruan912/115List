import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// OpenList serves the build from its embedded public/dist: index.html for every
// page route and /assets/* as long-cached static files. Dev mode proxies the API
// and the download routes to a running OpenList (OPENLIST_URL).
const target = process.env.OPENLIST_URL ?? "http://127.0.0.1:5299";
const proxied = ["/api", "/d/", "/p/", "/dav", "/i/"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  build: {
    target: "es2022",
    assetsDir: "assets",
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5180,
    host: "127.0.0.1",
    proxy: Object.fromEntries(proxied.map(p => [p, { target, changeOrigin: true }])),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
