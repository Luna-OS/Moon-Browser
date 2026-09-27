/**
 * The main-process side of src/preload/extension-apis.ts: chrome.sidePanel,
 * chrome.identity, chrome.search and chrome.debugger for extensions.
 *
 * The calling extension is always taken from where the call comes from —
 * the origin of the frame or the scope of the service worker — never from
 * the message, and each API needs the permission its manifest declares.
 */
import {
  BrowserWindow,
  ipcMain,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type ServiceWorkerMain,
  type Session,
  type WebContents,
} from "electron";
import { searchUrl } from "@shared/engines";
import { isInternalUrl } from "@shared/internal";
import { isGroupColor, type TabGroupInfo } from "@shared/tab-groups";
import type { Browser } from "./browser";
import type { Tab } from "./tab";
import type { MoonWindow } from "./window";

/** A group as chrome.tabGroups describes it. */
export function groupInfo(win: MoonWindow, group: TabGroupInfo) {
  return { ...group, windowId: win.win.id };
}

const CALL = "moon-ext:call";
const EVENT = "moon-ext:event";
const SUBSCRIBE = "moon-ext:subscribe";

/** The permission each API needs. */
const PERMISSION: Record<string, string> = {
  sidePanel: "sidePanel",
  identity: "identity",
  search: "search",
  debugger: "debugger",
  tabGroups: "tabGroups",
  // chrome.tabs.group/ungroup need no permission, as in Chrome.
  tabs: "",
  // Either of its two permissions; checked in call().
  declarativeNetRequest: "",
  proxy: "proxy",
};

/** How long an event waits for an extension to start listening (runtime.onInstalled, …). */
const PENDING_EVENT_TTL = 60_000;

type Host = { kind: "frame"; wc: WebContents } | { kind: "worker"; worker: ServiceWorkerMain };

