// Bundles the main process, its worker and the preload scripts with esbuild.
//
// Everything the main process needs (the adblock engine, tldts, …) is
// bundled in, so the packaged app ships only out/ and no node_modules.
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const production = process.env.NODE_ENV !== "development";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: production ? false : "inline",
  minify: false,
  external: ["electron"],
  logLevel: "info",
  alias: { "@shared": resolve(root, "src/shared") },
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
};

await build({
  ...common,
  entryPoints: {
    "main/index": resolve(root, "src/main/index.ts"),
    "main/adblock-worker": resolve(root, "src/main/adblock-worker.ts"),
  },
  outdir: resolve(root, "out"),
  outExtension: { ".js": ".cjs" },
});

// Preloads run in sandboxed renderers: CommonJS, only `electron` available.
await build({
  ...common,
  platform: "browser",
  target: "chrome130",
  entryPoints: {
    "preload/ui": resolve(root, "src/preload/ui.ts"),
    "preload/internal": resolve(root, "src/preload/internal.ts"),
  },
  outdir: resolve(root, "out"),
  outExtension: { ".js": ".cjs" },
});

// The cosmetic-filter preload of the adblock engine (element hiding and
// scriptlets) is used as it ships.
await mkdir(resolve(root, "out/preload"), { recursive: true });
await copyFile(
  require.resolve("@ghostery/adblocker-electron-preload"),
  resolve(root, "out/preload/adblock-cosmetics.cjs"),
);
