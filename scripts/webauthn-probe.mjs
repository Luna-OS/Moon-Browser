// Temporary: how Windows' webauthn.dll answers Moon Browser's requests on a
// CI runner (no Windows Hello there, so no dialog should stay open long).
import { build } from "esbuild";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const out = resolve(root, "out", "webauthn-probe.cjs");
await build({
  stdin: {
    contents: `
      import koffi from "koffi";
      import { WindowsWebAuthn } from "./src/main/webauthn-win";
      import { clientDataJSON } from "./src/shared/webauthn";
      (async () => {
      const desktop = koffi.load("user32.dll").func("__stdcall", "GetDesktopWindow", "intptr_t", [])();
      const consoleWin = koffi.load("kernel32.dll").func("__stdcall", "GetConsoleWindow", "intptr_t", [])();
      const api = WindowsWebAuthn.load();
      console.log("api", api && api.apiVersion, "uvpaa", api && api.isPlatformAuthenticatorAvailable(), "desktop", desktop, "console", consoleWin);
      const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
      const make = (name, rpId, hwnd) => ({ name, rpId, hwnd: BigInt(hwnd) });
      const variants = [
        make("ext-rp desktop", ext, desktop),
        make("domain-rp desktop", "example.com", desktop),
        make("ext-rp null-hwnd", ext, 0),
        make("ext-rp console", ext, consoleWin),
      ];
      for (const v of variants) {
        const t0 = Date.now();
        let cancel;
        const watchdog = setTimeout(() => cancel && cancel.cancel(), 8000);
        try {
          await api.makeCredential({
            hwnd: v.hwnd, rpId: v.rpId, rpName: "Probe",
            user: { id: new Uint8Array([1, 2, 3]), name: "probe@example.com", displayName: "Probe" },
            algorithms: [-7, -257],
            clientData: clientDataJSON("webauthn.create", new Uint8Array(32), "chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
            timeout: 3000, exclude: [], attachment: 1, requireResidentKey: false, preferResidentKey: false,
            userVerification: 1, attestation: 1,
          }, (c) => (cancel = c));
          console.log(v.name, "created?!", Date.now() - t0, "ms");
        } catch (e) {
          console.log(v.name, "->", e.domName, e.message, Date.now() - t0, "ms");
        } finally { clearTimeout(watchdog); }
      }
      const t0 = Date.now();
      try {
        await api.getAssertion({ hwnd: BigInt(desktop), rpId: ext, clientData: clientDataJSON("webauthn.get", new Uint8Array(32), "chrome-extension://abcdefghijklmnopabcdefghijklmnop"), timeout: 3000, allow: [], userVerification: 1 });
      } catch (e) { console.log("get ext-rp ->", e.domName, e.message, Date.now() - t0, "ms"); }
      })().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
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
  external: ["@koromix/*"],
  logLevel: "error",
});
await import(`file://${out.replace(/\\/g, "/")}`);
