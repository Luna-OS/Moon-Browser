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
      const ext = "chrome-extension://eiaeiblijfjekdanodkjadfinkhbfgcd";
      const base = {
        hwnd: BigInt(desktop), rpId: ext, rpName: "NordPass",
        user: { id: new Uint8Array(16).fill(7), name: "luna@example.com-1a2b3c4d", displayName: "Luna" },
        algorithms: [-7, -257], clientData: clientDataJSON("webauthn.create", new Uint8Array(32), ext),
        timeout: 60000, exclude: [], attachment: 1, requireResidentKey: false, preferResidentKey: false,
        userVerification: 1, attestation: 1,
      };
      const variants = {
        "baseline": {},
        "alg -8": { algorithms: [-7, -8, -257] },
        "only -8": { algorithms: [-8] },
        "prefer rk": { preferResidentKey: true },
        "require rk": { requireResidentKey: true },
        "displayName empty": { user: { ...base.user, displayName: "" } },
        "name empty": { user: { ...base.user, name: "" } },
        "attestation direct": { attestation: 3 },
        "attestation indirect": { attestation: 2 },
        "user.id 64": { user: { ...base.user, id: new Uint8Array(64).fill(1) } },
        "rpName empty": { rpName: "" },
        "exclude one": { exclude: [{ id: new Uint8Array(32).fill(9), transports: 0x10 }] },
        "uv preferred": { userVerification: 2 },
        "nordpass-like": { algorithms: [-7, -8, -257], preferResidentKey: true, attestation: 3 },
        "nordpass-like none": { algorithms: [-7, -8, -257], preferResidentKey: true, attestation: 1 },
      };
      for (const [name, change] of Object.entries(variants)) {
        const t0 = Date.now();
        let cancel;
        const watchdog = setTimeout(() => cancel && cancel.cancel(), 4000);
        try {
          await api.makeCredential({ ...base, ...change }, (c) => (cancel = c));
          console.log(name.padEnd(22), "created?!", Date.now() - t0, "ms");
        } catch (e) {
          const ms = Date.now() - t0;
          console.log(name.padEnd(22), ms < 1500 ? "REFUSED" : "accepted (dialog)", e.domName, e.message, ms, "ms");
        } finally { clearTimeout(watchdog); }
      }
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
