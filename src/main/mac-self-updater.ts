/**
 * The updater of an ad-hoc signed Mac copy (see mac-update.ts). It speaks
 * electron-updater's events, so src/main/updater.ts treats it like the
 * updaters of the other systems.
 */
import { app, net } from "electron";
import { EventEmitter, once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { compareVersions } from "@shared/extensions";
import { parseFeed, pickZip, sha512Of, startSwap, unpackAndCheck } from "./mac-update";

const RELEASES = "https://github.com/Luna-OS/Moon-Browser/releases";

async function download(
  url: string,
  dest: string,
  size: number | undefined,
  progress: (percent: number) => void,
): Promise<void> {
  const res = await net.fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || size || 0;
  const out = createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;
  let shown = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await once(out, "drain");
      const percent = total ? Math.floor((received / total) * 100) : 0;
      if (percent !== shown) progress((shown = percent));
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
}

export class MacSelfUpdater extends EventEmitter {
  logger: unknown = null;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = false;
  fullChangelog = false;
  /** The checked new app, waiting to replace this one. */
  private staged: { version: string; app: string } | null = null;
  private swapping = false;

  constructor(private readonly bundle: string) {
    super();
    // Quitting with an update waiting installs it, as on the other systems.
    app.on("will-quit", () => {
      if (this.staged && this.autoInstallOnAppQuit && !this.swapping) {
        this.swapping = true;
        startSwap(process.pid, this.bundle, this.staged.app, false);
      }
    });
  }

  async checkForUpdates(): Promise<{ version: string } | null> {
    this.emit("checking-for-update");
    const res = await net.fetch(`${RELEASES}/latest/download/latest-mac.yml`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`latest-mac.yml: HTTP ${res.status}`);
    const feed = parseFeed(await res.text());
    const info = { version: feed.version };
    if (compareVersions(feed.version, app.getVersion()) <= 0) {
      this.emit("update-not-available", info);
      return info;
    }
    this.emit("update-available", info);
    if (this.staged?.version === feed.version) {
      this.emit("update-downloaded", info);
      return info;
    }
    const file = pickZip(feed, process.arch);
    if (!file) throw new Error(`The release has no update for this Mac (${process.arch})`);
    const work = join(app.getPath("temp"), "moon-browser-update");
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const zip = join(work, file.url);
    await download(`${RELEASES}/download/v${feed.version}/${file.url}`, zip, file.size, (percent) =>
      this.emit("download-progress", { percent }),
    );
    if ((await sha512Of(zip)) !== file.sha512)
      throw new Error("The download is damaged (SHA-512 doesn't match)");
    const newApp = await unpackAndCheck(zip, join(work, "app"), feed.version);
    await rm(zip, { force: true });
    this.staged = { version: feed.version, app: newApp };
    this.emit("update-downloaded", info);
    return info;
  }

  /** Quits; the new app takes the old one's place and opens. */
  quitAndInstall(_isSilent = true, isForceRunAfter = true): void {
    if (!this.staged || this.swapping) return;
    this.swapping = true;
    startSwap(process.pid, this.bundle, this.staged.app, isForceRunAfter);
    app.quit();
  }
}