export function extensionIdOf(url: string): string | null {
  const m = /^chrome-extension:\/\/([a-p]{32})(\/|$)/.exec(url);
  return m ? m[1] : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export class ExtensionApis {
  /** extension ID → event name → who listens. */
  private readonly listeners = new Map<string, Map<string, Set<Host>>>();
  private readonly workers = new WeakSet<ServiceWorkerMain>();
  /** Pages an extension debugs: webContents id → extension ID. */
  private readonly debuggees = new Map<number, string>();
  /**
   * Events for workers that are still starting (running their script):
   * messages sent to them then are lost, so they wait until the worker runs.
   */
  private readonly starting = new Map<number, [string, unknown[]][]>();
  /** Events waiting for the extension to listen: extension ID → event name → arguments. */
  private readonly pending = new Map<string, Map<string, { args: unknown[]; until: number }>>();

  constructor(
    private readonly browser: Browser,
    private readonly ses: Session,
  ) {}

  install(): void {
    ipcMain.handle(CALL, (event, name: unknown, ...args: unknown[]) => {
      const id = this.frameExtension(event);
      if (!id || typeof name !== "string") throw new Error("Not an extension");
      return this.call(id, name, args);
    });
    ipcMain.on(SUBSCRIBE, (event, name: unknown) => {
      const id = this.frameExtension(event);
      if (id && typeof name === "string")
        this.subscribe(id, name, { kind: "frame", wc: event.sender });
    });
    // Service workers talk through their own IPC; hook each extension worker
    // as it starts (before its script runs).
    this.ses.serviceWorkers.on("running-status-changed", ({ versionId, runningStatus }) => {
      if (runningStatus === "running") {
        const queued = this.starting.get(versionId);
        this.starting.delete(versionId);
        const running = this.ses.serviceWorkers.getWorkerFromVersionID(versionId);
        for (const [name, args] of queued ?? []) running?.send(EVENT, name, ...args);
        return;
      }
      if (runningStatus !== "starting") {
        this.starting.delete(versionId);
        return;
      }
      this.starting.set(versionId, []);
      const worker = this.ses.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = worker ? extensionIdOf(worker.scope) : null;
      if (!worker || !id || this.workers.has(worker)) return;
      this.workers.add(worker);
      worker.ipc.handle(CALL, (_event, name: unknown, ...args: unknown[]) => {
        if (typeof name !== "string") throw new Error("Bad call");
        return this.call(id, name, args);
      });
      worker.ipc.on(SUBSCRIBE, (_event, name: unknown) => {
        if (typeof name === "string") this.subscribe(id, name, { kind: "worker", worker });
      });
    });
  }

  private frameExtension(event: IpcMainInvokeEvent | IpcMainEvent): string | null {
    if (event.sender.session !== this.ses) return null;
    const frame = event.senderFrame;
    const id = frame ? extensionIdOf(`${frame.origin}/`) : null;
    return id && this.ses.extensions.getExtension(id) ? id : null;
  }

  private subscribe(id: string, name: string, host: Host): void {
    let events = this.listeners.get(id);
    if (!events) this.listeners.set(id, (events = new Map<string, Set<Host>>()));
    let hosts = events.get(name);
    if (!hosts) events.set(name, (hosts = new Set<Host>()));
    for (const h of hosts) {
      if (
        h.kind === host.kind &&
        (h.kind === "frame"
          ? h.wc === (host as { wc: WebContents }).wc
          : h.worker === (host as { worker: ServiceWorkerMain }).worker)
      )
        return;
    }
    hosts.add(host);
    const waiting = this.pending.get(id)?.get(name);
    if (waiting) {
      this.pending.get(id)?.delete(name);
      if (waiting.until > Date.now()) this.emit(id, name, ...waiting.args);
    }
  }

  /**
   * Delivers an event now if the extension listens for it, or else as soon
   * as it starts listening (its service worker starting up) within a minute.
   */
  emitSoon(id: string, name: string, ...args: unknown[]): void {
    if (this.listeners.get(id)?.get(name)?.size) {
      this.emit(id, name, ...args);
      return;
    }
    let events = this.pending.get(id);
    if (!events)
      this.pending.set(id, (events = new Map<string, { args: unknown[]; until: number }>()));
    events.set(name, { args, until: Date.now() + PENDING_EVENT_TTL });
  }

  /** Delivers an event to every extension that listens for it and may see it. */
  emitAll(name: string, permission: string, ...args: unknown[]): void {
    for (const [id, events] of this.listeners) {
      if (events.get(name)?.size && this.browser.extensions.declares(id, permission))
        this.emit(id, name, ...args);
    }
  }

  /** Delivers an event to an extension's pages and worker that listen for it. */
  emit(id: string, name: string, ...args: unknown[]): void {
    const hosts = this.listeners.get(id)?.get(name);
    if (!hosts) return;
    for (const host of [...hosts]) {
      try {
        if (host.kind === "frame") {
          if (host.wc.isDestroyed()) hosts.delete(host);
          else host.wc.send(EVENT, name, ...args);
        } else if (host.worker.isDestroyed()) {
          hosts.delete(host);
        } else {
          const queued = this.starting.get(host.worker.versionId);
          if (queued) queued.push([name, args]);
          else host.worker.send(EVENT, name, ...args);
        }
      } catch {
        hosts.delete(host);
      }
    }
  }

  private async call(id: string, name: string, args: unknown[]): Promise<unknown> {
    const namespace = name.split(".")[0];
    const permission = PERMISSION[namespace];
    if (
      permission === undefined ||
      (permission && !this.browser.extensions.declares(id, permission))
    )
      throw new Error(`chrome.${name} needs the "${permission ?? namespace}" permission`);
    if (namespace === "proxy")
      return this.browser.extensions.proxy.call(id, name.slice(6), args[0]);
    if (namespace === "declarativeNetRequest") {
      const ext = this.browser.extensions;
      if (
        !ext.declares(id, "declarativeNetRequest") &&
        !ext.declares(id, "declarativeNetRequestWithHostAccess")
      )
        throw new Error(`chrome.${name} needs the "declarativeNetRequest" permission`);
      return ext.dnr.call(id, name.slice("declarativeNetRequest.".length), args[0]);
    }
    const [a, b, c] = args;
    const ext = this.browser.extensions;
    switch (name) {
      case "sidePanel.setPanelBehavior":
        ext.setPanelBehavior(id, isObj(a) && a.openPanelOnActionClick === true);
        return undefined;
      case "sidePanel.getPanelBehavior":
        return { openPanelOnActionClick: ext.panelBehavior(id) };
      case "sidePanel.setOptions":
        if (isObj(a))
          ext.setPanelOptions(id, {
            tabId: num(a.tabId),
            path: typeof a.path === "string" ? a.path : undefined,
            enabled: typeof a.enabled === "boolean" ? a.enabled : undefined,
          });
        return undefined;
      case "sidePanel.getOptions":
        return ext.panelOptions(id, isObj(a) ? num(a.tabId) : undefined);
      case "sidePanel.open": {
        const win = this.targetWindow(a);
        if (!win) throw new Error("No window to open the side panel in");
        if (!win.openSidePanel(id)) throw new Error("This extension has no side panel");
        return undefined;
      }
      case "sidePanel.close": {
        this.targetWindow(a)?.closeSidePanel(id);
        return undefined;
      }
      case "identity.launchWebAuthFlow":
        return this.webAuthFlow(id, a);
      case "search.query":
        return this.search(a);
      case "debugger.attach":
        return this.debuggerAttach(id, a, b);
      case "debugger.detach":
        return this.debuggerDetach(id, a);
      case "debugger.sendCommand":
        return this.debuggerSend(id, a, b, c);
      case "debugger.getTargets":
        return this.debuggerTargets();
      case "tabGroups.query":
        return this.groupQuery(a);
      case "tabGroups.get": {
        const found = this.findGroup(a);
        if (!found) throw new Error(`No group with id: ${String(a)}.`);
        return groupInfo(found.win, found.group);
      }
      case "tabGroups.update": {
        const found = this.findGroup(a);
        if (!found) throw new Error(`No group with id: ${String(a)}.`);
        const p = isObj(b) ? b : {};
        const group = found.win.updateGroup(found.group.id, {
          title: typeof p.title === "string" ? p.title : undefined,
          color: isGroupColor(p.color) ? p.color : undefined,
          collapsed: typeof p.collapsed === "boolean" ? p.collapsed : undefined,
        });
        return group ? groupInfo(found.win, group) : undefined;
      }
      case "tabs.group":
        return this.groupTabs(a);
      case "tabs.ungroup":
        for (const tab of this.tabsOf(a)) tab.window.ungroupTabs([tab]);
        return undefined;
      default:
        throw new Error(`chrome.${name} isn't available in Moon Browser`);
    }
  }

  /** The window an API call means: by windowId, by tabId, or the focused one. */
  private targetWindow(options: unknown): MoonWindow | undefined {
    const o = isObj(options) ? options : {};
    const windowId = num(o.windowId);
    const tabId = num(o.tabId);
    const normal = [...this.browser.windows].filter((w) => !w.isPrivate && !w.closed);
    if (windowId !== undefined) return normal.find((w) => w.win.id === windowId);
    if (tabId !== undefined) {
      const tab = this.browser.tabFor(tabId);
      return tab && !tab.window.isPrivate ? tab.window : undefined;
    }
    const focused = this.browser.focusedWindow();
    return focused && !focused.isPrivate ? focused : normal[0];
  }

  // ---- Tab groups ----

  private normalWindows(): MoonWindow[] {
    return [...this.browser.windows].filter((w) => !w.isPrivate && !w.closed);
  }

  private findGroup(id: unknown): { win: MoonWindow; group: TabGroupInfo } | undefined {
    for (const win of this.normalWindows()) {
      const group = win.groups.find((g) => g.id === id);
      if (group) return { win, group };
    }
    return undefined;
  }

  private groupQuery(query: unknown): unknown[] {
    const q = isObj(query) ? query : {};
    return this.normalWindows()
      .filter((w) => q.windowId === undefined || w.win.id === q.windowId)
      .flatMap((w) => w.groups.map((g) => groupInfo(w, g)))
      .filter(
        (g) =>
          (q.title === undefined || g.title === q.title) &&
          (q.color === undefined || g.color === q.color) &&
          (q.collapsed === undefined || g.collapsed === q.collapsed),
      );
  }

  /** Tabs by their extension IDs (webContents ids), normal windows only. */
  private tabsOf(ids: unknown): Tab[] {
    const list = Array.isArray(ids) ? ids : [ids];
    return list
      .map((id) => (typeof id === "number" ? this.browser.tabFor(id) : undefined))
      .filter((t): t is Tab => !!t && !t.window.isPrivate);
  }

  private groupTabs(options: unknown): number {
    const o = isObj(options) ? options : {};
    const tabs = this.tabsOf(o.tabIds);
    if (!tabs.length) throw new Error("No tabs to group");
    const groupId = num(o.groupId);
    const target = groupId !== undefined ? this.findGroup(groupId) : undefined;
    if (groupId !== undefined && !target) throw new Error(`No group with id: ${groupId}.`);
    const win = target?.win ?? tabs[0].window;
    if (tabs.some((t) => t.window !== win))
      throw new Error("Tabs from different windows can't be grouped here");
    return win.groupTabs(tabs, groupId);
  }

  // ---- identity.launchWebAuthFlow ----

  /**
   * Opens the sign-in page in a window of its own (with the browser's cookies,
   * like Chrome) and resolves with the address the provider redirects to on
   * https://<extension-id>.chromiumapp.org/ — which is never loaded.
   */
  private webAuthFlow(id: string, details: unknown): Promise<string> {
    const d = isObj(details) ? details : {};
    const url = typeof d.url === "string" ? d.url : "";
    if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error("Invalid authorization URL"));
    const interactive = d.interactive === true;
    const redirect = `https://${id}.chromiumapp.org/`;
    const parent = this.browser.focusedWindow()?.win;
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        width: 520,
        height: 700,
        show: false,
        parent,
        title: "Sign in",
        autoHideMenuBar: true,
        webPreferences: {
          session: this.ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
        },
      });
      win.setMenu(null);
      let done = false;
      const finish = (settle: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!win.isDestroyed()) win.destroy();
        settle();
      };
      const caught = (target: string) => {
        if (!target.startsWith(redirect)) return false;
        finish(() => resolve(target));
        return true;
      };
      const wc = win.webContents;
      wc.on("will-redirect", (event) => {
        if (caught(event.url)) event.preventDefault();
      });
      wc.on("will-navigate", (event) => {
        if (caught(event.url)) event.preventDefault();
      });
      wc.setWindowOpenHandler(({ url: target }) => {
        caught(target);
        return { action: "deny" };
      });
      wc.on("did-finish-load", () => {
        if (!done && interactive && !win.isDestroyed()) win.show();
      });
      win.on("closed", () => finish(() => reject(new Error("The user did not approve access."))));
      // Without interaction the provider must answer right away.
      const timer = setTimeout(
        () => finish(() => reject(new Error("User interaction required."))),
        interactive ? 30 * 60_000 : 15_000,
      );
      wc.loadURL(url).catch(() => undefined);
    });
  }

  // ---- search.query ----

  private search(details: unknown): void {
    const d = isObj(details) ? details : {};
    if (typeof d.text !== "string" || !d.text.trim()) throw new Error("Nothing to search for");
    const url = searchUrl(this.browser.engine(), d.text.slice(0, 2048));
    const tabId = num(d.tabId);
    const win = this.targetWindow(tabId !== undefined ? { tabId } : {});
    if (d.disposition === "NEW_WINDOW") this.browser.createWindow({ urls: [url] });
    else if (d.disposition === "NEW_TAB" || !win) (win ?? this.targetWindow({}))?.openTab({ url });
    else
      ((tabId !== undefined ? this.browser.tabFor(tabId) : win.activeTab) ?? win.activeTab)?.load(
        url,
      );
  }

  // ---- debugger ----

  /** A tab an extension may debug: a normal web page, never Moon Browser's own pages. */
  private debuggable(target: unknown): WebContents {
    const tabId = isObj(target) ? num(target.tabId) : undefined;
    const tab = tabId !== undefined ? this.browser.tabFor(tabId) : undefined;
    const wc = tab?.wc;
    if (!tab || !wc || tab.window.isPrivate) throw new Error("No tab with this ID");
    if (isInternalUrl(wc.getURL())) throw new Error("Cannot access a Moon Browser page");
    return wc;
  }

  private debuggerAttach(id: string, target: unknown, version: unknown): void {
    const wc = this.debuggable(target);
    const owner = this.debuggees.get(wc.id);
    if (owner)
      throw new Error(`Another debugger is already attached to the tab with id: ${wc.id}.`);
    wc.debugger.attach(typeof version === "string" ? version : "1.3");
    this.debuggees.set(wc.id, id);
    const source = { tabId: wc.id };
    const onMessage = (_event: Electron.Event, method: string, params: unknown) =>
      this.emit(id, "debugger.onEvent", source, method, params);
    const onDetach = (_event: Electron.Event, reason: string) => {
      cleanup();
      this.emit(
        id,
        "debugger.onDetach",
        source,
        reason === "target closed" ? "target_closed" : "canceled_by_user",
      );
    };
    // Moon Browser's own pages are never debugged: leaving for one ends it.
    const onNavigate = (event: { url: string; isMainFrame: boolean }) => {
      if (event.isMainFrame && isInternalUrl(event.url) && wc.debugger.isAttached())
        wc.debugger.detach();
    };
    const cleanup = () => {
      this.debuggees.delete(wc.id);
      wc.debugger.off("message", onMessage);
      wc.debugger.off("detach", onDetach);
      wc.off("did-start-navigation", onNavigate);
    };
    wc.debugger.on("message", onMessage);
    wc.debugger.on("detach", onDetach);
    wc.on("did-start-navigation", onNavigate);
  }

  private debuggerDetach(id: string, target: unknown): void {
    const tabId = isObj(target) ? num(target.tabId) : undefined;
    const wc = tabId !== undefined ? webContents.fromId(tabId) : undefined;
    if (!wc || this.debuggees.get(wc.id) !== id) throw new Error("Debugger is not attached");
    if (wc.debugger.isAttached()) wc.debugger.detach();
  }

  private debuggerSend(
    id: string,
    target: unknown,
    method: unknown,
    params: unknown,
  ): Promise<unknown> {
    const tabId = isObj(target) ? num(target.tabId) : undefined;
    const wc = tabId !== undefined ? webContents.fromId(tabId) : undefined;
    if (!wc || this.debuggees.get(wc.id) !== id || typeof method !== "string")
      throw new Error("Debugger is not attached to the tab");
    return wc.debugger.sendCommand(method, isObj(params) ? params : undefined);
  }

  private debuggerTargets(): unknown[] {
    return this.browser
      .allTabs()
      .filter((t) => !t.window.isPrivate && t.wc && !isInternalUrl(t.url))
      .map((t) => ({
        type: "page",
        id: String(t.wc!.id),
        tabId: t.wc!.id,
        title: t.title,
        url: t.url,
        attached: this.debuggees.has(t.wc!.id),
        faviconUrl: t.favicon ?? undefined,
      }));
  }
}
