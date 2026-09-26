/**
 * IPC handlers. Every message is checked for who sent it: UI messages must
 * come from a window's own browser UI, internal page calls from the main
 * frame of a tab showing that internal page — and each page may only use
 * the methods listed for it in PAGE_METHODS.
 */
import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { execFile } from "node:child_process";
import { BANGS } from "@shared/bangs";
import { SEARCH_ENGINES } from "@shared/engines";
import { internalPageOf } from "@shared/internal";
import {
  INTERNAL_CHANNEL,
  PAGE_METHODS,
  UI_CHANNELS,
  type Disposition,
  type DownloadAction,
  type InternalMethod,
  type UiCommand,
} from "@shared/ipc";
import { resolveInput } from "@shared/omnibox";
import { normalizeSite } from "@shared/settings";
import { inlineCompletion, suggest } from "@shared/suggest";
import type { AboutInfo, ClearDataOptions, PermissionKind, Suggestion } from "@shared/types";
import type { Browser } from "./browser";
import type { Tab } from "./tab";
import { isOpenableUrl } from "./window";

const DISPOSITIONS: Disposition[] = ["current", "foreground", "background", "window", "private"];
const DOWNLOAD_ACTIONS: DownloadAction[] = ["open", "show", "cancel", "pause", "resume", "remove"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max = 8192): v is string => typeof v === "string" && v.length <= max;

/**
 * Accepts only well-formed commands. The UI is our own code, but it renders
 * page titles and addresses from the web, so it is treated as untrusted.
 */
export function validateCommand(raw: unknown): UiCommand | null {
  if (!isObj(raw) || typeof raw.type !== "string") return null;
  const c = raw;
  const disposition = (v: unknown): Disposition | undefined =>
    DISPOSITIONS.includes(v as Disposition) ? (v as Disposition) : undefined;
  switch (c.type) {
    case "newTab":
    case "newWindow":
    case "newPrivateWindow":
    case "closeTab":
    case "reopenClosedTab":
    case "nextTab":
    case "previousTab":
    case "selectLastTab":
    case "focusAddressBar":
    case "reload":
    case "hardReload":
    case "back":
    case "forward":
    case "home":
    case "find":
    case "findNext":
    case "findPrevious":
    case "bookmark":
    case "clearData":
    case "zoomIn":
    case "zoomOut":
    case "zoomReset":
    case "print":
    case "fullscreen":
    case "devtools":
    case "viewSource":
    case "toggleBookmarksBar":
    case "quit":
    case "stop":
    case "stopFind":
    case "toggleProtection":
    case "unsplit":
    case "focusPage":
      return { type: c.type } as UiCommand;
    case "selectTab":
      return isNum(c.index) ? { type: "selectTab", index: c.index } : null;
    case "openPage":
      return ["history", "downloads", "bookmarks", "settings"].includes(c.page as string)
        ? { type: "openPage", page: c.page as "history" }
        : null;
    case "activate":
    case "close":
    case "toggleMute":
    case "proceed":
      return isNum(c.tabId) ? { type: c.type, tabId: c.tabId } : null;
    case "move":
      return isNum(c.tabId) && isNum(c.index)
        ? { type: "move", tabId: c.tabId, index: c.index }
        : null;
    case "navigate":
      return isStr(c.input, 32_768)
        ? { type: "navigate", input: c.input, disposition: disposition(c.disposition) }
        : null;
    case "openUrl":
      return isStr(c.url, 32_768)
        ? { type: "openUrl", url: c.url, disposition: disposition(c.disposition) }
        : null;
    case "tabMenu":
      return isNum(c.tabId) && isNum(c.x) && isNum(c.y)
        ? { type: "tabMenu", tabId: c.tabId, x: c.x, y: c.y }
        : null;
    case "bookmarkMenu":
      return isStr(c.id, 64) && isNum(c.x) && isNum(c.y)
        ? { type: "bookmarkMenu", id: c.id, x: c.x, y: c.y }
        : null;
    case "respondPrompt":
      return isNum(c.id) && typeof c.allow === "boolean" && typeof c.remember === "boolean"
        ? { type: "respondPrompt", id: c.id, allow: c.allow, remember: c.remember }
        : null;
    case "findInPage":
      return isStr(c.text, 1024) &&
        typeof c.forward === "boolean" &&
        typeof c.findNext === "boolean"
        ? { type: "findInPage", text: c.text, forward: c.forward, findNext: c.findNext }
        : null;
    case "split":
      return { type: "split", tabId: isNum(c.tabId) ? c.tabId : undefined };
    case "splitRatio":
      return isNum(c.ratio) ? { type: "splitRatio", ratio: c.ratio } : null;
    case "download":
      return isStr(c.id, 64) && DOWNLOAD_ACTIONS.includes(c.action as DownloadAction)
        ? { type: "download", id: c.id, action: c.action as DownloadAction }
        : null;
    case "insets":
      return isNum(c.top) && isNum(c.bottom)
        ? { type: "insets", top: c.top, bottom: c.bottom }
        : null;
    default:
      return null;
  }
}

