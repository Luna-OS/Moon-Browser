// electron-builder afterPack hook: flips Electron's fuses in the binary
// itself, so they can't be turned back on from outside.
//
// Linux only. On Windows, Netflix and other streaming services need the
// browser signed for Verified Media Path (build/vmp-sign.cjs), and castLabs'
// EVS refuses to sign an executable whose fuses were flipped.
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
  if (context.electronPlatformName === "win32") return;
  const { packager } = context;
  await packager.addElectronFuses(context, await packager.generateFuseConfig(FUSES));
};
