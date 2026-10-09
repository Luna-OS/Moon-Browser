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
// Linux has no VMP; macOS isn't built yet.
const { execFileSync } = require("node:child_process");

exports.default = async function vmpSign(context) {
  if (context.electronPlatformName !== "win32") return;
  const { EVS_ACCOUNT_NAME: account, EVS_PASSWD: password } = process.env;
  if (!account || !password) {
    console.warn("  • VMP signing skipped: EVS_ACCOUNT_NAME / EVS_PASSWD not set");
    return;
  }
  const python = process.env.EVS_PYTHON || (process.platform === "win32" ? "python" : "python3");
  console.log(`  • VMP signing ${context.appOutDir}`);
  execFileSync(
    python,
    [
      "-m",
      "castlabs_evs.vmp",
      "--no-ask",
      "sign-pkg",
      "-A",
      account,
      "-P",
      password,
      context.appOutDir,
    ],
    { stdio: "inherit" },
  );
  execFileSync(python, ["-m", "castlabs_evs.vmp", "--no-ask", "verify-pkg", context.appOutDir], {
    stdio: "inherit",
  });
};
