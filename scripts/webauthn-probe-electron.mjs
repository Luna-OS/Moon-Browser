// Temporary: which Electron windows Windows' WebAuthn dialog accepts.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const out = resolve(root, "out", "webauthn-probe-electron.cjs");
await build({
  stdin: {
    contents: `
      import { app, BrowserWindow } from "electron";
      import { WindowsWebAuthn } from "./src/main/webauthn-win";
      import { clientDataJSON } from "./src/shared/webauthn";
      const handle = (w) => w.getNativeWindowHandle().readBigUInt64LE(0);
      app.whenReady().then(async () => {
        const api = WindowsWebAuthn.load();
        const main = new BrowserWindow({ width: 800, height: 600, show: true });
        await main.loadURL("data:text/html,<h1>main</h1>");
        const popup = new BrowserWindow({ show: false, frame: false, parent: main, movable: false, maximizable: false, minimizable: false, fullscreenable: false, resizable: false, skipTaskbar: true, backgroundColor: "#ffffff", roundedCorners: false, width: 360, height: 500 });
        await popup.loadURL("data:text/html,<h1>popup</h1>");
        popup.show();
        const plainChild = new BrowserWindow({ parent: main, width: 300, height: 300, show: true });
        const frameless = new BrowserWindow({ frame: false, width: 300, height: 300, show: true });
        const skip = new BrowserWindow({ skipTaskbar: true, width: 300, height: 300, show: true });
        const ext = "chrome-extension://eiaeiblijfjekdanodkjadfinkhbfgcd";
        const tries = { main, popup, plainChild, frameless, skip };
        for (const [name, win] of Object.entries(tries)) {
          win.focus();
          await new Promise((r) => setTimeout(r, 300));
          const t0 = Date.now();
          let cancel;
          const watchdog = setTimeout(() => cancel && cancel.cancel(), 4000);
          try {
            await api.makeCredential({
              hwnd: handle(win), rpId: ext, rpName: "NordPass",
              user: { id: new Uint8Array(16).fill(7), name: "luna@example.com", displayName: "Luna" },
              algorithms: [-7, -8, -257], clientData: clientDataJSON("webauthn.create", new Uint8Array(32), ext),
              timeout: 60000, exclude: [], attachment: 1, requireResidentKey: false, preferResidentKey: true,
              userVerification: 1, attestation: 1,
            }, (c) => (cancel = c));
          } catch (e) {
            const ms = Date.now() - t0;
            console.log(name.padEnd(12), "0x" + handle(win).toString(16), ms < 1500 ? "REFUSED" : "accepted (dialog)", e.message, ms, "ms");
          } finally { clearTimeout(watchdog); }
        }
        app.exit(0);
      });
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: out,
  alias: { "@shared": resolve(root, "src/shared"), koffi: require.resolve("koffi") },
  external: ["electron", "@koromix/*"],
  logLevel: "error",
});
execFileSync(require("electron"), [out], { stdio: "inherit", timeout: 120_000 });
