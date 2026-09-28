/**
 * Data shapes shared by the main process, the browser UI and the internal
 * pages. Everything here crosses an IPC boundary, so it is plain data only.
 */

import type { CustomDnsServer, DnsSetting } from "./dns";
import type { TabGroupInfo } from "./tab-groups";

export type ThemeChoice = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type StartupMode = "newtab" | "restore";
export type SearchEngineId =
  | "perplexity"
  | "duckduckgo"
  | "startpage"
  | "brave"
  | "kagi"
  | "ecosia"
  | "qwant"
  | "google"
  | "bing"
  | "custom";

export interface Settings {
  theme: ThemeChoice;
  searchEngine: SearchEngineId;
  /** Search URL with `%s` for the query, used when `searchEngine` is "custom". */
  customSearchUrl: string;
  /** `!w moon` searches Wikipedia, `!gh` opens GitHub, … */
  bangs: boolean;
  startup: StartupMode;
  /** Empty for the new tab page. */
  homePage: string;
  showHomeButton: boolean;
  showBookmarksBar: boolean;
  /** Load sites over HTTPS first and fall back to HTTP only when that fails. */
  httpsFirst: boolean;
  adblock: boolean;
  /** Also hide cookie banners and other annoyances. */
  adblockAnnoyances: boolean;
  /** Sites (registrable domains) where all protection is switched off. */
  protectionAllowlist: string[];
  blockThirdPartyCookies: boolean;
  /** Send the Global Privacy Control signal (`Sec-GPC: 1`). */
  globalPrivacyControl: boolean;
  /** Keep WebRTC from revealing local IP addresses. */
  webrtcProtection: boolean;
  /** Remove click IDs and campaign tags (utm_…, fbclid, …) from addresses. */
  stripTrackingParams: boolean;
  /** Which DNS: a built-in choice, or `custom:<id>` for one of `customDns`. */
  secureDns: DnsSetting;
  /** DNS servers the user added and named. */
  customDns: CustomDnsServer[];
  /** Delete cookies and site data when Moon Browser closes. */
  clearOnExit: boolean;
  /** Put tabs to sleep after they were unused for a while. */
  sleepTabs: boolean;
  sleepAfterMinutes: number;
  openTabsNextToActive: boolean;
  askDownloadLocation: boolean;
  /** Empty for the system's downloads folder. */
  downloadDir: string;
  spellcheck: boolean;
  /** Show the frequently visited sites on the new tab page. */
  newTabShortcuts: boolean;
  /** Look for a new version of Moon Browser every few hours. */
  autoUpdate: boolean;
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  sleeping: boolean;
  crashed: boolean;
  /** Ads and trackers blocked on the current page. */
  blocked: number;
  security: SecurityState;
  /** Zoom in percent (100 = normal). */
  zoom: number;
  /** Set when the page failed to load; the UI shows it instead of the page. */
  error: TabError | null;
  /** The tab group it is in (see WindowState.groups). */
  groupId: number | null;
}

export interface TabError {
  /**
   * "network": the page could not be loaded;
   * "https": the site has no working HTTPS — offer to continue over HTTP;
   * "blocked": Moon Shield stopped a page on a list of dangerous or tracking sites.
   */
  kind: "network" | "https" | "blocked";
  /** Chromium net error code, e.g. -105 for "name not resolved". */
  code: number;
  description: string;
  url: string;
  /** For "blocked": the filter rule that matched. */
  rule?: string;
  /** The name of the user's DNS server when it didn't answer the lookup. */
  dnsServer?: string;
}

export type SecurityState = "secure" | "insecure" | "internal" | "extension" | "local" | "error";

export interface SplitState {
  leftId: number;
  rightId: number;
  /** Share of the left pane, 0.2 … 0.8. */
  ratio: number;
}

export type PermissionKind =
  | "camera"
  | "microphone"
  | "camera-microphone"
  | "geolocation"
  | "notifications"
  | "clipboard-read"
  | "open-external"
  | "popup";

/** What a Moon dialog shows as its picture, when it has no image of its own. */
export type DialogGlyph =
  "extension" | "permission" | "download" | "leave" | "remove" | "page" | "folder";

export interface DialogButton {
  label: string;
  /** "primary" is the suggested answer, "danger" one that can't be taken back. */
  style: "primary" | "secondary" | "danger";
}

/**
 * A question Moon Browser asks inside the window, in its own look, where
 * other browsers show the system's message box.
 */
export interface DialogInfo {
  id: number;
  /** "warning" for a risk the person should weigh (a program download). */
  tone: "calm" | "warning";
  glyph: DialogGlyph;
  /** An image instead of the glyph (a data: URL), e.g. the extension's icon. */
  image?: string;
  /** The small line above the title, e.g. "Extension". */
  eyebrow?: string;
  title: string;
  message?: string;
  /** A labelled list, e.g. what an extension could do. */
  list?: { label: string; items: string[] };
  notes?: string[];
  /** A text field (a page's window.prompt), with the value it starts with. */
  input?: { value: string };
  /** A checkbox under the text, e.g. "Don't let this page show more dialogs". */
  checkbox?: string;
  /** In the order shown; the answer is the chosen one's index. */
  buttons: DialogButton[];
  /** Focused first (Enter). */
  defaultId: number;
  /** The answer when the dialog is dismissed (Escape, the window closing). */
  cancelId: number;
}

export interface PermissionPrompt {
  id: number;
  tabId: number;
  origin: string;
  kind: PermissionKind;
  /** For "open-external": the app link; for "popup": the blocked address. */
  detail?: string;
}

