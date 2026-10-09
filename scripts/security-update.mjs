/**
 * Looks for a security update of Moon Browser's engine, for
 * .github/workflows/security-updates.yml.
 *
 * Moon Browser's engine is Chromium, inside Electron — castLabs' Electron for
 * Content Security (Electron with Widevine, for Netflix and the like), which
 * castLabs releases for each Electron version shortly after it. Chromium's
 * security fixes — the ones Chrome and Helium ship — reach Electron's
 * supported versions in its patch releases, usually within days. So: is
 * there a newer castLabs release of the Electron major version Moon Browser
 * is built on?
 *
 *   node scripts/security-update.mjs           what it found, as key=value lines ($GITHUB_OUTPUT)
 *   node scripts/security-update.mjs --apply   and, if there's an update, installs it and
 *                                              bumps Moon Browser's version (patch)
 *   --from <version>                           pretend Electron <version> is installed (to try it)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;

const npm = (...a) =>
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", a, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32",
  }).trim();

/** castLabs' releases are on GitHub, tagged v44.5.1+wvcus. */
const ECS = "https://github.com/castlabs/electron-releases";
const git = (...a) =>
  execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

/** Release versions only (no alphas or betas), compared number by number. */
const STABLE = /^\d+\.\d+\.\d+$/;
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const current = (from ?? lock.packages["node_modules/electron"].version).replace(/\+.*$/, "");
const major = Number(current.split(".")[0]);

const releases = git("ls-remote", "--tags", "--refs", ECS)
  .split("\n")
  .map((line) => /refs\/tags\/v(\d+\.\d+\.\d+)\+wvcus$/.exec(line)?.[1])
  .filter((v) => v !== undefined && STABLE.test(v))
  .sort(compare);
const newest = releases.filter((v) => Number(v.split(".")[0]) === major).at(-1) ?? current;
const latest = releases.at(-1) ?? current;
const update = compare(newest, current) > 0;

/** The Chromium version Helium builds on right now, for comparison ("" if unknown). */
async function heliumChromium() {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/imputnet/helium/main/chromium_version.txt",
      { signal: AbortSignal.timeout(15_000) },
    );
    const text = res.ok ? (await res.text()).trim() : "";
    return /^\d+(\.\d+){3}$/.test(text) ? text : "";
  } catch {
    return "";
  }
}

const out = {
  current,
  electron: newest,
  update: String(update),
  // A newer major version is no automatic update: it can change Electron's
  // APIs, so it's announced in an issue instead.
  newer_major: Number(latest.split(".")[0]) > major ? latest : "",
  helium_chromium: await heliumChromium(),
};

if (update && apply) {
  npm("install", "--save-dev", `electron@${ECS}#v${newest}+wvcus`);
  out.version = npm("version", "patch", "--no-git-tag-version").replace(/^v/, "");
}

for (const [key, value] of Object.entries(out)) console.log(`${key}=${value}`);
