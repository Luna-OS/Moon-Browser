/**
 * A browser window: the browser UI (moon://ui) fills the window, and the
 * pages of the visible tab — or the two tabs of a split view — are
 * WebContentsViews laid over the UI's page area.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
  type Result,
  type Session,
  type WebContents,
  WebContentsView,
  type WebPreferences,
} from "electron";
import { FRAME_COLORS, TAB_STRIP_HEIGHT } from "@shared/chrome-colors";
import { internalUrl, isNewTabUrl, NEWTAB_URL, type InternalPage } from "@shared/internal";
import {
  UI_CHANNELS,
  type Disposition,
  type OverlaySnapshot,
  type UiCommand,
  type UiEvent,
} from "@shared/ipc";
import {
  clampPanelWidth,
  clampRatio,
  contentArea,
  SIDE_PANEL_WIDTH,
  sidePanelRects,
  splitRects,
  type Insets,
} from "@shared/layout";
import { resolveInput } from "@shared/omnibox";
import { protectionSiteOf } from "@shared/sites";
import type { FindState, Rect, SplitState, WindowState } from "@shared/types";
import type { Browser } from "./browser";
import { internalPreload, uiPreload, windowIcon } from "./paths";
import type { SavedWindow } from "./profile";
import { Tab, type TabInit } from "./tab";

export interface WindowOptions {
  private?: boolean;
  urls?: string[];
  saved?: SavedWindow;
}

/** Addresses the UI may open directly (bookmarks, suggestions). */
export function isOpenableUrl(url: string): boolean {
  return /^(https?|file|moon|view-source):/i.test(url) || url === "about:blank";
}

export class MoonWindow {
  readonly win: BrowserWindow;
  readonly isPrivate: boolean;
  readonly session: Session;
  tabs: Tab[] = [];
  activeId = -1;
  split: SplitState | null = null;
  find: FindState | null = null;
  private findText = "";
  private insets: Insets = { top: TAB_STRIP_HEIGHT + 44, right: 0, bottom: 0, left: 0 };
  private readonly attached = new Set<WebContentsView>();
  private overlayOpen = false;
  private htmlFullscreen: Tab | null = null;
  /** An extension's side panel next to the tabs. */
  private sidePanel: { extensionId: string; url: string; view: WebContentsView } | null = null;
  private sidePanelWidth = SIDE_PANEL_WIDTH;
  private fullscreenByPage = false;
  private updateScheduled = false;
  private softTimer: NodeJS.Timeout | null = null;
  closed = false;

  constructor(
    readonly browser: Browser,
    options: WindowOptions = {},
  ) {
    this.isPrivate = options.private ?? false;
    this.session = this.isPrivate ? browser.privateSession() : browser.normalSession;
    const theme = browser.resolvedTheme();
    const colors = FRAME_COLORS[theme];
    const bounds = options.saved?.bounds;

    this.win = new BrowserWindow({
      width: bounds?.width ?? 1280,
      height: bounds?.height ?? 820,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 480,
      minHeight: 320,
      show: false,
      title: "Moon Browser",
      backgroundColor: this.isPrivate ? colors.privateFrame : colors.frame,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: this.isPrivate ? colors.privateFrame : colors.frame,
        symbolColor: colors.symbols,
        height: TAB_STRIP_HEIGHT,
      },
      icon: process.platform === "linux" ? windowIcon : undefined,
      autoHideMenuBar: true,
      webPreferences: {
        session: browser.uiSession,
        preload: uiPreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        webviewTag: false,
      },
    });
    this.win.setMenu(null);

    const ui = this.win.webContents;
    ui.on("will-navigate", (event) => event.preventDefault());
    ui.setWindowOpenHandler(() => ({ action: "deny" }));
    ui.on("before-input-event", (event, input) => {
      const command = this.browser.shortcut(input);
      if (command) {
        event.preventDefault();
        this.command(command);
      }
    });
    ui.on("render-process-gone", () => {
      if (!this.closed) ui.reload();
    });

