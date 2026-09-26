// Bundles the main process, its worker and the preload scripts with esbuild.
//
// Everything the main process needs (the adblock engine, tldts, …) is
// bundled in, so the packaged app ships only out/ and no node_modules.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  // Libraries bundled from their ES module builds find files next to
  // themselves through import.meta.dirname; in this CommonJS bundle that is
  // __dirname (out/main).
  define: { ...common.define, "import.meta.dirname": "__dirname" },
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

// The extension libraries look for their preloads next to the bundle that
// uses them (the packaged app has no node_modules).
await copyFile(
  require.resolve("electron-chrome-web-store/preload"),
  resolve(root, "out/main/chrome-web-store.preload.js"),
);

// The chrome.* API preload of electron-chrome-extensions hands its IPC
// bridge to the page through a global `electron` object and deletes it
// again — but a context-bridge global can't be deleted, so an extension's
// pages and service worker could call the bridge with another extension's
// ID and borrow its permissions. Passed as an argument instead, the bridge
// stays inside the chrome.* functions, which always send their own ID.
// (src/main/extensions.ts registers this copy in place of the original.)
{
  let preload = await readFile(require.resolve("electron-chrome-extensions/preload"), "utf8");
  const patches = [
    ['import_electron2.contextBridge.exposeInMainWorld("electron", electronContext);', ""],
    [
      "function mainWorldScript() {\n      const electron = globalThis.electron || electronContext;",
      "function mainWorldScript(bridge) {\n      const electron = bridge || electronContext;",
    ],
    ["func: mainWorldScript\n", "func: mainWorldScript,\n          args: [electronContext]\n"],
  ];
  for (const [from, to] of patches) {
    if (preload.split(from).length !== 2)
      throw new Error(`electron-chrome-extensions preload changed; can't patch: ${from}`);
    preload = preload.replace(from, to);
  }
  await writeFile(resolve(root, "out/main/chrome-extension-api.preload.js"), preload);
}
