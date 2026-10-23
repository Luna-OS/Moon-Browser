// electron-builder afterSign hook: signs the packaged Windows app for
// Verified Media Path with castLabs EVS, so that Netflix and other streaming
// services accept its Widevine module (src/main/engine-settings.ts).
//
// Needs Python with castlabs-evs (pip install castlabs-evs) and an EVS
// account, free from castLabs: EVS_ACCOUNT_NAME and EVS_PASSWD in the
// environment (GitHub secrets in the release workflow). Without them the
// app is built unsigned for VMP: protected content then plays only where a
// service accepts that (most music, not Netflix on Windows).
//
// Linux has no VMP. On macOS the VMP signature must come before code
// signing, so build/fuses.cjs (afterPack) calls vmpSign there.
const { execFileSync } = require("node:child_process");

/** Signs the app in `dir` for VMP; false when there is no EVS account to sign with. */
function vmpSign(dir) {
  const { EVS_ACCOUNT_NAME: account, EVS_PASSWD: password } = process.env;
  if (!account || !password) {
    console.warn("  • VMP signing skipped: EVS_ACCOUNT_NAME / EVS_PASSWD not set");
    return false;
  }
  const python = process.env.EVS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  console.log(`  • VMP signing ${dir}`);
  execFileSync(
    python,
    ["-m", "castlabs_evs.vmp", "--no-ask", "sign-pkg", "-A", account, "-P", password, dir],
    { stdio: "inherit" },
  );
  execFileSync(python, ["-m", "castlabs_evs.vmp", "--no-ask", "verify-pkg", dir], {
    stdio: "inherit",
  });
  return true;
}

exports.vmpSign = vmpSign;

exports.default = async function vmpSignAfterSign(context) {
  if (context.electronPlatformName !== "win32") return;
  vmpSign(context.appOutDir);
};