export function registerIpc(browser: Browser): void {
  const uiWindow = (event: IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    const win = browser.windowForUi(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame)
      throw new Error("Not a browser window");
    return win;
  };

  ipcMain.handle(UI_CHANNELS.command, (event, raw: unknown) => {
    const win = uiWindow(event);
    const cmd = validateCommand(raw);
    if (cmd) win.command(cmd);
  });

  ipcMain.handle(UI_CHANNELS.suggest, (event, text: unknown) => {
    const win = uiWindow(event);
    if (!isStr(text, 2048)) return { suggestions: [], inline: null };
    const settings = browser.settings;
    const engine = browser.engine();
    const resolved = resolveInput(text, { engine, bangs: settings.bangs });
    const now = Date.now();
    const history = browser.profile.history.get().values();
    const local = suggest(text, {
      history,
      bookmarks: browser.profile.bookmarks.get(),
      tabs: browser
        .allTabs()
        .filter((t) => t.window.isPrivate === win.isPrivate && t.id !== win.activeId)
        .map((t) => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon })),
      now,
    });
    const first: Suggestion[] = [];
    if (resolved) {
      first.push(
        resolved.kind === "url"
          ? { kind: "go", title: resolved.url, url: resolved.url, detail: "Open" }
          : resolved.kind === "bang"
            ? {
                kind: "search",
                title: resolved.query || resolved.name,
                url: resolved.url,
                detail: resolved.query ? `Search ${resolved.name}` : `Open ${resolved.name}`,
              }
            : {
                kind: "search",
                title: resolved.query,
                url: resolved.url,
                detail: `Search with ${engine.name}`,
              },
      );
    }
    const inline =
      resolved?.kind === "bang"
        ? null
        : inlineCompletion(text, browser.profile.history.get().values(), now);
    return {
      suggestions: [...first, ...local.filter((s) => s.url !== first[0]?.url)].slice(0, 8),
      inline,
      engine: engine.name,
    };
  });

  ipcMain.handle(UI_CHANNELS.overlayOpen, (event) => uiWindow(event).openOverlay());
  ipcMain.on(UI_CHANNELS.overlayReady, (event) => {
    try {
      uiWindow(event).overlayReady();
    } catch {
      // not a browser window
    }
  });
  ipcMain.handle(UI_CHANNELS.overlayClose, (event) => uiWindow(event).closeOverlay());

  // ---- Internal pages ----

  const methods = internalMethods(browser);
  ipcMain.handle(INTERNAL_CHANNEL, (event, method: unknown, ...args: unknown[]) => {
    const tab = browser.tabFor(event.sender.id);
    const frame = event.senderFrame;
    if (!tab || !frame || frame !== event.sender.mainFrame) throw new Error("Not allowed");
    const page = internalPageOf(frame.url);
    if (
      !page ||
      typeof method !== "string" ||
      !PAGE_METHODS[page].includes(method as InternalMethod)
    ) {
      throw new Error("Not allowed");
    }
    return methods[method as InternalMethod](tab, ...args);
  });
}

