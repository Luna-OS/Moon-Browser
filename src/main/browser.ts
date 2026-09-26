/**
 * The browser as a whole: the profile, the sessions, all windows and tabs,
 * and the features that span them (settings, session restore, closed tabs,
 * tab sleeping).
 */
import {
  app,
  BrowserWindow,
  nativeTheme,
  session,
  webContents,
  type Input,
  type Session,
} from "electron";
import { resolveEngine, type SearchEngine } from "@shared/engines";
import { isInternalUrl } from "@shared/internal";
import { INTERNAL_EVENT_CHANNEL, type InternalEvent } from "@shared/ipc";
import { mergeSettings } from "@shared/settings";
import { shortcutFor, type ShortcutCommand } from "@shared/shortcuts";
import { protectionSiteOf } from "@shared/sites";
import type { ClearDataOptions, ResolvedTheme, Settings } from "@shared/types";
import { hostResolverConfig } from "@shared/security";
import { acceptLanguages, cleanUserAgent } from "@shared/useragent";
import { Adblocker } from "./adblock";
import { Downloads } from "./downloads";
import { Permissions } from "./permissions";
import { Profile, type SavedTab } from "./profile";
import { Importer } from "./importer";
import { handleInternalProtocol } from "./protocol";
import { applySpellcheck, configureBrowsingSession } from "./sessions";
import type { Tab } from "./tab";
import { MoonWindow, type WindowOptions } from "./window";

interface ClosedTab {
  windowId: number;
  index: number;
  saved: SavedTab;
}

export class Browser {
  readonly profile: Profile;
  readonly adblock: Adblocker;
  readonly permissions: Permissions;
  readonly downloads: Downloads;
  readonly importer: Importer;
  readonly windows = new Set<MoonWindow>();
  readonly httpsExceptions = new Set<string>();
  /** Hosts whose Moon Shield warning the user chose to pass, until quit. */
  readonly shieldExceptions = new Set<string>();
  /** Tabs whose current load was upgraded to HTTPS: tab id → host. */
  readonly upgraded = new Map<number, { host: string; time: number }>();
  uiSession!: Session;
  normalSession!: Session;
  private privateSes: Session | null = null;
  private privateGeneration = 0;
  private readonly tabsByContents = new Map<number, Tab>();
  private closedTabs: ClosedTab[] = [];
  private lastFocused: MoonWindow | null = null;
  private sessionTimer: NodeJS.Timeout | null = null;
  private userAgent = "";
  quitting = false;

  constructor() {
    this.profile = new Profile(process.platform);
    this.permissions = new Permissions(this);
    this.downloads = new Downloads(this);
    this.importer = new Importer(this.profile);
    this.adblock = new Adblocker({
      annoyances: () => this.settings.adblockAnnoyances,
      totalBlocked: () => this.profile.stats.get().totalBlocked,
      onChange: () => this.notifyInternal("adblock"),
    });
  }

  get settings(): Settings {
    return this.profile.settings.get();
  }

  engine(): SearchEngine {
    return resolveEngine(this.settings.searchEngine, this.settings.customSearchUrl);
  }

  resolvedTheme(): ResolvedTheme {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }

  shortcut(input: Input): ShortcutCommand | null {
    return shortcutFor(input, process.platform);
  }

