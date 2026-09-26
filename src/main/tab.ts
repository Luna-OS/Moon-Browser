/**
 * One tab: a page in a WebContentsView, or — while asleep — just its
 * address, title and back/forward history, ready to wake up.
 */
import { dialog, WebContentsView, type NavigationEntry, type WebContents } from "electron";
import { shouldFallBackToHttp } from "@shared/https";
import { isInternalUrl, isNewTabUrl, NEWTAB_URL } from "@shared/internal";
import { displayUrl } from "@shared/display";
import { shortcutFor } from "@shared/shortcuts";
import { originOf } from "@shared/sites";
import type { SecurityState, TabError, TabInfo } from "@shared/types";
import { showPageMenu } from "./context-menu";
import type { SavedTab } from "./profile";
import type { MoonWindow } from "./window";

const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
const GESTURE_WINDOW = 5_000;

export interface TabInit {
  url?: string;
  title?: string;
  pinned?: boolean;
  openerId?: number | null;
  /** Adopt a page the opener created (window.open, target=_blank). */
  webContents?: WebContents;
  /** Start asleep: the page loads when the tab is first shown. */
  sleeping?: boolean;
  history?: { entries: NavigationEntry[]; index: number } | null;
  referrer?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Chromium lists candidate icons; prefer real image URLs. */
function pickFavicon(favicons: string[]): string | null {
  return favicons.find((f) => /^(https?:|data:image\/)/i.test(f)) ?? null;
}

/** Addresses a page may open or navigate to by itself. */
/** The extension ID of a chrome-extension: URL (URL.origin is "null" for those). */
function extensionHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "chrome-extension:" ? u.host : null;
  } catch {
    return null;
  }
}

function isOpenable(url: string, from: string): boolean {
  if (/^(https?|about|blob|data):/i.test(url))
    return !/^data:/i.test(url) || /^data:image\//i.test(url);
  if (isInternalUrl(url)) return isInternalUrl(from);
  // An extension's own pages may open more of its pages.
  if (/^chrome-extension:/i.test(url))
    return extensionHost(url) !== null && extensionHost(url) === extensionHost(from);
  return false;
}

export class Tab {
  private static nextId = 1;
  readonly id = Tab.nextId++;
  view: WebContentsView | null = null;
  /** The page of `view`. Kept separately: a view forgets its page once it is destroyed. */
  private contents: WebContents | null = null;
  private contentsId = -1;
  url: string;
  title: string;
  favicon: string | null = null;
  pinned: boolean;
  muted = false;
  audible = false;
  loading = false;
  crashed = false;
  error: TabError | null = null;
  blocked = 0;
  lastActive = Date.now();
  openerId: number | null;
  private lastGesture = 0;
  private typed = false;
  private closing = false;
  private dialogOpen = false;
  /** Set by the request pipeline when it stops a page on purpose. */
  private pendingError: TabError | null = null;
  private history: { entries: NavigationEntry[]; index: number } | null;

  constructor(
    public window: MoonWindow,
    init: TabInit = {},
  ) {
    this.url = init.url ?? NEWTAB_URL;
    this.title = init.title ?? "";
    this.pinned = init.pinned ?? false;
    this.openerId = init.openerId ?? null;
    this.history = init.history ?? null;
    if (init.webContents) {
      this.createView(init.webContents);
    } else if (!init.sleeping) {
      this.createView();
      this.startLoad(init.referrer);
    }
  }

  private get browser() {
    return this.window.browser;
  }