type Handler = (tab: Tab, ...args: unknown[]) => unknown;

function internalMethods(browser: Browser): Record<InternalMethod, Handler> {
  const profile = browser.profile;
  return {
    "settings.get": () => ({
      settings: browser.settings,
      theme: browser.resolvedTheme(),
      platform: process.platform,
    }),
    "settings.set": (_tab, patch) => browser.updateSettings(isObj(patch) ? patch : {}),
    "engines.list": () => ({ engines: SEARCH_ENGINES, bangs: BANGS }),
    "newtab.info": async (tab) => ({
      importFrom:
        !tab.window.isPrivate &&
        !profile.stats.get().importHintDismissed &&
        profile.bookmarks.get().length === 0 &&
        profile.history.get().size < 20
          ? ((await browser.importer.detect())[0]?.browser ?? null)
          : null,
      topSites:
        browser.settings.newTabShortcuts && !tab.window.isPrivate
          ? profile.topSites(8).map((e) => ({ url: e.url, title: e.title, favicon: e.favicon }))
          : [],
      totalBlocked: profile.stats.get().totalBlocked,
      engine: browser.engine().name,
      private: tab.window.isPrivate,
    }),
    "import.detect": () => browser.importer.detect(),
    "import.choose": (tab) => browser.importer.chooseFolder(tab.window.win),
    "import.run": async (_tab, path, what) => {
      if (!isStr(path, 4096)) throw new Error("No profile folder");
      const w = isObj(what) ? what : {};
      const result = await browser.importer.run(path, {
        bookmarks: w.bookmarks === true,
        history: w.history === true,
      });
      browser.notifyInternal("bookmarks");
      browser.notifyInternal("history");
      browser.updateAllWindows();
      return result;
    },
    "import.dismissHint": () => {
      profile.stats.get().importHintDismissed = true;
      profile.stats.changed();
    },
    "topSites.hide": (_tab, url) => {
      if (isStr(url)) profile.hideTopSite(url);
    },
    navigate: (tab, input) => {
      if (!isStr(input, 32_768)) return;
      const result = resolveInput(input, {
        engine: browser.engine(),
        bangs: browser.settings.bangs,
      });
      if (result) {
        tab.load(result.url, { typed: result.kind === "url" });
        tab.focus();
      }
    },
    openUrl: (tab, url, disposition) => {
      if (!isStr(url, 32_768) || !isOpenableUrl(url)) return;
      const d = DISPOSITIONS.includes(disposition as Disposition)
        ? (disposition as Disposition)
        : "current";
      if (d === "current") tab.load(url);
      else tab.window.openUrl(url, d);
    },
    "history.query": (_tab, q) => {
      const o = isObj(q) ? q : {};
      return profile.queryHistory(
        isStr(o.text, 512) ? o.text : "",
        isNum(o.limit) ? Math.min(500, o.limit) : 100,
        isNum(o.before) ? o.before : Number.MAX_SAFE_INTEGER,
      );
    },
    "history.remove": (_tab, urls) => {
      if (Array.isArray(urls)) profile.removeHistory(urls.filter((u): u is string => isStr(u)));
      browser.notifyInternal("history");
    },
    "bookmarks.list": () => profile.bookmarks.get(),
    "bookmarks.update": (_tab, id, patch) => {
      if (!isStr(id, 64) || !isObj(patch)) return;
      profile.updateBookmark(id, {
        title: isStr(patch.title, 512) ? patch.title : undefined,
        url: isStr(patch.url) ? patch.url : undefined,
        index: isNum(patch.index) ? patch.index : undefined,
      });
      browser.notifyInternal("bookmarks");
      browser.updateAllWindows();
    },
    "bookmarks.remove": (_tab, id) => {
      if (isStr(id, 64)) profile.removeBookmark(id);
      browser.notifyInternal("bookmarks");
      browser.updateAllWindows();
    },
    "downloads.list": () => browser.downloads.all(),
    "downloads.action": (_tab, id, action) => {
      if (isStr(id, 64) && DOWNLOAD_ACTIONS.includes(action as DownloadAction)) {
        browser.downloads.action(id, action as DownloadAction);
      }
    },
    "downloads.clear": () => browser.downloads.clearFinished(),
    "downloads.chooseFolder": async (tab) => {
      const result = await dialog.showOpenDialog(tab.window.win, {
        title: "Downloads folder",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: browser.settings.downloadDir || app.getPath("downloads"),
      });
      if (!result.canceled && result.filePaths[0])
        browser.updateSettings({ downloadDir: result.filePaths[0] });
      return browser.settings.downloadDir;
    },
    "data.clear": async (_tab, options) => {
      const o = isObj(options) ? options : {};
      const clear: ClearDataOptions = {
        hours: isNum(o.hours) && o.hours >= 0 ? o.hours : 0,
        history: o.history === true,
        cookies: o.cookies === true,
        cache: o.cache === true,
        downloads: o.downloads === true,
      };
      await browser.clearData(clear);
    },
    "adblock.status": () => browser.adblock.status(browser.settings.adblock),
    "adblock.update": async () => {
      await browser.adblock.update();
      return browser.adblock.status(browser.settings.adblock);
    },
    "permissions.list": () => profile.listPermissions(),
    "permissions.reset": (_tab, origin, kind) => {
      if (isStr(origin, 2048))
        profile.resetPermission(origin, isStr(kind, 64) ? (kind as PermissionKind) : undefined);
    },
    "protection.remove": (_tab, site) => {
      const s = isStr(site, 512) ? normalizeSite(site) : null;
      if (s) {
        browser.updateSettings({
          protectionAllowlist: browser.settings.protectionAllowlist.filter((x) => x !== s),
        });
      }
    },
    "defaultBrowser.get": () => isDefaultBrowser(),
    "defaultBrowser.set": () => makeDefaultBrowser(),
    "about.info": (): AboutInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      platform: `${process.platform === "win32" ? "Windows" : process.platform === "linux" ? "Linux" : process.platform} ${process.getSystemVersion()}`,
      arch: process.arch,
      userData: app.getPath("userData"),
    }),
  } satisfies Record<InternalMethod, Handler>;
}

