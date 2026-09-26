/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Moon Browser renderer build.
//
// Two pages share one asset folder:
//   ui/     the browser itself: tabs, toolbar, address bar (moon://ui/)
//   pages/  the internal pages: new tab, settings, history, … (moon://newtab/ …)
// The main process serves both through the moon:// protocol, so assets are
// referenced from the root ("/assets/…") of whichever moon:// host loads them.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r("./src/renderer"),
  base: "/",
  publicDir: r("./src/renderer/public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": r("./src/shared"),
      "@theme": r("./src/renderer/theme"),
    },
  },
  build: {
    outDir: r("./out/renderer"),
    emptyOutDir: true,
    // Chromium is the only engine that ever runs this code.
    target: "chrome130",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        ui: r("./src/renderer/ui/index.html"),
        pages: r("./src/renderer/pages/index.html"),
      },
    },
  },

  test: {
    root: r("."),
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: true,
    setupFiles: [r("./src/renderer/test-setup.ts")],
  },
});
