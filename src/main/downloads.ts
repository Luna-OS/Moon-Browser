/**
 * Downloads: saved straight to the downloads folder (or asked for, if
 * chosen in Settings), listed on moon://downloads and in the toolbar.
 */
import { app, dialog, shell, type DownloadItem, type Session, type WebContents } from "electron";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { DownloadAction } from "@shared/ipc";
import { isDangerousFile, zoneIdentifier } from "@shared/security";
import type { DownloadInfo } from "@shared/types";
import type { Browser } from "./browser";

interface Active {
  item: DownloadItem;
  info: DownloadInfo;
  isPrivate: boolean;
}

/** `name (1).ext`, `name (2).ext`, … until the name is free. */
export function uniquePath(dir: string, filename: string): string {
  const safe = basename(filename) || "download";
  let candidate = join(dir, safe);
  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let i = 1; existsSync(candidate) && i < 1000; i++) {
    candidate = join(dir, `${stem} (${i})${ext}`);
  }
  return candidate;
}

export class Downloads {
  private readonly active = new Map<string, Active>();
  /** Downloads of this run, newest first, for the toolbar panel. */
  private recentIds: string[] = [];
  private privateFinished = new Map<string, DownloadInfo>();
  private notifyTimer: NodeJS.Timeout | null = null;

  constructor(private readonly browser: Browser) {}

  install(ses: Session, isPrivate: boolean): void {
    ses.on("will-download", (_event, item, webContents) =>
      this.onDownload(item, isPrivate, webContents),
    );
  }

  /** Downloads for the toolbar panel of a window. */
  recent(isPrivate: boolean): DownloadInfo[] {
    return this.recentIds
      .map((id) => this.find(id))
      .filter((d): d is DownloadInfo => !!d)
      .filter((d) => isPrivate || !this.privateFinished.has(d.id))
      .slice(0, 8);
  }

  /** Everything for moon://downloads: running ones, then the saved list. */
  all(): DownloadInfo[] {
    const running = [...this.active.values()].filter((a) => !a.isPrivate).map((a) => a.info);
    const ids = new Set(running.map((d) => d.id));
    return [...running, ...this.browser.profile.downloads.get().filter((d) => !ids.has(d.id))];
  }

  action(id: string, action: DownloadAction): void {
    const running = this.active.get(id);
    const info = this.find(id);
    switch (action) {
      case "open":
        if (info?.state === "completed") void shell.openPath(info.path);
        break;
      case "show":
        if (info?.path && existsSync(info.path)) shell.showItemInFolder(info.path);
        break;
      case "cancel":
        running?.item.cancel();
        break;
      case "pause":
        running?.item.pause();
        break;
      case "resume":
        if (running?.item.canResume()) running.item.resume();
        break;
      case "remove":
        if (running) return;
        this.browser.profile.removeDownload(id);
        this.privateFinished.delete(id);
        this.recentIds = this.recentIds.filter((r) => r !== id);
        break;
    }
    this.changed();
  }

  clearFinished(): void {
    this.browser.profile.downloads.set([]);
    this.recentIds = this.recentIds.filter((id) => this.active.has(id));
    this.privateFinished.clear();
    this.changed();
  }

  get hasRunning(): boolean {
    return [...this.active.values()].some((a) => a.info.state === "progressing");
  }

  private find(id: string): DownloadInfo | undefined {
    return (
      this.active.get(id)?.info ??
      this.privateFinished.get(id) ??
      this.browser.profile.downloads.get().find((d) => d.id === id)
    );
  }

