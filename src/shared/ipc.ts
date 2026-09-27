/**
 * The IPC contract between the main process and its two kinds of renderers:
 *
 *  - the browser UI (moon://ui) sends `UiCommand`s and receives the state of
 *    its window;
 *  - internal pages (moon://settings, …) call `InternalMethod`s, each page
 *    only the ones listed for it in `PAGE_METHODS`.
 *
 * The main process validates every message: who sent it, and what it says.
 */
import type { ShortcutCommand } from "./shortcuts";
import type { InternalPage } from "./internal";
import type { GroupColor } from "./tab-groups";
import type { Rect, WindowState } from "./types";

export type Disposition = "current" | "foreground" | "background" | "window" | "private";

export type UiCommand =
  | ShortcutCommand
  | { type: "activate"; tabId: number }
  | { type: "close"; tabId: number }
  | { type: "move"; tabId: number; index: number }
  | { type: "navigate"; input: string; disposition?: Disposition }
  | { type: "openUrl"; url: string; disposition?: Disposition }
  | { type: "stop" }
  | { type: "tabMenu"; tabId: number; x: number; y: number }
  | { type: "bookmarkMenu"; id: string; x: number; y: number }
  | { type: "toggleMute"; tabId: number }
  | { type: "respondPrompt"; id: number; allow: boolean; remember: boolean }
  | { type: "answerDialog"; id: number; response: number; text?: string; checked?: boolean }
  | { type: "findInPage"; text: string; forward: boolean; findNext: boolean }
  | { type: "stopFind" }
  | { type: "toggleProtection" }
  | { type: "split"; tabId?: number }
  | { type: "unsplit" }
  | { type: "splitRatio"; ratio: number }
  | { type: "download"; id: string; action: DownloadAction }
  /** Continue past an HTTPS or Moon Shield warning for this tab's page. */
  | { type: "proceed"; tabId: number }
  | { type: "focusPage" }
  /** Restart Moon Browser and install the downloaded update. */
  | { type: "installUpdate" }
  | { type: "makeDefaultBrowser" }
  /** Show or hide an extension's button in the toolbar. */
  | { type: "extensionPin"; extensionId: string; pinned: boolean }
  /** The ⋮ menu of an extension (options, pin, remove, …). */
  | { type: "extensionMenu"; extensionId: string; x: number; y: number }
  | { type: "sidePanelToggle"; extensionId: string }
  | { type: "sidePanelClose" }
  | { type: "sidePanelWidth"; width: number }
  /** Put a tab into a group (a new one without groupId). */
  | { type: "groupTab"; tabId: number; groupId?: number }
  | { type: "ungroupTab"; tabId: number }
  /** Move a whole group: `index` is where its first tab goes, among the other tabs. */
  | { type: "moveGroup"; groupId: number; index: number }
  | {
      type: "groupUpdate";
      groupId: number;
      title?: string;
      color?: GroupColor;
      collapsed?: boolean;
    }
  | { type: "groupAction"; groupId: number; action: GroupAction }
  | { type: "insets"; top: number; bottom: number };

export type GroupAction = "newTab" | "ungroup" | "close";

export type DownloadAction = "open" | "show" | "cancel" | "pause" | "resume" | "remove";

/** Messages from the main process to the browser UI. */
export type UiEvent =
  | { type: "focusAddressBar" }
  | { type: "find" }
  | { type: "closePopovers" }
  /** Open the name-and-colour editor of a (new) tab group. */
  | { type: "editGroup"; groupId: number };

export interface OverlaySnapshot {
  rect: Rect;
  dataUrl: string;
}

export const UI_CHANNELS = {
  command: "ui:command",
  suggest: "ui:suggest",
  overlayOpen: "ui:overlay-open",
  overlayReady: "ui:overlay-ready",
  overlayClose: "ui:overlay-close",
  state: "ui:state",
  event: "ui:event",
  ready: "ui:ready",
} as const;

export type UiStateListener = (state: WindowState) => void;

export type InternalMethod =
  | "settings.get"
  | "settings.set"
  | "engines.list"
  | "newtab.info"
  | "topSites.hide"
  | "navigate"
  | "history.query"
  | "history.remove"
  | "bookmarks.list"
  | "bookmarks.update"
  | "bookmarks.remove"
  | "downloads.list"
  | "downloads.action"
  | "downloads.clear"
  | "data.clear"
  | "adblock.status"
  | "adblock.update"
  | "permissions.list"
  | "permissions.reset"
  | "protection.remove"
  | "defaultBrowser.get"
  | "defaultBrowser.set"
  | "defaultBrowser.dismissHint"
  | "downloads.chooseFolder"
  | "about.info"
  | "extensions.list"
  | "extensions.setEnabled"
  | "extensions.remove"
  | "extensions.options"
  | "extensions.clearErrors"
  | "extensions.developerMode"
  | "extensions.setDeveloperMode"
  | "extensions.loadUnpacked"
  | "extensions.reload"
  | "extensions.repair"
  | "update.status"
  | "update.check"
  | "update.install"
  | "import.detect"
  | "import.choose"
  | "import.run"
  | "import.dismissHint"
  | "openUrl";

const COMMON: InternalMethod[] = ["settings.get", "navigate", "openUrl"];

export const PAGE_METHODS: Record<InternalPage, readonly InternalMethod[]> = {
  newtab: [
    ...COMMON,
    "newtab.info",
    "topSites.hide",
    "import.dismissHint",
    "defaultBrowser.set",
    "defaultBrowser.dismissHint",
  ],
  settings: [
    ...COMMON,
    "settings.set",
    "engines.list",
    "data.clear",
    "adblock.status",
    "adblock.update",
    "permissions.list",
    "permissions.reset",
    "protection.remove",
    "defaultBrowser.get",
    "defaultBrowser.set",
    "downloads.chooseFolder",
    "about.info",
    "update.status",
    "update.check",
    "update.install",
    "import.detect",
    "import.choose",
    "import.run",
  ],
  history: [...COMMON, "history.query", "history.remove", "data.clear"],
  bookmarks: [...COMMON, "bookmarks.list", "bookmarks.update", "bookmarks.remove"],
  downloads: [...COMMON, "downloads.list", "downloads.action", "downloads.clear"],
  extensions: [
    ...COMMON,
    "extensions.list",
    "extensions.setEnabled",
    "extensions.remove",
    "extensions.options",
    "extensions.clearErrors",
    "extensions.developerMode",
    "extensions.setDeveloperMode",
    "extensions.loadUnpacked",
    "extensions.reload",
    "extensions.repair",
  ],
  about: [...COMMON, "about.info", "update.status", "update.check", "update.install"],
};

export const INTERNAL_CHANNEL = "moon:invoke";
export const INTERNAL_EVENT_CHANNEL = "moon:event";

/**
 * A page's alert(), confirm() or prompt(), asked synchronously by the web
 * preload; the answer is a PageDialogReply.
 */
export const PAGE_DIALOG_CHANNEL = "moon:page-dialog";

export type PageDialogKind = "alert" | "confirm" | "prompt";

/** "native": Electron's own box asks (outside a tab, e.g. an extension's pop-up). */
export type PageDialogReply = { native: true } | { ok: boolean; text: string | null };

export type InternalEvent =
  "settings" | "downloads" | "bookmarks" | "history" | "adblock" | "extensions" | "update";
