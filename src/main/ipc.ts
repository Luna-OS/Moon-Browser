/**
 * IPC handlers. Every message is checked for who sent it: UI messages must
 * come from a window's own browser UI, internal page calls from the main
 * frame of a tab showing that internal page — and each page may only use
 * the methods listed for it in PAGE_METHODS.
 */
import { app, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { BANGS } from "@shared/bangs";
import { folderChoices } from "@shared/bookmarks";
import { SEARCH_ENGINES } from "@shared/engines";
import { EXTENSION_ID } from "@shared/extensions";
import { isGroupColor } from "@shared/tab-groups";
import { internalPageOf } from "@shared/internal";
import {
  INTERNAL_CHANNEL,
  PAGE_METHODS,
  UI_CHANNELS,
  type Disposition,
  type DownloadAction,
  type GroupAction,
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
const isExtensionId = (v: unknown): v is string => typeof v === "string" && EXTENSION_ID.test(v);

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
    case "installUpdate":
    case "makeDefaultBrowser":
      return { type: c.type } as UiCommand;
    case "selectTab":
      return isNum(c.index) ? { type: "selectTab", index: c.index } : null;
    case "openPage":
      return ["history", "downloads", "bookmarks", "settings", "extensions"].includes(
        c.page as string,
      )
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
    case "bookmarksBarMenu":
      return isNum(c.x) && isNum(c.y) ? { type: "bookmarksBarMenu", x: c.x, y: c.y } : null;
    case "bookmarkMenu":
      return isStr(c.id, 64) && isNum(c.x) && isNum(c.y)
        ? { type: "bookmarkMenu", id: c.id, x: c.x, y: c.y }
        : null;
    case "updateBookmark":
      return isStr(c.id, 64) &&
        (c.title === undefined || isStr(c.title, 512)) &&
        (c.parent === undefined || c.parent === null || isStr(c.parent, 64))
        ? {
            type: "updateBookmark",
            id: c.id,
            title: c.title,
            parent: c.parent,
          }
        : null;
    case "removeBookmark":
      return isStr(c.id, 64) ? { type: "removeBookmark", id: c.id } : null;
    case "newBookmarkFolder":
      return c.parent === null || isStr(c.parent, 64)
        ? { type: "newBookmarkFolder", parent: c.parent }
        : null;
    case "openBookmarkFolder":
      return isStr(c.id, 64) &&
        (c.disposition === "background" ||
          c.disposition === "window" ||
          c.disposition === "private")
        ? { type: "openBookmarkFolder", id: c.id, disposition: c.disposition }
        : null;
    case "answerDialog":
      return isNum(c.id) &&
        isNum(c.response) &&
        (c.text === undefined || isStr(c.text, 1 << 20)) &&
        (c.checked === undefined || typeof c.checked === "boolean")
        ? { type: "answerDialog", id: c.id, response: c.response, text: c.text, checked: c.checked }
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
    case "extensionPin":
      return isExtensionId(c.extensionId) && typeof c.pinned === "boolean"
        ? { type: "extensionPin", extensionId: c.extensionId, pinned: c.pinned }
        : null;
    case "extensionMenu":
      return isExtensionId(c.extensionId) && isNum(c.x) && isNum(c.y)
        ? { type: "extensionMenu", extensionId: c.extensionId, x: c.x, y: c.y }
        : null;
    case "sidePanelToggle":
      return isExtensionId(c.extensionId)
        ? { type: "sidePanelToggle", extensionId: c.extensionId }
        : null;
    case "sidePanelClose":
      return { type: "sidePanelClose" };
    case "groupTab":
      return isNum(c.tabId)
        ? { type: "groupTab", tabId: c.tabId, groupId: isNum(c.groupId) ? c.groupId : undefined }
        : null;
    case "ungroupTab":
      return isNum(c.tabId) ? { type: "ungroupTab", tabId: c.tabId } : null;
    case "moveGroup":
      return isNum(c.groupId) && isNum(c.index)
        ? { type: "moveGroup", groupId: c.groupId, index: c.index }
        : null;
    case "groupUpdate":
      return isNum(c.groupId)
        ? {
            type: "groupUpdate",
            groupId: c.groupId,
            title: isStr(c.title, 200) ? c.title : undefined,
            color: isGroupColor(c.color) ? c.color : undefined,
            collapsed: typeof c.collapsed === "boolean" ? c.collapsed : undefined,
          }
        : null;
    case "groupAction":
      return isNum(c.groupId) && ["newTab", "ungroup", "close"].includes(c.action as string)
        ? { type: "groupAction", groupId: c.groupId, action: c.action as GroupAction }
        : null;
    case "sidePanelWidth":
      return isNum(c.width) ? { type: "sidePanelWidth", width: c.width } : null;
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

  ipcMain.handle(UI_CHANNELS.bookmarkChildren, (event, folder: unknown) => {
    uiWindow(event);
    return isStr(folder, 64) ? browser.profile.bookmarkChildren(folder) : [];
  });
  ipcMain.handle(UI_CHANNELS.bookmarkFolders, (event) => {
    uiWindow(event);
    return folderChoices(browser.profile.bookmarks.get());
  });
  ipcMain.handle(UI_CHANNELS.addBookmarkFolder, (event, title: unknown, parent: unknown) => {
    const win = uiWindow(event);
    if (!isStr(title, 512) || !(parent === null || isStr(parent, 64))) return null;
    return win.addBookmarkFolder(title, parent);
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
      bookmarks: browser.profile.bookmarkLinks(),
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
      suggestDefault:
        !tab.window.isPrivate &&
        !profile.stats.get().defaultBrowserHintDismissed &&
        !(await browser.defaultBrowser.refresh()),
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
      // As in Chrome: imported bookmarks show on the bookmarks bar at once.
      if (result.bookmarks > 0 && !browser.settings.showBookmarksBar)
        browser.updateSettings({ showBookmarksBar: true });
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
        parent: patch.parent === null ? null : isStr(patch.parent, 64) ? patch.parent : undefined,
        index: isNum(patch.index) ? patch.index : undefined,
      });
      browser.notifyInternal("bookmarks");
      browser.updateAllWindows();
    },
    "bookmarks.addFolder": (_tab, title, parent) => {
      const folder = profile.addBookmarkFolder(
        isStr(title, 512) ? title : "",
        isStr(parent, 64) ? parent : null,
      );
      browser.notifyInternal("bookmarks");
      browser.updateAllWindows();
      return folder;
    },
    "bookmarks.showBar": (_tab, visible) => {
      if (typeof visible === "boolean") browser.updateSettings({ showBookmarksBar: visible });
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
        browser.permissions.reset(origin, isStr(kind, 64) ? (kind as PermissionKind) : undefined);
    },
    "protection.remove": (_tab, site) => {
      const s = isStr(site, 512) ? normalizeSite(site) : null;
      if (s) {
        browser.updateSettings({
          protectionAllowlist: browser.settings.protectionAllowlist.filter((x) => x !== s),
        });
      }
    },
    "extensions.list": () => browser.extensions.list(),
    "extensions.setEnabled": (_tab, id, enabled) => {
      if (isStr(id, 64) && typeof enabled === "boolean")
        return browser.extensions.setEnabled(id, enabled);
    },
    "extensions.remove": (_tab, id) => {
      if (isStr(id, 64)) return browser.extensions.remove(id);
    },
    "extensions.options": (_tab, id) => {
      if (isStr(id, 64)) return browser.extensions.openOptions(id);
    },
    "extensions.clearErrors": (_tab, id) => {
      if (isExtensionId(id)) browser.extensions.clearErrors(id);
    },
    "extensions.developerMode": () => browser.extensions.developerMode(),
    "extensions.setDeveloperMode": (_tab, on) => {
      if (typeof on === "boolean") return browser.extensions.setDeveloperMode(on);
    },
    "extensions.loadUnpacked": (tab) => browser.extensions.loadUnpacked(tab.window.win),
    "extensions.reload": (_tab, id) => {
      if (isExtensionId(id)) return browser.extensions.reload(id);
    },
    "extensions.repair": (_tab, id) => {
      if (isExtensionId(id)) return browser.extensions.repair(id);
    },
    "update.status": () => browser.updater.status(),
    "update.check": () => browser.updater.check(),
    "update.install": () => browser.updater.install(),
    "defaultBrowser.get": () => browser.defaultBrowser.refresh(true),
    "defaultBrowser.set": () => browser.defaultBrowser.make(),
    "defaultBrowser.dismissHint": () => {
      profile.stats.get().defaultBrowserHintDismissed = true;
      profile.stats.changed();
    },
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