  get wc(): WebContents | null {
    const wc = this.contents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  get sleeping(): boolean {
    return this.view === null;
  }

  // ---- Life cycle ----

  private createView(existing?: WebContents): void {
    const view = existing
      ? new WebContentsView({ webContents: existing })
      : new WebContentsView({ webPreferences: this.window.tabPreferences() });
    this.view = view;
    view.setBackgroundColor("#ffffff");
    const wc = view.webContents;
    this.contents = wc;
    this.contentsId = wc.id;
    this.browser.registerTab(wc.id, this);
    this.browser.extensions.addTab(wc, this.window);
    wc.setAudioMuted(this.muted);
    wc.setWebRTCIPHandlingPolicy(
      this.browser.settings.webrtcProtection ? "default_public_interface_only" : "default",
    );
    this.wire(wc);
  }

  private startLoad(referrer?: string): void {
    const wc = this.wc;
    if (!wc) return;
    const history = this.history;
    this.history = null;
    if (history && history.entries.length) {
      wc.navigationHistory.restore(history).catch(() => undefined);
    } else {
      wc.loadURL(this.url, referrer ? { httpReferrer: referrer } : undefined).catch(
        () => undefined,
      );
    }
  }

  /** Wakes a sleeping tab. */
  wake(): void {
    if (this.view || this.closing) return;
    this.createView();
    this.startLoad();
    this.changed();
  }

  /** Frees the page's memory; the tab keeps its address and history. */
  sleep(): void {
    const wc = this.wc;
    if (!wc || this.closing) return;
    const nav = wc.navigationHistory;
    const entries = nav.getAllEntries().filter((e) => !!e.url);
    this.history = entries.length
      ? { entries, index: Math.max(0, Math.min(entries.length - 1, nav.getActiveIndex())) }
      : null;
    this.destroyView();
    this.loading = false;
    this.audible = false;
    this.changed();
  }

  private destroyView(): void {
    const view = this.view;
    const wc = this.contents;
    this.view = null;
    this.contents = null;
    if (view) this.window.detach(view);
    this.browser.unregisterTab(this.contentsId);
    if (wc) this.browser.extensions.removeTab(wc);
    if (wc && !wc.isDestroyed()) wc.close();
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.browser.rememberClosed(this);
    const wc = this.wc;
    if (!wc || this.crashed) {
      this.finishClose();
      return;
    }
    wc.close({ waitForBeforeUnload: true });
    // A page stuck in "beforeunload" must not keep its tab open forever.
    setTimeout(() => {
      if (this.closing && !this.dialogOpen) this.finishClose();
    }, 2_500);
  }

  private finishClose(): void {
    this.window.removeTab(this);
    this.destroyView();
  }

  // ---- Navigation ----

  load(url: string, options: { typed?: boolean } = {}): void {
    this.typed = options.typed ?? false;
    this.error = null;
    if (!this.view) {
      this.url = url;
      this.history = null;
      this.wake();
      return;
    }
    this.wc?.loadURL(url).catch(() => undefined);
  }

  reload(ignoreCache = false): void {
    const wc = this.wc;
    if (!wc) return this.wake();
    if (this.error && !wc.getURL()) {
      this.load(this.error.url);
      return;
    }
    this.crashed = false;
    this.error = null;
    if (ignoreCache) wc.reloadIgnoringCache();
    else wc.reload();
    this.changed();
  }

  back(): void {
    if (this.wc?.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack();
  }

  forward(): void {
    if (this.wc?.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward();
  }

  stop(): void {
    this.wc?.stop();
  }

  /** The request pipeline stopped the next page load: show why. */
  failNext(error: TabError): void {
    this.pendingError = error;
  }

  /**
   * Continue past a warning after the user chose to: over HTTP for a site
   * without HTTPS, or to a page Moon Shield blocked. Remembered until the
   * browser closes.
   */
  proceed(): void {
    const error = this.error;
    if (!error || error.kind === "network") return;
    const host = hostOf(error.url);
    if (error.kind === "https") this.browser.httpsExceptions.add(host);
    else this.browser.shieldExceptions.add(host);
    this.load(error.url);
  }

  focus(): void {
    this.wc?.focus();
  }

  // ---- Page state ----

  toggleMute(): void {
    this.muted = !this.muted;
    this.wc?.setAudioMuted(this.muted);
    this.changed();
  }

  zoomBy(direction: 1 | -1 | 0): void {
    const wc = this.wc;
    if (!wc) return;
    const current = Math.round(wc.getZoomFactor() * 100);
    let next = 100;
    if (direction === 1)
      next = ZOOM_STEPS.find((z) => z > current) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    if (direction === -1)
      next = [...ZOOM_STEPS].reverse().find((z) => z < current) ?? ZOOM_STEPS[0];
    wc.setZoomFactor(next / 100);
    const host = hostOf(this.url);
    if (host && !this.window.isPrivate) {
      const zoom = this.browser.profile.zoom.get();
      if (next === 100) delete zoom[host];
      else zoom[host] = next;
      this.browser.profile.zoom.changed();
    }
    // Chromium applies zoom per site, so other tabs of the site changed too.
    this.browser.updateAllWindows();
  }

  private applySavedZoom(): void {
    const wc = this.wc;
    if (!wc) return;
    const saved = this.window.isPrivate
      ? undefined
      : this.browser.profile.zoom.get()[hostOf(this.url)];
    const factor = (saved ?? 100) / 100;
    if (Math.abs(wc.getZoomFactor() - factor) > 0.001) wc.setZoomFactor(factor);
  }

  countBlocked(): void {
    this.blocked++;
    if (!this.window.isPrivate) this.browser.profile.addBlocked(1);
    this.changedSoon();
  }

  hadRecentGesture(): boolean {
    return Date.now() - this.lastGesture < GESTURE_WINDOW;
  }

  private security(): SecurityState {
    if (this.error) return "error";
    if (isInternalUrl(this.url)) return "internal";
    if (this.url.startsWith("chrome-extension:")) return "extension";
    if (this.url.startsWith("https:")) return "secure";
    if (this.url.startsWith("file:")) return "local";
    if (this.url.startsWith("http:")) {
      const host = hostOf(this.url);
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
        ? "local"
        : "insecure";
    }
    return "internal";
  }

  info(): TabInfo {
    const wc = this.wc;
    const nav = wc?.navigationHistory;
    const fallbackTitle = isNewTabUrl(this.url) ? "New tab" : displayUrl(this.url) || "Untitled";
    return {
      id: this.id,
      url: this.url,
      title: this.title || fallbackTitle,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: nav ? nav.canGoBack() : !!this.history && this.history.index > 0,
      canGoForward: nav ? nav.canGoForward() : false,
      audible: this.audible,
      muted: this.muted,
      pinned: this.pinned,
      sleeping: this.sleeping,
      crashed: this.crashed,
      blocked: this.blocked,
      security: this.security(),
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
      error: this.error,
    };
  }

  saved(): SavedTab {
    const wc = this.wc;
    let entries: { url: string; title: string }[] | undefined;
    let index: number | undefined;
    if (wc) {
      const all = wc.navigationHistory.getAllEntries();
      entries = all
        .map((e) => ({ url: e.url, title: e.title }))
        .filter((e) => /^(https?|file|moon):/.test(e.url));
      index = Math.min(entries.length - 1, wc.navigationHistory.getActiveIndex());
    } else if (this.history) {
      entries = this.history.entries.map((e) => ({ url: e.url, title: e.title }));
      index = this.history.index;
    }
    if (entries && entries.length > 50) {
      const drop = entries.length - 50;
      entries = entries.slice(drop);
      index = Math.max(0, (index ?? 0) - drop);
    }
    return { url: this.url, title: this.title, pinned: this.pinned, entries, index };
  }

  private changed(): void {
    this.window.update();
  }

  private changedSoon(): void {
    this.window.updateSoon();
  }

  // ---- Events of the page ----

  private wire(wc: WebContents): void {
    const browser = this.browser;

    wc.on("did-start-loading", () => {
      this.loading = true;
      this.changed();
    });
    wc.on("did-stop-loading", () => {
      this.loading = false;
      this.changed();
    });
    wc.on("did-start-navigation", (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      if (this.error || this.crashed) {
        this.error = null;
        this.crashed = false;
        this.changed();
      }
    });
    wc.on("did-navigate", (_event, url) => {
      if (this.error && url === this.error.url) return;
      this.url = url;
      this.blocked = 0;
      browser.permissions.cancelTab(this.id);
      browser.upgraded.delete(this.id);
      this.window.onTabNavigated(this);
      this.applySavedZoom();
      this.recordVisit();
      this.changed();
    });
    wc.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.recordVisit();
      this.changed();
    });
    wc.on("page-title-updated", (_event, title) => {
      this.title = title;
      if (!this.window.isPrivate) browser.profile.updateHistory(this.url, { title });
      this.changed();
    });
    wc.on("page-favicon-updated", (_event, favicons) => {
      const icon = pickFavicon(favicons);
      if (icon === this.favicon) return;
      this.favicon = icon;
      if (!this.window.isPrivate && icon)
        browser.profile.updateHistory(this.url, { favicon: icon });
      this.changed();
    });
    wc.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      const pending = this.pendingError;
      this.pendingError = null;
      // -3 is "aborted": the user stopped it or a new navigation replaced it.
      if (!pending && code === -3) return;
      const upgraded = browser.upgraded.get(this.id);
      const httpsUnavailable =
        !!upgraded &&
        validatedURL.startsWith("https:") &&
        hostOf(validatedURL) === upgraded.host &&
        shouldFallBackToHttp(code);
      this.error =
        pending ??
        (httpsUnavailable
          ? { kind: "https", code, description, url: validatedURL.replace(/^https:/, "http:") }
          : { kind: "network", code, description, url: validatedURL });
      this.url = this.error.url;
      this.loading = false;
      browser.upgraded.delete(this.id);
      this.window.layout();
      this.changed();
    });
    wc.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") return;
      this.crashed = true;
      this.loading = false;
      this.audible = false;
      this.window.layout();
      this.changed();
    });
    wc.on("audio-state-changed", (event) => {
      this.audible = event.audible;
      this.changed();
    });
    wc.on("found-in-page", (_event, result) => this.window.onFound(this, result));
    wc.on("context-menu", (_event, params) => showPageMenu(this, params));
    wc.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" || input.type === "rawKeyDown") this.lastGesture = Date.now();
      const command = shortcutFor(input, process.platform);
      if (command) {
        event.preventDefault();
        this.window.command(command);
      }
    });
    wc.on("input-event", (_event, input) => {
      if (
        input.type === "mouseDown" ||
        input.type === "touchStart" ||
        input.type === "gestureTap"
      ) {
        this.lastGesture = Date.now();
      }
    });
    wc.on("focus", () => this.window.onTabFocused(this));
    wc.on("enter-html-full-screen", () => this.window.setHtmlFullscreen(this, true));
    wc.on("leave-html-full-screen", () => this.window.setHtmlFullscreen(this, false));
    wc.on("zoom-changed", (_event, direction) => this.zoomBy(direction === "in" ? 1 : -1));
    // The page asks to confirm leaving. The close is held back (no
    // preventDefault) and asked about without blocking the whole browser;
    // "Leave" then closes the page without asking again.
    wc.on("will-prevent-unload", () => {
      if (!this.closing || this.dialogOpen) return;
      this.dialogOpen = true;
      void dialog
        .showMessageBox(this.window.win, {
          type: "question",
          buttons: ["Leave", "Stay"],
          defaultId: 1,
          cancelId: 1,
          title: "Leave site?",
          message: "Leave site?",
          detail: "Changes you made may not be saved.",
        })
        .then(({ response }) => {
          this.dialogOpen = false;
          if (response === 0) this.finishClose();
          else this.closing = false;
        });
    });
    wc.on("destroyed", () => {
      // Closed by the page (window.close()) or by close(): the tab goes too.
      // A tab that went to sleep has already let go of this page.
      if (this.contents !== wc) return;
      const view = this.view;
      this.view = null;
      this.contents = null;
      this.browser.unregisterTab(this.contentsId);
      if (view) this.window.detach(view);
      this.window.removeTab(this);
    });

    // Web pages may not navigate to Moon Browser's own pages.
    wc.on("will-frame-navigate", (details) => {
      if (!isInternalUrl(details.url)) return;
      let initiator = "";
      try {
        initiator = details.initiator?.url ?? "";
      } catch {
        initiator = "";
      }
      if (!isInternalUrl(initiator)) details.preventDefault();
    });
    wc.on("will-redirect", (details) => {
      if (isInternalUrl(details.url)) details.preventDefault();
    });

    wc.setWindowOpenHandler((details) => {
      const { url, disposition } = details;
      if (!isOpenable(url, this.url)) return { action: "deny" };
      if (disposition === "background-tab") {
        this.window.openTab({
          url,
          background: true,
          openerId: this.id,
          referrer: details.referrer.url || undefined,
        });
        return { action: "deny" };
      }
      if (
        disposition !== "foreground-tab" &&
        !this.hadRecentGesture() &&
        !browser.permissions.popupsAllowed(this, originOf(this.url))
      ) {
        browser.permissions.blockedPopup(this, url);
        return { action: "deny" };
      }
      return {
        action: "allow",
        outlivesOpener: true,
        createWindow: (options) => {
          const child = (options as { webContents?: WebContents }).webContents;
          const tab = child
            ? this.window.adoptTab(child, { openerId: this.id, url })
            : this.window.openTab({ url, openerId: this.id });
          return tab.wc!;
        },
      };
    });
  }

  private recordVisit(): void {
    if (this.window.isPrivate) return;
    this.browser.profile.recordVisit(this.url, this.title, this.typed);
    this.typed = false;
    this.browser.notifyInternal("history");
  }
}
