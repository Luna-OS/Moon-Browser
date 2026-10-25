/**
 * Updates without reinstalling. Luma looks for a new release on
 * GitHub, downloads it in the background — checked against the SHA-512 in
 * the release's latest.yml — and installs it over the current version when
 * it restarts. The profile (bookmarks, history, settings, extensions) lives
 * in the user folder and is never touched.
 *
 *  - Windows: the new installer runs silently over the installed version.
 *  - Linux AppImage: the AppImage file is replaced.
 *  - Linux .deb / .rpm: the package is installed with dpkg or rpm, which asks
 *    for the administrator password — so only when the user clicks
 *    "Restart to update", never silently on quit.
 *  - macOS with an Apple Developer ID: the system's own updater.
 *  - macOS without one (ad-hoc signed): the system won't install an update
 *    over it, so Luma replaces its app itself (mac-update.ts). Only
 *    where it can't write — started from the disk image, or from a folder
 *    it doesn't own — "Update" opens the release's download page instead.
 */
import { app } from "electron";
import {
  AppImageUpdater,
  DebUpdater,
  MacUpdater,
  NsisUpdater,
  RpmUpdater,
  type AppUpdater,
} from "electron-updater";
import { existsSync, readFileSync } from "node:fs";
import { appBundleOf, canReplace } from "./mac-update";
import { MacSelfUpdater } from "./mac-self-updater";
import { join } from "node:path";
import type { UpdateStatus } from "@shared/types";

/** The first check waits until startup is over. */
const FIRST_CHECK_DELAY = 30_000;
const CHECK_INTERVAL = 4 * 3_600_000;
const RELEASES = "https://github.com/Luna-OS/Moon-Browser/releases";

interface Hooks {
  /** "Look for updates automatically". */
  autoCheck: () => boolean;
  onChange: (status: UpdateStatus) => void;
  /** Called right before Luma quits to install an update. */
  beforeInstall: () => void;
  /** Opens a page in a tab: the download page of an update installed by hand. */
  openPage: (url: string) => void;
}

interface Impl {
  updater: AppUpdater;
  needsAdmin: boolean;
  /** Downloaded and installed by hand (see UpdateStatus). */
  manual?: boolean;
}

/** The updater for the way this copy was installed, or null if it can't update itself. */
function createUpdater(): Impl | null {
  if (!app.isPackaged) return null;
  const resources = process.resourcesPath;
  if (!existsSync(join(resources, "app-update.yml"))) return null;
  if (process.platform === "win32") return { updater: new NsisUpdater(), needsAdmin: false };
  if (process.platform === "darwin") {
    // Left there by the build when it signs with a Developer ID (build/fuses.cjs).
    if (existsSync(join(resources, "developer-id")))
      return { updater: new MacUpdater(), needsAdmin: false };
    const bundle = appBundleOf(process.execPath);
    if (bundle && canReplace(bundle))
      // It speaks electron-updater's events and calls (mac-self-updater.ts).
      return { updater: new MacSelfUpdater(bundle) as unknown as AppUpdater, needsAdmin: false };
    return { updater: new MacUpdater(), needsAdmin: false, manual: true };
  }
  if (process.platform !== "linux") return null;
  // An AppImage replaces itself; checked first, because the AppImage may
  // carry the package-type file of the .deb/.rpm build too.
  if (process.env.APPIMAGE) return { updater: new AppImageUpdater(), needsAdmin: false };
  let type = "";
  try {
    type = readFileSync(join(resources, "package-type"), "utf8").trim();
  } catch {
    // an unpacked folder: updates come from wherever it came from
  }
  if (type === "deb") return { updater: new DebUpdater(), needsAdmin: true };
  if (type === "rpm") return { updater: new RpmUpdater(), needsAdmin: true };
  return null;
}

/** electron-updater's errors can carry whole HTTP responses; the first line is enough. */
function shortError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const line = text.split("\n")[0]?.trim() || "Unknown error";
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ETIMEDOUT/.test(line))
    return "No connection to GitHub.";
  if (/latest(-linux)?\.yml/.test(line) && /404|Cannot find/.test(line))
    return "The latest release has no update files yet.";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

export class Updater {
  private readonly impl = createUpdater();
  private current: UpdateStatus;

  constructor(private readonly hooks: Hooks) {
    this.current = {
      state: this.impl ? "idle" : "unsupported",
      current: app.getVersion(),
      version: null,
      percent: 0,
      checkedAt: null,
      error: null,
      needsAdmin: this.impl?.needsAdmin ?? false,
      manual: this.impl?.manual ?? false,
    };
    const impl = this.impl;
    if (!impl) return;
    const u = impl.updater;
    u.logger = {
      info: () => undefined,
      debug: () => undefined,
      warn: (m: unknown) => console.warn("[moon] update:", m),
      error: (m: unknown) => console.error("[moon] update:", shortError(m)),
    };
    u.autoDownload = !impl.manual;
    u.autoInstallOnAppQuit = !impl.needsAdmin && !impl.manual;
    u.allowPrerelease = false;
    u.allowDowngrade = false;
    u.fullChangelog = false;
    u.on("checking-for-update", () => this.set({ state: "checking", error: null }));
    u.on("update-not-available", () => this.set({ state: "idle", checkedAt: Date.now() }));
    u.on("update-available", (info) =>
      this.set({
        // An update downloaded by hand is ready as soon as it is found.
        state: impl.manual ? "ready" : "downloading",
        version: info.version,
        percent: impl.manual ? 100 : 0,
        checkedAt: Date.now(),
      }),
    );
    u.on("download-progress", (p) =>
      this.set({ state: "downloading", percent: Math.floor(p.percent) }),
    );
    u.on("update-downloaded", (info) =>
      this.set({ state: "ready", version: info.version, percent: 100 }),
    );
    u.on("error", (err) => {
      if (this.current.state !== "ready")
        this.set({ state: "error", error: shortError(err), checkedAt: Date.now() });
    });
  }

  status(): UpdateStatus {
    return this.current;
  }

  /** The version waiting for a restart. */
  readyVersion(): string | null {
    return this.current.state === "ready" ? this.current.version : null;
  }

  start(): void {
    if (!this.impl) return;
    setTimeout(() => this.maybeCheck(), FIRST_CHECK_DELAY).unref();
    setInterval(() => this.maybeCheck(), 30 * 60_000).unref();
  }

  private maybeCheck(): void {
    if (!this.hooks.autoCheck()) return;
    if (Date.now() - (this.current.checkedAt ?? 0) < CHECK_INTERVAL) return;
    void this.check();
  }

  /** Looks for an update now; a new version starts downloading right away. */
  async check(): Promise<UpdateStatus> {
    const u = this.impl?.updater;
    if (!u || ["checking", "downloading", "ready"].includes(this.current.state))
      return this.current;
    try {
      await u.checkForUpdates();
    } catch (err) {
      if (this.current.state !== "ready")
        this.set({ state: "error", error: shortError(err), checkedAt: Date.now() });
    }
    return this.current;
  }

  /** Quits, installs the downloaded update and starts the new version. */
  install(): void {
    const u = this.impl?.updater;
    if (!u || this.current.state !== "ready") return;
    if (this.impl?.manual) {
      this.hooks.openPage(`${RELEASES}/tag/v${this.current.version ?? ""}`);
      return;
    }
    this.hooks.beforeInstall();
    // Silent: no installer pages on Windows; relaunch afterwards.
    u.quitAndInstall(true, true);
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.current = { ...this.current, ...patch };
    this.hooks.onChange(this.current);
  }
}
