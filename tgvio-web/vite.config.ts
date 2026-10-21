import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { legacyCssPlugin } from "./legacy-css";

// OpenList serves the build from its embedded public/dist: index.html for every
// page route and /assets/* as long-cached static files. Dev mode proxies the API
// and the download routes to a running OpenList (OPENLIST_URL).
const target = process.env.OPENLIST_URL ?? "http://127.0.0.1:5299";
const proxied = ["/api", "/d/", "/p/", "/dav", "/i/"];

export default defineConfig({
  plugins: [react(), tailwindcss(), legacyCssPlugin()],
  base: "/",
  build: {
    // Old Chromium cores (360 / QQ browsers) still run the site.
    target: ["es2020", "chrome80", "safari14"],
    // The main stylesheet stays as before; old cores get *.legacy.css (legacy-css.ts).
    cssTarget: "es2022",
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