  private onDownload(
    item: DownloadItem,
    isPrivate: boolean,
    source: WebContents | undefined,
  ): void {
    const settings = this.browser.settings;
    const dir = settings.downloadDir || app.getPath("downloads");
    const filename = item.getFilename();
    // Programs and scripts are held under a name nothing runs until the
    // person says "Keep" (as Chrome does), even if they finish first.
    const dangerous = isDangerousFile(filename);
    if (dangerous) {
      item.setSavePath(uniquePath(dir, `Unconfirmed ${randomInt(100_000, 1_000_000)}.crdownload`));
    } else if (settings.askDownloadLocation) {
      item.setSaveDialogOptions({ defaultPath: join(dir, filename) });
    } else {
      item.setSavePath(uniquePath(dir, filename));
    }
    const id = randomUUID();
    const referrer = source ? this.browser.tabFor(source.id)?.url : undefined;
    const info: DownloadInfo = {
      id,
      filename,
      path: dangerous ? "" : item.getSavePath(),
      url: item.getURL(),
      state: "progressing",
      received: 0,
      total: item.getTotalBytes(),
      paused: false,
      startTime: Date.now(),
    };
    this.active.set(id, { item, info, isPrivate });
    this.recentIds = [id, ...this.recentIds].slice(0, 30);

    const refresh = () => {
      if (!dangerous) {
        info.path = item.getSavePath() || info.path;
        info.filename = info.path ? basename(info.path) : info.filename;
      }
      info.received = item.getReceivedBytes();
      info.total = item.getTotalBytes();
      info.paused = item.isPaused();
    };
    const finish = (state: DownloadInfo["state"]) => {
      info.state = state;
      info.paused = false;
      this.active.delete(id);
      if (state === "completed" && process.platform === "win32" && info.path) {
        // Mark of the Web: Windows (SmartScreen, Office) then treats the
        // file as coming from the internet, as with any other browser.
        const mark = zoneIdentifier(isPrivate ? {} : { url: item.getURL(), referrer });
        void writeFile(`${info.path}:Zone.Identifier`, mark).catch(() => undefined);
      }
      if (isPrivate) this.privateFinished.set(id, { ...info });
      else if (info.path) this.browser.profile.saveDownload({ ...info });
      else this.recentIds = this.recentIds.filter((r) => r !== id);
      this.changed();
    };
    const verdict = dangerous ? this.confirmDangerous(info, source) : Promise.resolve(true);
    let done = false;
    void verdict.then((keep) => {
      if (!keep && !done) item.cancel();
    });

    item.on("updated", (_e, state) => {
      refresh();
      info.state = state === "interrupted" ? "interrupted" : "progressing";
      this.changedSoon();
    });
    item.once("done", (_e, state) => {
      done = true;
      refresh();
      if (!dangerous) return finish(state);
      const held = item.getSavePath();
      void verdict.then(async (keep) => {
        const target =
          keep && state === "completed" ? await this.keepPath(dir, filename, source) : null;
        if (target && (await move(held, target))) {
          info.path = target;
          info.filename = basename(target);
          return finish("completed");
        }
        await rm(held, { force: true }).catch(() => undefined);
        info.path = join(dir, filename);
        finish(state === "completed" ? "cancelled" : state);
      });
    });
    this.changed();
  }

  /** Where a kept program goes: the downloads folder, or where the person picks. */
  private async keepPath(
    dir: string,
    filename: string,
    source: WebContents | undefined,
  ): Promise<string | null> {
    if (!this.browser.settings.askDownloadLocation) return uniquePath(dir, filename);
    const win = this.browser.windowForContents(source)?.win;
    const options = { defaultPath: join(dir, filename) };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return canceled || !filePath ? null : filePath;
  }

  /** Asks whether a program or script may be kept. */
  private async confirmDangerous(
    info: DownloadInfo,
    source: WebContents | undefined,
  ): Promise<boolean> {
    let host = "";
    try {
      host = new URL(info.url).host;
    } catch {
      host = "";
    }
    const response = await this.browser.ask(
      {
        tone: "warning",
        glyph: "download",
        eyebrow: "This file can harm your computer",
        title: `“${info.filename}” can run code on your computer`,
        message: `It is a program or script${host ? ` from ${host}` : ""}. Only keep it if you trust where it comes from.`,
        buttons: [
          { label: "Discard", style: "primary" },
          { label: "Keep anyway", style: "danger" },
        ],
        defaultId: 0,
        cancelId: 0,
      },
      this.browser.windowForContents(source),
    );
    return response === 1;
  }

  private changedSoon(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.changed();
    }, 250);
  }

  private changed(): void {
    this.browser.updateAllWindows();
    this.browser.notifyInternal("downloads");
  }
}

/** Moves a file, also to another drive; false if it couldn't. */
async function move(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") return false;
    try {
      await copyFile(from, to);
      await rm(from, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