    this.win.on("resize", () => this.layout());
    this.win.on("maximize", () => this.layout());
    this.win.on("unmaximize", () => this.layout());
    this.win.on("enter-full-screen", () => {
      this.layout();
      this.update();
    });
    this.win.on("leave-full-screen", () => {
      this.fullscreenByPage = false;
      if (this.htmlFullscreen?.wc)
        this.htmlFullscreen.wc
          .executeJavaScript("document.exitFullscreen?.()", true)
          .catch(() => undefined);
      this.htmlFullscreen = null;
      this.layout();
      this.update();
    });
    this.win.on("focus", () => browser.windowFocused(this));
    this.win.on("app-command", (_event, cmd) => {
      if (cmd === "browser-backward") this.activeTab?.back();
      if (cmd === "browser-forward") this.activeTab?.forward();
    });
    this.win.on("close", () => browser.windowClosing(this));
    this.win.on("closed", () => {
      this.closed = true;
      for (const tab of [...this.tabs]) {
        browser.permissions.cancelTab(tab.id);
        const wc = tab.wc;
        if (wc) {
          browser.unregisterTab(wc.id);
          wc.close();
        }
      }
      this.tabs = [];
      const panel = this.sidePanel;
      this.sidePanel = null;
      if (panel && !panel.view.webContents.isDestroyed()) panel.view.webContents.close();
      browser.windowClosed(this);
    });

    this.win.once("ready-to-show", () => {
      if (options.saved?.maximized) this.win.maximize();
      this.win.show();
    });

    // Tabs: a saved window, some addresses, or one new tab.
    if (options.saved) {
      for (const [i, saved] of options.saved.tabs.entries()) {
        const tab = new Tab(this, {
          url: saved.url,
          title: saved.title,
          pinned: saved.pinned,
          sleeping: true,
          history: saved.entries?.length
            ? { entries: saved.entries, index: saved.index ?? saved.entries.length - 1 }
            : null,
        });
        this.tabs.push(tab);
        if (i === options.saved.active) this.activeId = tab.id;
      }
    } else {
      for (const url of options.urls?.length ? options.urls : [NEWTAB_URL]) {
        this.tabs.push(new Tab(this, { url }));
      }
    }
    if (this.activeId < 0) this.activeId = this.tabs[0].id;
    this.activeTab?.wake();

