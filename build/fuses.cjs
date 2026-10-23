// electron-builder afterPack hook: flips Electron's fuses in the binary
// itself, so they can't be turned back on from outside.
//
// Linux and macOS. On Windows, Netflix and other streaming services need the
// browser signed for Verified Media Path (build/vmp-sign.cjs), and castLabs'
// EVS refuses to sign an executable whose fuses were flipped.
//
// On macOS this runs before the app is code-signed, as both steps here must:
// the fuses, then the VMP signature, then (electron-builder) the code
// signature over everything.
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { Arch } = require("builder-util");
const { vmpSign } = require("./vmp-sign.cjs");

const FUSES = {
  // The app can't be abused as a plain Node.js interpreter …
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  // … nor opened up with --inspect for debugging.
  enableNodeCliInspectArguments: false,
  // Cookies are encrypted on disk with the system's key store.
  enableCookieEncryption: true,
  // Only the signed-off app.asar is loaded, and it must match its hash.
  onlyLoadAppFromAsar: true,
  enableEmbeddedAsarIntegrityValidation: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  // file:// gets no extra powers beyond a normal browser's.
  grantFileProtocolExtraPrivileges: false,
};

exports.default = async function fuses(context) {
  const platform = context.electronPlatformName;
  if (platform === "win32") return;
  const { packager } = context;
  const mac = platform === "darwin";
  // Flipping fuses breaks Electron's own signature, and Apple Silicon runs
  // nothing unsigned: signed again ad hoc right away, in case the code
  // signing after this is skipped.
  const resetAdHocDarwinSignature = mac && context.arch === Arch.arm64;
  await packager.addElectronFuses(
    context,
    await packager.generateFuseConfig({ ...FUSES, resetAdHocDarwinSignature }),
  );
  if (!mac) return;

  const resources = join(
    context.appOutDir,
    `${packager.appInfo.productFilename}.app`,
    "Contents",
    "Resources",
  );
  // Signed with an Apple Developer ID, the app can install its updates
  // itself; signed ad hoc, macOS won't let it (src/main/updater.ts).
  if (signsWithDeveloperId(packager.platformSpecificBuildOptions.identity)) {
    writeFileSync(join(resources, "developer-id"), "");
  }

  // Verified Media Path, for Netflix's higher resolutions. A failure here
  // doesn't stop the release: the Mac app then plays protected content
  // where services accept it without VMP.
  try {
    vmpSign(context.appOutDir);
  } catch (err) {
    console.warn(`::warning::VMP signing of the Mac app failed: ${err.message}`);
  }
};

/** Whether electron-builder will sign with a real certificate, not ad hoc. */
function signsWithDeveloperId(identity) {
  if (identity === null || identity === "-") return false;
  if (identity) return true;
  return Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
}
