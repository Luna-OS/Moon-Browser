/**
 * Updates on macOS for a copy without an Apple Developer ID (ad-hoc signed).
 * macOS's own updater (Squirrel.Mac, through electron-updater) only installs
 * a new version signed with the same Developer ID, so Moon Browser does what
 * it would have done itself:
 *
 *  1. reads latest-mac.yml of the newest release on GitHub,
 *  2. downloads the zip for this Mac's architecture and checks its SHA-512
 *     against the one in latest-mac.yml,
 *  3. unpacks it with ditto (keeping the app's links and attributes) and
 *     checks the new app: a valid signature, Moon Browser's bundle ID and the
 *     version it was announced as,
 *  4. on quit, a small script waits for Moon Browser to close, puts the new
 *     app in place of the old one (keeping the old one until that worked)
 *     and, for "Restart to update", opens it again.
 *
 * Nothing here needs Electron, so it is tested on its own.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const BUNDLE_ID = "io.lunaos.moonbrowser";

export interface FeedFile {
  url: string;
  sha512: string;
  size?: number;
}

export interface Feed {
  version: string;
  files: FeedFile[];
}

/**
 * latest-mac.yml as electron-builder writes it: a version and a list of
 * files, each with its url, sha512 and size. Only that much is read.
 */
export function parseFeed(text: string): Feed {
  const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, "$2");
  let version = "";
  const files: FeedFile[] = [];
  let inFiles = false;
  let file: Partial<FeedFile> | null = null;
  const flush = () => {
    if (file?.url && file.sha512) files.push(file as FeedFile);
    file = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const top = /^([A-Za-z]\w*):\s*(.*)$/.exec(line);
    if (top) {
      flush();
      inFiles = top[1] === "files";
      if (top[1] === "version") version = unquote(top[2]);
      continue;
    }
    if (!inFiles) continue;
    const entry = /^\s*(-\s+)?(\w+):\s*(.*)$/.exec(line);
    if (!entry) continue;
    if (entry[1]) {
      flush();
      file = {};
    }
    if (!file) continue;
    const value = unquote(entry[3]);
    if (entry[2] === "url") file.url = value;
    else if (entry[2] === "sha512") file.sha512 = value;
    else if (entry[2] === "size") file.size = Number(value) || undefined;
  }
  flush();
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error("latest-mac.yml names no version");
  return { version, files };
}

/** The zip for this Mac: "…-mac-arm64.zip" or "…-mac-x64.zip". */
export function pickZip(feed: Feed, arch: string): FeedFile | null {
  const want = arch === "arm64" ? "-mac-arm64.zip" : "-mac-x64.zip";
  return feed.files.find((f) => f.url.endsWith(want) && !f.url.includes("/")) ?? null;
}

/** The SHA-512 of a file, base64, as latest-mac.yml gives it. */
export function sha512Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("base64")))
      .on("error", reject);
  });
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${basename(cmd)}: ${String(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

function plistValue(plist: string, key: string): Promise<string> {
  return run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]).then((v) => v.trim());
}

/**
 * Unpacks the downloaded zip into `dir` and returns the new app, after
 * checking that it is Moon Browser, at `version`, with a valid signature.
 */
export async function unpackAndCheck(zip: string, dir: string, version: string): Promise<string> {
  await rm(dir, { recursive: true, force: true });
  await run("/usr/bin/ditto", ["-x", "-k", zip, dir]);
  const apps = (await readdir(dir)).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error("The update holds no app");
  const app = join(dir, apps[0]);
  const plist = join(app, "Contents", "Info.plist");
  if ((await plistValue(plist, "CFBundleIdentifier")) !== BUNDLE_ID)
    throw new Error("The update is not Moon Browser");
  if ((await plistValue(plist, "CFBundleShortVersionString")) !== version)
    throw new Error("The update is not the version it was announced as");
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  return app;
}

/** The .app this copy runs from (…/Moon Browser.app/Contents/MacOS/Moon Browser). */
export function appBundleOf(execPath: string): string | null {
  const bundle = dirname(dirname(dirname(execPath)));
  return bundle.endsWith(".app") ? bundle : null;
}

/**
 * Whether this copy can replace itself: not started from the disk image or
 * from where macOS moved it to check it (App Translocation), and in a
 * folder it may write to.
 */
export function canReplace(bundle: string): boolean {
  if (bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) return false;
  try {
    accessSync(dirname(bundle), constants.W_OK);
    accessSync(bundle, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for the process to end, then puts the new app in place of the old
 * one. The old one is set aside first and only deleted once the new one is
 * in place; if the move fails, it comes back. Arguments: pid, old app, new
 * app, "1" to open it again.
 */
export const SWAP_SCRIPT = `
pid="$1"; old="$2"; new="$3"; relaunch="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
aside="$old.moon-previous"
rm -rf "$aside"
if mv "$old" "$aside"; then
  if mv "$new" "$old"; then
    rm -rf "$aside"
  else
    mv "$aside" "$old"
  fi
fi
command -v xattr >/dev/null 2>&1 && xattr -dr com.apple.quarantine "$old" 2>/dev/null
if [ "$relaunch" = 1 ]; then open "$old" 2>/dev/null; fi
exit 0
`;

/** Starts the swap; it runs on after Moon Browser has quit. */
export function startSwap(pid: number, oldApp: string, newApp: string, relaunch: boolean): void {
  const child = spawn(
    "/bin/sh",
    ["-c", SWAP_SCRIPT, "moon-update", String(pid), oldApp, newApp, relaunch ? "1" : "0"],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}