    void this.win.loadURL("moon://ui/");
    ui.once("did-finish-load", () => {
      this.update();
      this.layout();
      if (isNewTabUrl(this.activeTab?.url ?? "")) this.focusAddressBar();
    });
  }

  get id(): number {
    return this.win.id;
  }

  get activeTab(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  tab(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  tabPreferences(): WebPreferences {
    return {
      session: this.session,
      preload: internalPreload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      safeDialogs: true,
      safeDialogsMessage: "Don't let this page show more dialogs",
      spellcheck: this.browser.settings.spellcheck,
      plugins: true,
      autoplayPolicy: "document-user-activation-required",
      enableWebSQL: false,
    };
  }

  // ---- Tabs ----

  openTab(options: TabInit & { background?: boolean; index?: number } = {}): Tab {
    const tab = new Tab(this, { url: options.url ?? NEWTAB_URL, ...options });
    this.insertTab(tab, options.index);
    if (options.background) this.update();
    else this.activate(tab.id);
    this.browser.saveSessionSoon();
    return tab;
  }

  /** A page the opener created itself (window.open, links with a target). */
  adoptTab(webContents: WebContents, options: { openerId: number; url: string }): Tab {
    const tab = new Tab(this, { webContents, openerId: options.openerId, url: options.url });
    this.insertTab(tab);
    this.activate(tab.id, { focusPage: false });
    return tab;
  }

  private insertTab(tab: Tab, index?: number): void {
    const firstUnpinned = this.tabs.findIndex((t) => !t.pinned);
    const minIndex = firstUnpinned < 0 ? this.tabs.length : firstUnpinned;
    let at = index;
    if (at === undefined) {
      const activeIndex = this.tabs.findIndex((t) => t.id === this.activeId);
      if (tab.openerId !== null) {
        // After the opener and the tabs it already opened, like Chrome.
        at = this.tabs.findIndex((t) => t.id === tab.openerId) + 1;
        while (at > 0 && at < this.tabs.length && this.tabs[at].openerId === tab.openerId) at++;
      } else if (this.browser.settings.openTabsNextToActive && activeIndex >= 0) {
        at = activeIndex + 1;
      } else {
        at = this.tabs.length;
      }
    }
    this.tabs.splice(Math.max(minIndex, Math.min(this.tabs.length, at)), 0, tab);
  }

  activate(id: number, options: { focusPage?: boolean } = {}): void {
    const tab = this.tab(id);
    if (!tab) return;
    const previous = this.activeTab;
    if (previous) previous.lastActive = Date.now();
    this.activeId = tab.id;
    tab.lastActive = Date.now();
    for (const t of this.visibleTabs()) t.wake();
    if (tab.wc) this.browser.extensions.selectTab(tab.wc);
    this.refreshSidePanel();
    if (this.find && this.find.tabId !== tab.id) this.stopFind();
    this.layout();
    this.update();
    if (isNewTabUrl(tab.url)) this.focusAddressBar();
    else if (options.focusPage !== false) tab.focus();
  }

  /** Called by a tab once it is gone. */
  removeTab(tab: Tab): void {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    this.browser.permissions.cancelTab(tab.id);
    let next: Tab | undefined;
    if (this.split && (this.split.leftId === tab.id || this.split.rightId === tab.id)) {
      const other = this.split.leftId === tab.id ? this.split.rightId : this.split.leftId;
      this.split = null;
      if (this.activeId === tab.id) next = this.tab(other);
    }
    if (this.find?.tabId === tab.id) this.find = null;
    if (this.htmlFullscreen === tab) this.setHtmlFullscreen(tab, false);
    if (this.closed) return;
    if (this.tabs.length === 0) {
      this.win.close();
      return;
    }
    if (this.activeId === tab.id) {
      const opener = tab.openerId !== null ? this.tab(tab.openerId) : undefined;
      next ??= opener ?? this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activate(next.id);
    } else {
      this.layout();
      this.update();
    }
    this.browser.saveSessionSoon();
  }

  moveTab(id: number, index: number): void {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    const to = tab.pinned
      ? Math.max(0, Math.min(pinnedCount, index))
      : Math.max(pinnedCount, Math.min(this.tabs.length, index));
    this.tabs.splice(to, 0, tab);
    this.update();
    this.browser.saveSessionSoon();
  }

  private togglePin(tab: Tab): void {
    tab.pinned = !tab.pinned;
    const others = this.tabs.filter((t) => t !== tab);
    const pinnedCount = others.filter((t) => t.pinned).length;
    others.splice(pinnedCount, 0, tab);
    this.tabs = others;
    this.update();
    this.browser.saveSessionSoon();
  }

  visibleTabs(): Tab[] {
    const active = this.activeTab;
    if (!active) return [];
    const split = this.split;
    if (split && (split.leftId === active.id || split.rightId === active.id)) {
      const left = this.tab(split.leftId);
      const right = this.tab(split.rightId);
      if (left && right) return [left, right];
    }
    return [active];
  }

  isVisible(tab: Tab): boolean {
    return (
      !this.closed &&
      this.win.isVisible() &&
      !this.win.isMinimized() &&
      this.visibleTabs().includes(tab)
    );
  }

  // ---- Layout ----

  layout(): void {
    if (this.closed || this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const wanted = new Map<WebContentsView, Rect>();
    if (!this.overlayOpen) {
      if (this.htmlFullscreen?.view) {
        wanted.set(this.htmlFullscreen.view, { x: 0, y: 0, width, height });
      } else {
        let area = contentArea(width, height, this.insets);
        if (this.sidePanel) {
          const rects = sidePanelRects(area, this.sidePanelWidth);
          wanted.set(this.sidePanel.view, rects.view);
          area = rects.pages;
        }
        const visible = this.visibleTabs();
        const rects =
          visible.length === 2 && this.split ? splitRects(area, this.split.ratio) : [area];
        visible.forEach((tab, i) => {
          if (tab.view && !tab.crashed && !tab.error) wanted.set(tab.view, rects[i]);
        });
      }
    }
    for (const view of [...this.attached]) {
      if (!wanted.has(view)) this.detach(view);
    }
    for (const [view, rect] of wanted) {
      if (!this.attached.has(view)) {
        this.win.contentView.addChildView(view);
        this.attached.add(view);
      }
      view.setBounds(rect);
    }
  }

  // ---- Side panel ----

  /** Shows an extension's side panel (chrome.sidePanel); false if it has none. */
  openSidePanel(extensionId: string): boolean {
    if (this.isPrivate || this.closed) return false;
    const url = this.browser.extensions.panelUrl(extensionId, this.activeTab?.wc?.id);
    if (!url) return false;
    if (this.sidePanel?.extensionId === extensionId) return true;
    this.closeSidePanel();
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        safeDialogs: true,
      },
    });
    view.setBackgroundColor("#ffffff");
    const wc = view.webContents;
    // The panel shows the extension's pages; links to the web open as tabs.
    wc.setWindowOpenHandler(({ url: target }) => {
      if (/^(https?|chrome-extension):/i.test(target)) this.openTab({ url: target });
      return { action: "deny" };
    });
    wc.on("will-frame-navigate", (details) => {
      if (!details.isMainFrame || details.url.startsWith(`chrome-extension://${extensionId}/`))
        return;
      details.preventDefault();
      if (/^https?:/i.test(details.url)) this.openTab({ url: details.url });
    });
    wc.on("render-process-gone", () => this.closeSidePanel(extensionId));
    this.sidePanel = { extensionId, url, view };
    wc.loadURL(url).catch(() => undefined);
    this.browser.extensions.panelOpened(this, extensionId, url);
    this.layout();
    this.update();
    return true;
  }

  closeSidePanel(extensionId?: string): void {
    const panel = this.sidePanel;
    if (!panel || (extensionId && panel.extensionId !== extensionId)) return;
    this.sidePanel = null;
    this.detach(panel.view);
    if (!panel.view.webContents.isDestroyed()) panel.view.webContents.close();
    this.browser.extensions.panelClosed(this, panel.extensionId, panel.url);
    if (this.closed) return;
    this.layout();
    this.update();
  }

  toggleSidePanel(extensionId: string): void {
    if (this.sidePanel?.extensionId === extensionId) this.closeSidePanel();
    else this.openSidePanel(extensionId);
  }

  /** Follows chrome.sidePanel.setOptions: another page for this tab, or none. */
  refreshSidePanel(): void {
    const panel = this.sidePanel;
    if (!panel) return;
    const url = this.browser.extensions.panelUrl(panel.extensionId, this.activeTab?.wc?.id);
    if (!url) this.closeSidePanel();
    else if (url !== panel.url) {
      panel.url = url;
      panel.view.webContents.loadURL(url).catch(() => undefined);
    }
  }

  detach(view: WebContentsView): void {
    if (!this.attached.delete(view)) return;
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
  }

  setHtmlFullscreen(tab: Tab, on: boolean): void {
    if (on) {
      this.htmlFullscreen = tab;
      if (!this.win.isFullScreen()) {
        this.fullscreenByPage = true;
        this.win.setFullScreen(true);
      }
    } else if (this.htmlFullscreen === tab) {
      this.htmlFullscreen = null;
      if (this.fullscreenByPage && this.win.isFullScreen()) this.win.setFullScreen(false);
      this.fullscreenByPage = false;
    }
    this.layout();
    this.update();
  }

  async openOverlay(): Promise<OverlaySnapshot[]> {
    const shots: OverlaySnapshot[] = [];
    for (const view of this.attached) {
      try {
        const image = await view.webContents.capturePage();
        if (!image.isEmpty()) {
          shots.push({
            rect: view.getBounds(),
            dataUrl: `data:image/jpeg;base64,${image.toJPEG(90).toString("base64")}`,
          });
        }
      } catch {
        // No snapshot: the page area just shows the background meanwhile.
      }
    }
    return shots;
  }

  overlayReady(): void {
    this.overlayOpen = true;
    this.layout();
  }

  closeOverlay(): void {
    this.overlayOpen = false;
    this.layout();
  }

  // ---- State for the UI ----

  update(): void {
    if (this.updateScheduled || this.closed) return;
    this.updateScheduled = true;
    setImmediate(() => {
      this.updateScheduled = false;
      if (this.closed || this.win.isDestroyed()) return;
      this.win.webContents.send(UI_CHANNELS.state, this.state());
      const title = this.activeTab?.info().title;
      this.win.setTitle(
        title ? `${title} – Moon Browser${this.isPrivate ? " (Private)" : ""}` : "Moon Browser",
      );
    });
  }

  /** For frequent, unimportant changes (blocked-request counters). */
  updateSoon(): void {
    if (this.softTimer) return;
    this.softTimer = setTimeout(() => {
      this.softTimer = null;
      this.update();
    }, 300);
  }

  send(event: UiEvent): void {
    if (!this.closed) this.win.webContents.send(UI_CHANNELS.event, event);
  }

  state(): WindowState {
    const settings = this.browser.settings;
    const active = this.activeTab;
    const site = active ? protectionSiteOf(active.url) : null;
    const tabIds = new Set(this.tabs.map((t) => t.id));
    const split =
      this.split && tabIds.has(this.split.leftId) && tabIds.has(this.split.rightId)
        ? this.split
        : null;
    return {
      windowId: this.id,
      private: this.isPrivate,
      platform: process.platform,
      tabs: this.tabs.map((t) => t.info()),
      activeId: this.activeId,
      split,
      prompts: this.browser.permissions.prompts(tabIds),
      find: this.find,
      downloads: this.browser.downloads.recent(this.isPrivate),
      bookmarked: !!active && !!this.browser.profile.bookmarkFor(active.url),
      bookmarksBar: settings.showBookmarksBar
        ? this.browser.profile.bookmarks.get().slice(0, 60)
        : [],
      protection: {
        adblock: settings.adblock,
        siteAllowed: !!site && settings.protectionAllowlist.includes(site),
        site: site ?? "",
      },
      theme: this.browser.resolvedTheme(),
      showHomeButton: settings.showHomeButton,
      showBookmarksBar: settings.showBookmarksBar,
      searchEngineName: this.browser.engine().name,
      fullscreen: this.win.isFullScreen(),
      updateReady: this.browser.updater.readyVersion(),
      isDefaultBrowser: this.isPrivate || this.browser.defaultBrowser.isDefault,
      extensionTab:
        !this.isPrivate && this.browser.extensions.count() > 0 ? (active?.wc?.id ?? null) : null,
      extensions: this.isPrivate ? [] : this.browser.extensions.entries(active?.url ?? ""),
      sidePanel: this.sidePanelState(),
    };
  }

  private sidePanelState(): WindowState["sidePanel"] {
    const panel = this.sidePanel;
    if (!panel) return null;
    const entry = this.browser.extensions.entry(panel.extensionId);
    return {
      extensionId: panel.extensionId,
      name: entry?.name ?? "Extension",
      icon: entry?.icon ?? null,
      width: this.sidePanelWidth,
    };
  }

  applyTheme(): void {
    const colors = FRAME_COLORS[this.browser.resolvedTheme()];
    const frame = this.isPrivate ? colors.privateFrame : colors.frame;
    this.win.setBackgroundColor(frame);
    if (process.platform !== "darwin") {
      this.win.setTitleBarOverlay({
        color: frame,
        symbolColor: colors.symbols,
        height: TAB_STRIP_HEIGHT,
      });
    }
    this.update();
  }

  saved(): SavedWindow {
    return {
      tabs: this.tabs.map((t) => t.saved()),
      active: Math.max(
        0,
        this.tabs.findIndex((t) => t.id === this.activeId),
      ),
      bounds: this.win.getNormalBounds(),
      maximized: this.win.isMaximized(),
    };
  }

  // ---- Events from tabs ----

  onTabFocused(tab: Tab): void {
    // Clicking into the other half of a split view makes it the active tab.
    if (tab.id !== this.activeId && this.visibleTabs().includes(tab)) {
      this.activeId = tab.id;
      this.update();
    }
  }

  onTabNavigated(tab: Tab): void {
    if (this.find?.tabId === tab.id) {
      this.find = null;
      this.findText = "";
    }
    this.browser.saveSessionSoon();
  }

  onFound(tab: Tab, result: Result): void {
    if (!this.find || this.find.tabId !== tab.id) return;
    this.find = { tabId: tab.id, matches: result.matches, active: result.activeMatchOrdinal };
    this.update();
  }

  // ---- Find in page ----

  private findInPage(text: string, forward: boolean, findNext: boolean): void {
    const tab = this.activeTab;
    const wc = tab?.wc;
    if (!tab || !wc || !text) {
      this.stopFind();
      return;
    }
    const again = findNext && text === this.findText;
    this.findText = text;
    this.find = { tabId: tab.id, matches: this.find?.matches ?? 0, active: this.find?.active ?? 0 };
    wc.findInPage(text, { forward, findNext: !again });
    this.update();
  }

  private stopFind(): void {
    const tab = this.find ? this.tab(this.find.tabId) : undefined;
    tab?.wc?.stopFindInPage("keepSelection");
    this.find = null;
    this.findText = "";
    this.update();
  }

  // ---- Focus ----

  focusAddressBar(): void {
    if (this.closed) return;
    this.win.webContents.focus();
    this.send({ type: "focusAddressBar" });
  }

  // ---- Commands from the UI and from shortcuts ----

  openUrl(
    url: string,
    disposition: Disposition = "current",
    options: { typed?: boolean } = {},
  ): void {
    switch (disposition) {
      case "foreground":
        this.openTab({ url });
        break;
      case "background":
        this.openTab({ url, background: true });
        break;
      case "window":
        this.browser.createWindow({ urls: [url] });
        break;
      case "private":
        this.browser.createWindow({ private: true, urls: [url] });
        break;
      default: {
        const tab = this.activeTab;
        if (!tab) {
          this.openTab({ url });
          return;
        }
        tab.load(url, options);
        if (!isNewTabUrl(url)) tab.focus();
      }
    }
  }

  openInternal(page: InternalPage, hash = ""): void {
    const url = internalUrl(page, hash);
    const existing = this.tabs.find((t) => t.url.startsWith(`moon://${page}/`));
    if (existing) {
      this.activate(existing.id);
      if (hash) existing.load(url);
      return;
    }
    const active = this.activeTab;
    if (active && isNewTabUrl(active.url)) active.load(url);
    else this.openTab({ url });
  }

  private cycle(step: number): void {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    if (i < 0 || this.tabs.length < 2) return;
    this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length].id);
  }

  private toggleBookmark(): void {
    const tab = this.activeTab;
    if (!tab || isNewTabUrl(tab.url) || tab.error) return;
    const profile = this.browser.profile;
    const existing = profile.bookmarkFor(tab.url);
    if (existing) profile.removeBookmark(existing.id);
    else profile.addBookmark(tab.url, tab.title, tab.favicon);
    this.browser.notifyInternal("bookmarks");
    this.browser.updateAllWindows();
  }

  private startSplit(otherId?: number): void {
    const active = this.activeTab;
    if (!active) return;
    let other = otherId !== undefined && otherId !== active.id ? this.tab(otherId) : undefined;
    if (!other) {
      other = new Tab(this, { url: NEWTAB_URL, openerId: active.id });
      this.insertTab(other, this.tabs.indexOf(active) + 1);
    }
    this.split = { leftId: active.id, rightId: other.id, ratio: 0.5 };
    this.activate(other.id, { focusPage: false });
    this.browser.saveSessionSoon();
  }

  command(cmd: UiCommand): void {
    const tab = this.activeTab;
    switch (cmd.type) {
      case "newTab":
        this.openTab();
        break;
      case "newWindow":
        this.browser.createWindow({});
        break;
      case "newPrivateWindow":
        this.browser.createWindow({ private: true });
        break;
      case "closeTab":
        tab?.close();
        break;
      case "reopenClosedTab":
        this.browser.reopenClosedTab(this);
        break;
      case "nextTab":
        this.cycle(1);
        break;
      case "previousTab":
        this.cycle(-1);
        break;
      case "selectTab": {
        const target = this.tabs[cmd.index];
        if (target) this.activate(target.id);
        break;
      }
      case "selectLastTab": {
        const last = this.tabs[this.tabs.length - 1];
        if (last) this.activate(last.id);
        break;
      }
      case "focusAddressBar":
        this.focusAddressBar();
        break;
      case "reload":
        tab?.reload();
        break;
      case "hardReload":
        tab?.reload(true);
        break;
      case "back":
        tab?.back();
        break;
      case "forward":
        tab?.forward();
        break;
      case "home":
        this.openUrl(this.browser.settings.homePage || NEWTAB_URL);
        break;
      case "find":
        this.win.webContents.focus();
        this.send({ type: "find" });
        break;
      case "findNext":
      case "findPrevious":
        if (this.findText) this.findInPage(this.findText, cmd.type === "findNext", true);
        else {
          this.win.webContents.focus();
          this.send({ type: "find" });
        }
        break;
      case "bookmark":
        this.toggleBookmark();
        break;
      case "openPage":
        this.openInternal(cmd.page);
        break;
      case "clearData":
        this.openInternal("settings", "privacy");
        break;
      case "zoomIn":
        tab?.zoomBy(1);
        break;
      case "zoomOut":
        tab?.zoomBy(-1);
        break;
      case "zoomReset":
        tab?.zoomBy(0);
        break;
      case "print":
        tab?.wc?.print();
        break;
      case "fullscreen":
        this.win.setFullScreen(!this.win.isFullScreen());
        break;
      case "devtools":
        if (tab?.wc) {
          if (tab.wc.isDevToolsOpened()) tab.wc.closeDevTools();
          else tab.wc.openDevTools({ mode: "detach" });
        }
        break;
      case "viewSource":
        if (tab && /^https?:/.test(tab.url))
          this.openTab({ url: `view-source:${tab.url}`, openerId: tab.id });
        break;
      case "toggleBookmarksBar":
        this.browser.updateSettings({ showBookmarksBar: !this.browser.settings.showBookmarksBar });
        break;
      case "quit":
        app.quit();
        break;
      case "installUpdate":
        this.browser.updater.install();
        break;
      case "makeDefaultBrowser":
        void this.browser.defaultBrowser.make();
        break;
      case "extensionPin":
        this.browser.extensions.setPinned(cmd.extensionId, cmd.pinned);
        break;
      case "extensionMenu":
        this.browser.extensions.showMenu(this, cmd.extensionId, cmd.x, cmd.y);
        break;
      case "sidePanelToggle":
        this.toggleSidePanel(cmd.extensionId);
        break;
      case "sidePanelClose":
        this.closeSidePanel();
        break;
      case "sidePanelWidth": {
        const [width] = this.win.getContentSize();
        this.sidePanelWidth = clampPanelWidth(cmd.width, contentArea(width, 0, this.insets).width);
        this.layout();
        this.update();
        break;
      }
      case "activate":
        this.activate(cmd.tabId);
        break;
      case "close":
        this.tab(cmd.tabId)?.close();
        break;
      case "move":
        this.moveTab(cmd.tabId, cmd.index);
        break;
      case "navigate": {
        const result = resolveInput(cmd.input, {
          engine: this.browser.engine(),
          bangs: this.browser.settings.bangs,
        });
        if (result) this.openUrl(result.url, cmd.disposition, { typed: result.kind === "url" });
        break;
      }
      case "openUrl":
        if (isOpenableUrl(cmd.url)) this.openUrl(cmd.url, cmd.disposition);
        break;
      case "stop":
        tab?.stop();
        break;
      case "tabMenu":
        this.showTabMenu(cmd.tabId, cmd.x, cmd.y);
        break;
      case "bookmarkMenu":
        this.showBookmarkMenu(cmd.id, cmd.x, cmd.y);
        break;
      case "toggleMute":
        this.tab(cmd.tabId)?.toggleMute();
        break;
      case "respondPrompt":
        this.browser.permissions.respond(cmd.id, cmd.allow, cmd.remember);
        break;
      case "findInPage":
        this.findInPage(cmd.text, cmd.forward, cmd.findNext);
        break;
      case "stopFind":
        this.stopFind();
        tab?.focus();
        break;
      case "toggleProtection":
        if (tab) this.browser.toggleProtection(tab);
        break;
      case "split":
        this.startSplit(cmd.tabId);
        break;
      case "unsplit":
        this.split = null;
        this.layout();
        this.update();
        this.browser.saveSessionSoon();
        break;
      case "splitRatio":
        if (this.split) {
          this.split = { ...this.split, ratio: clampRatio(cmd.ratio) };
          this.layout();
          this.update();
        }
        break;
      case "download":
        this.browser.downloads.action(cmd.id, cmd.action);
        break;
      case "proceed":
        this.tab(cmd.tabId)?.proceed();
        break;
      case "focusPage":
        tab?.focus();
        break;
      case "insets": {
        const top = Math.max(0, Math.min(400, Math.round(cmd.top)));
        const bottom = Math.max(0, Math.min(400, Math.round(cmd.bottom)));
        if (top !== this.insets.top || bottom !== this.insets.bottom) {
          this.insets = { ...this.insets, top, bottom };
          this.layout();
        }
        break;
      }
    }
  }

  // ---- Native menus ----

  private popup(template: MenuItemConstructorOptions[], x: number, y: number): void {
    Menu.buildFromTemplate(template).popup({
      window: this.win,
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  private showTabMenu(id: number, x: number, y: number): void {
    const tab = this.tab(id);
    if (!tab) return;
    const index = this.tabs.indexOf(tab);
    const inSplit = !!this.split && (this.split.leftId === id || this.split.rightId === id);
    const closeMany = (tabs: Tab[]) =>
      tabs.filter((t) => !t.pinned || t === tab).forEach((t) => t.close());
    this.popup(
      [
        { label: "New tab to the right", click: () => this.openTab({ index: index + 1 }) },
        { type: "separator" },
        { label: "Reload", click: () => tab.reload() },
        { label: "Duplicate", click: () => this.openTab({ url: tab.url, index: index + 1 }) },
        { label: tab.pinned ? "Unpin" : "Pin", click: () => this.togglePin(tab) },
        { label: tab.muted ? "Unmute site" : "Mute site", click: () => tab.toggleMute() },
        {
          label: "Copy link",
          enabled: !isNewTabUrl(tab.url),
          click: () => void clipboard.writeText(tab.url),
        },
        inSplit
          ? { label: "Close split view", click: () => this.command({ type: "unsplit" }) }
          : {
              label: "Open in split view",
              enabled: tab.id !== this.activeId,
              click: () => this.startSplit(tab.id),
            },
        {
          label: "Put to sleep",
          enabled: !tab.sleeping && !this.visibleTabs().includes(tab),
          click: () => tab.sleep(),
        },
        { type: "separator" },
        { label: "Close", accelerator: "CmdOrCtrl+W", click: () => tab.close() },
        {
          label: "Close other tabs",
          enabled: this.tabs.length > 1,
          click: () => closeMany(this.tabs.filter((t) => t !== tab)),
        },
        {
          label: "Close tabs to the left",
          enabled: index > 0,
          click: () => closeMany(this.tabs.slice(0, index)),
        },
        {
          label: "Close tabs to the right",
          enabled: index < this.tabs.length - 1,
          click: () => closeMany(this.tabs.slice(index + 1)),
        },
        { type: "separator" },
        {
          label: "Reopen closed tab",
          accelerator: "CmdOrCtrl+Shift+T",
          enabled: this.browser.hasClosedTabs(),
          click: () => this.browser.reopenClosedTab(this),
        },
      ],
      x,
      y,
    );
  }

  private showBookmarkMenu(id: string, x: number, y: number): void {
    const profile = this.browser.profile;
    const bookmark = profile.bookmarks.get().find((b) => b.id === id);
    if (!bookmark) return;
    this.popup(
      [
        { label: "Open in new tab", click: () => this.openUrl(bookmark.url, "background") },
        { label: "Open in new window", click: () => this.openUrl(bookmark.url, "window") },
        { label: "Open in private window", click: () => this.openUrl(bookmark.url, "private") },
        { type: "separator" },
        { label: "Copy link", click: () => void clipboard.writeText(bookmark.url) },
        { label: "Edit bookmarks…", click: () => this.openInternal("bookmarks") },
        {
          label: "Delete",
          click: () => {
            profile.removeBookmark(id);
            this.browser.notifyInternal("bookmarks");
            this.browser.updateAllWindows();
          },
        },
      ],
      x,
      y,
    );
  }
}