export interface FindState {
  tabId: number;
  matches: number;
  active: number;
}

export type DownloadStateName = "progressing" | "completed" | "cancelled" | "interrupted";

export interface DownloadInfo {
  id: string;
  filename: string;
  path: string;
  url: string;
  state: DownloadStateName;
  received: number;
  total: number;
  paused: boolean;
  startTime: number;
}

export interface Bookmark {
  id: string;
  /** Empty for a folder. */
  url: string;
  title: string;
  favicon: string | null;
  created: number;
  /** The folder it's in; null on the bookmarks bar itself. */
  parent: string | null;
  /** A folder: holds the bookmarks (and folders) whose parent it is. */
  isFolder: boolean;
}

/** A folder to choose, with its path ("Anime / New"); null is the bookmarks bar. */
export interface BookmarkFolderChoice {
  id: string | null;
  path: string;
}

export interface HistoryEntry {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  typed: number;
  lastVisit: number;
}

export interface Suggestion {
  kind: "go" | "search" | "history" | "bookmark" | "tab";
  title: string;
  url: string;
  /** For "tab": the tab to switch to. */
  tabId?: number;
  /** A short hint shown at the end of the row ("Search with DuckDuckGo"). */
  detail?: string;
  favicon?: string | null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything the browser UI of one window renders. */
export interface WindowState {
  windowId: number;
  private: boolean;
  platform: string;
  tabs: TabInfo[];
  activeId: number;
  split: SplitState | null;
  prompts: PermissionPrompt[];
  find: FindState | null;
  downloads: DownloadInfo[];
  bookmarked: boolean;
  /** The active page's bookmark, for the star's editor. */
  currentBookmark: Bookmark | null;
  /** What the bookmarks bar shows: its bookmarks and folders. */
  bookmarksBar: Bookmark[];
  protection: { adblock: boolean; siteAllowed: boolean; site: string };
  theme: ResolvedTheme;
  showHomeButton: boolean;
  showBookmarksBar: boolean;
  searchEngineName: string;
  fullscreen: boolean;
  /** A downloaded update waiting for a restart: its version. */
  updateReady: string | null;
  /** False when another browser opens links (true while unknown). */
  isDefaultBrowser: boolean;
  /**
   * The page whose extension buttons the toolbar shows (its webContents id),
   * or null when no extensions run in this window.
   */
  extensionTab: number | null;
  /** The extensions running in this window (none in private windows). */
  extensions: ExtensionEntry[];
  /** The extension whose toolbar pop-up is open, if any. */
  extensionPopup: string | null;
  /** An extension's page shown next to the tabs, like Chrome's side panel. */
  sidePanel: SidePanelState | null;
  /** The window's tab groups; their tabs sit next to each other in `tabs`. */
  groups: TabGroupInfo[];
  /** The question the window asks right now, over everything else. */
  dialog: DialogInfo | null;
}

/** An extension as the toolbar and the extensions menu show it. */
export interface ExtensionEntry {
  id: string;
  name: string;
  /** A data: URL. */
  icon: string | null;
  /** Shown as a button in the toolbar (otherwise only in the extensions menu). */
  pinned: boolean;
  /** "full": it can read and change the current page; "none": it doesn't need to. */
  access: "full" | "none";
  hasOptions: boolean;
  /** Clicking its button opens its side panel instead of a pop-up. */
  opensSidePanel: boolean;
}

export interface SidePanelState {
  extensionId: string;
  name: string;
  icon: string | null;
  /** Width of the panel in pixels. */
  width: number;
}

export interface SiteSettingsEntry {
  origin: string;
  kind: PermissionKind;
  decision: "allow" | "deny";
}

export interface AdblockStatus {
  enabled: boolean;
  ready: boolean;
  updating: boolean;
  updatedAt: number | null;
  error: string | null;
  lists: string[];
  totalBlocked: number;
}

export interface AboutInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
  userData: string;
}

export interface UpdateStatus {
  /**
   * "unsupported": this copy can't update itself (a development build or an
   * unpacked folder); "idle": up to date, or not checked yet.
   */
  state: "unsupported" | "idle" | "checking" | "downloading" | "ready" | "error";
  current: string;
  /** The new version, while it downloads and once it is ready. */
  version: string | null;
  /** Download progress, 0 … 100. */
  percent: number;
  checkedAt: number | null;
  error: string | null;
  /** Installing asks for the administrator password (.deb and .rpm installs). */
  needsAdmin: boolean;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  /** A data: URL. */
  icon: string | null;
  hasOptions: boolean;
  /** "Read and change all your data on all websites", … */
  permissions: string[];
  /** Features Moon Browser can't offer this extension. */
  unsupported: string[];
  /** Recent errors from the extension's pages and service worker, newest last. */
  errors: string[];
  /** Loaded from a folder in developer mode. */
  unpacked: boolean;
  /** An unpacked extension's folder. */
  path: string | null;
  /** Its files turned out damaged; installing it again repairs it. */
  damaged: boolean;
}

export interface ImportableProfile {
  /** The profile folder, e.g. …/Comet/User Data/Default. */
  path: string;
  browser: string;
  profile: string;
  label: string;
}

export interface ImportResult {
  bookmarks: number;
  history: number;
  errors: string[];
}

export interface ClearDataOptions {
  /** Hours to clear, 0 for everything. */
  hours: number;
  history: boolean;
  cookies: boolean;
  cache: boolean;
  downloads: boolean;
}