const execText = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout: 5000 }, (_err, stdout) => resolve(String(stdout ?? ""))),
  );

const LINUX_DESKTOP_FILE = () => process.env.CHROME_DESKTOP || "moon-browser.desktop";

async function isDefaultBrowser(): Promise<boolean> {
  if (process.platform === "win32") {
    // The user's choice, as Windows records it.
    const out = await execText("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
      "/v",
      "ProgId",
    ]);
    return /MoonBrowserURL/.test(out);
  }
  if (process.platform === "linux") {
    const out = await execText("xdg-settings", ["get", "default-web-browser"]);
    return out.trim() === LINUX_DESKTOP_FILE();
  }
  return app.isDefaultProtocolClient("https");
}

/**
 * Windows doesn't let apps make themselves the default browser: the
 * installer registers Moon Browser, and this opens the system settings to
 * choose it. On Linux, xdg-settings does it directly.
 */
async function makeDefaultBrowser(): Promise<boolean> {
  if (process.platform === "win32") {
    await shell.openExternal("ms-settings:defaultapps?registeredAppUser=Moon%20Browser");
  } else if (process.platform === "linux") {
    await execText("xdg-settings", ["set", "default-web-browser", LINUX_DESKTOP_FILE()]);
  } else {
    app.setAsDefaultProtocolClient("http");
    app.setAsDefaultProtocolClient("https");
  }
  return isDefaultBrowser();
}