  /** Called once the app is ready. */
  async init(): Promise<void> {
    nativeTheme.themeSource = this.settings.theme;
    nativeTheme.on("updated", () => {
      for (const w of this.windows) w.applyTheme();
      this.notifyInternal("settings");
    });

    this.userAgent = cleanUserAgent(app.userAgentFallback);
    app.userAgentFallback = this.userAgent;

    app.configureHostResolver(hostResolverConfig(this.settings.secureDns));

    this.uiSession = session.fromPartition("moon-ui");
    // Spell checking would download dictionaries from Google; only the
    // browsing sessions may, and only when switched on in Settings.
    this.uiSession.setSpellCheckerEnabled(false);
    handleInternalProtocol(this.uiSession, { ui: true });
    this.uiSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.uiSession.setPermissionCheckHandler(() => false);
    // The browser UI loads nothing from the web except the sites' icons.
    this.uiSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed =
        details.url.startsWith("moon:") ||
        details.url.startsWith("data:") ||
        details.url.startsWith("devtools:") ||
        (details.resourceType === "image" && /^https?:/.test(details.url));
      callback({ cancel: !allowed });
    });
    this.uiSession.webRequest.onBeforeSendHeaders((details, callback) => {
      delete details.requestHeaders.Cookie;
      delete details.requestHeaders.Referer;
      callback({ requestHeaders: details.requestHeaders });
    });

    this.normalSession = session.defaultSession;
    this.setupBrowsingSession(this.normalSession, false);

    this.adblock.registerCosmeticHandlers((event, url) => {
      const tab = this.tabFor(event.sender.id);
      return !!tab && this.protectionActive(tab.url.startsWith("http") ? tab.url : url);
    });
    await this.adblock.start();

    // Tabs nobody looked at for a while go to sleep.
    setInterval(() => this.sleepIdleTabs(), 60_000).unref();
  }

  private setupBrowsingSession(ses: Session, isPrivate: boolean): void {
    ses.setUserAgent(this.userAgent, acceptLanguages(app.getPreferredSystemLanguages()));
    configureBrowsingSession(this, ses, isPrivate);
  }

  /** Private windows share one in-memory session until the last one closes. */
  privateSession(): Session {
    if (!this.privateSes) {
      this.privateSes = session.fromPartition(`moon-private-${++this.privateGeneration}`, {
        cache: false,
      });
      this.setupBrowsingSession(this.privateSes, true);
    }
    return this.privateSes;
  }

  // ---- Windows ----

  createWindow(options: WindowOptions): MoonWindow {
    const win = new MoonWindow(this, options);
    this.windows.add(win);
    this.lastFocused = win;
    this.saveSessionSoon();
    return win;
  }

  focusedWindow(): MoonWindow | undefined {
    const focused = BrowserWindow.getFocusedWindow();
    for (const w of this.windows) if (w.win === focused) return w;
    if (this.lastFocused && this.windows.has(this.lastFocused)) return this.lastFocused;
    return [...this.windows].find((w) => !w.isPrivate) ?? [...this.windows][0];
  }

  windowFocused(win: MoonWindow): void {
    this.lastFocused = win;
  }

  /** The window showing a page (a tab or the UI itself). */
  windowForContents(contents: Electron.WebContents | undefined): MoonWindow | undefined {
    if (!contents) return undefined;
    return this.tabFor(contents.id)?.window ?? this.windowForUi(contents);
  }

  windowForUi(sender: Electron.WebContents): MoonWindow | undefined {
    for (const w of this.windows) if (!w.closed && w.win.webContents === sender) return w;
    return undefined;
  }

  /** A window is about to close: keep it in the session only if it is the last one. */
  windowClosing(win: MoonWindow): void {
    if (win.isPrivate || this.quitting) return;
    const normal = [...this.windows].filter((w) => !w.isPrivate && !w.closed);
    if (normal.length === 1 && normal[0] === win) {
      this.profile.session.set({ windows: [win.saved()] });
      this.profile.session.flush();
    } else {
      for (const tab of win.tabs) this.rememberClosed(tab);
    }
  }

  windowClosed(win: MoonWindow): void {
    this.windows.delete(win);
    if (this.lastFocused === win) this.lastFocused = null;
    if (win.isPrivate && ![...this.windows].some((w) => w.isPrivate) && this.privateSes) {
      // The private session ends with its last window: wipe it.
      const ses = this.privateSes;
      this.privateSes = null;
      void ses.clearStorageData();
      void ses.clearCache();
      void ses.clearAuthCache();
    }
    if (!win.isPrivate && !this.quitting) this.saveSessionSoon();
  }

  updateAllWindows(): void {
    for (const w of this.windows) w.update();
  }

  // ---- Tabs ----

  registerTab(webContentsId: number, tab: Tab): void {
    this.tabsByContents.set(webContentsId, tab);
  }

  unregisterTab(webContentsId: number): void {
    this.tabsByContents.delete(webContentsId);
  }

  tabFor(webContentsId: number): Tab | undefined {
    return this.tabsByContents.get(webContentsId);
  }

  tabById(id: number): Tab | undefined {
    for (const w of this.windows) {
      const tab = w.tab(id);
      if (tab) return tab;
    }
    return undefined;
  }

  allTabs(): Tab[] {
    return [...this.windows].flatMap((w) => w.tabs);
  }

  rememberClosed(tab: Tab): void {
    if (tab.window.isPrivate || tab.window.closed) return;
    this.closedTabs.push({
      windowId: tab.window.id,
      index: tab.window.tabs.indexOf(tab),
      saved: tab.saved(),
    });
    if (this.closedTabs.length > 25) this.closedTabs.shift();
  }

  hasClosedTabs(): boolean {
    return this.closedTabs.length > 0;
  }

  reopenClosedTab(win: MoonWindow): void {
    if (win.isPrivate) return;
    const closed = this.closedTabs.pop();
    if (!closed) return;
    const { saved } = closed;
    const target = [...this.windows].find((w) => w.id === closed.windowId && !w.closed) ?? win;
    target.openTab({
      url: saved.url,
      title: saved.title,
      pinned: false,
      index: closed.index,
      sleeping: true,
      history: saved.entries?.length ? { entries: saved.entries, index: saved.index ?? 0 } : null,
    });
    target.win.focus();
  }

  private sleepIdleTabs(): void {
    const s = this.settings;
    if (!s.sleepTabs) return;
    const cutoff = Date.now() - s.sleepAfterMinutes * 60_000;
    for (const tab of this.allTabs()) {
      if (tab.sleeping || tab.audible || tab.pinned || tab.loading) continue;
      if (tab.lastActive > cutoff || tab.window.isVisible(tab)) continue;
      if (tab.window.visibleTabs().includes(tab)) continue;
      tab.sleep();
    }
  }

  // ---- Protection ----

  /** False when the user switched Moon Shield off for the site of `pageUrl`. */
  siteProtected(pageUrl: string): boolean {
    const site = protectionSiteOf(pageUrl);
    return !!site && !this.settings.protectionAllowlist.includes(site);
  }

  /** Blocking and cookie rules apply unless the user switched them off for the site. */
  protectionActive(pageUrl: string): boolean {
    if (!this.settings.adblock && !this.settings.blockThirdPartyCookies) return false;
    const site = protectionSiteOf(pageUrl);
    if (!site) return false;
    return !this.settings.protectionAllowlist.includes(site);
  }

  toggleProtection(tab: Tab): void {
    const site = protectionSiteOf(tab.url);
    if (!site) return;
    const list = this.settings.protectionAllowlist;
    this.updateSettings({
      protectionAllowlist: list.includes(site) ? list.filter((s) => s !== site) : [...list, site],
    });
    tab.reload();
  }

  // ---- Settings ----

  updateSettings(patch: Partial<Settings>): Settings {
    const before = this.settings;
    const after = mergeSettings(before, patch, process.platform);
    this.profile.settings.set(after);
    if (before.theme !== after.theme) nativeTheme.themeSource = after.theme;
    if (before.spellcheck !== after.spellcheck) {
      for (const ses of [this.normalSession, this.privateSes])
        if (ses) applySpellcheck(ses, after.spellcheck);
    }
    if (before.webrtcProtection !== after.webrtcProtection) {
      for (const tab of this.allTabs()) {
        tab.wc?.setWebRTCIPHandlingPolicy(
          after.webrtcProtection ? "default_public_interface_only" : "default",
        );
      }
    }
    if (before.adblockAnnoyances !== after.adblockAnnoyances) this.adblock.listsChanged();
    if (before.secureDns !== after.secureDns)
      app.configureHostResolver(hostResolverConfig(after.secureDns));
    this.updateAllWindows();
    this.notifyInternal("settings");
    return after;
  }

  /** Tells the open internal pages that something they show has changed. */
  notifyInternal(event: InternalEvent): void {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || !this.tabFor(wc.id)) continue;
      if (isInternalUrl(wc.getURL())) wc.send(INTERNAL_EVENT_CHANNEL, event);
    }
  }

  async clearData(options: ClearDataOptions): Promise<void> {
    const since = options.hours > 0 ? Date.now() - options.hours * 3_600_000 : 0;
    if (options.history) {
      this.profile.clearHistory(since);
      this.closedTabs = [];
      if (since === 0) {
        this.profile.stats.get().hiddenTopSites = [];
        this.profile.stats.changed();
      }
    }
    if (options.downloads) this.downloads.clearFinished();
    if (options.cookies) {
      await this.normalSession.clearStorageData();
      await this.normalSession.clearAuthCache();
    }
    if (options.cache) {
      await this.normalSession.clearCache();
      await this.normalSession.clearCodeCaches({});
      await this.normalSession.clearHostResolverCache();
    }
    this.notifyInternal("history");
  }

  // ---- Session restore ----

  saveSessionSoon(): void {
    if (this.quitting) return;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => this.saveSession(), 1500);
  }

  saveSession(): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    const windows = [...this.windows].filter((w) => !w.isPrivate && !w.closed && w.tabs.length);
    if (!windows.length) return;
    this.profile.session.set({ windows: windows.map((w) => w.saved()) });
  }

  restoreOrOpen(urls: string[]): void {
    const saved = this.profile.session.get().windows;
    if (this.settings.startup === "restore" && saved.length) {
      for (const w of saved) this.createWindow({ saved: w });
      if (urls.length) this.focusedWindow()?.openTab({ url: urls[0] });
      for (const url of urls.slice(1)) this.focusedWindow()?.openTab({ url, background: true });
      return;
    }
    this.createWindow({ urls });
  }

  /** Addresses from the command line or another start of the app. */
  openExternalUrls(urls: string[]): void {
    const win = this.focusedWindow();
    if (!win) {
      this.createWindow({ urls });
      return;
    }
    urls.forEach((url, i) => win.openTab({ url, background: i > 0 }));
    if (win.win.isMinimized()) win.win.restore();
    win.win.focus();
  }

  quit(): void {
    this.quitting = true;
    this.saveSession();
    this.profile.flush();
  }

  /** "Delete cookies and site data when Moon Browser closes". */
  async clearSiteDataOnExit(): Promise<void> {
    await this.normalSession.clearStorageData();
    await this.normalSession.clearAuthCache();
    await this.normalSession.clearCache();
  }
}
