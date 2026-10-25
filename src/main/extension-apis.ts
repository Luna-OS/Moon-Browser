/**
 * The main-process side of src/preload/extension-apis.ts: chrome.sidePanel,
 * chrome.identity, chrome.search, chrome.debugger, chrome.downloads,
 * tabs.captureVisibleTab and native messaging for extensions.
 *
 * The calling extension is always taken from where the call comes from —
 * the origin of the frame or the scope of the service worker — never from
 * the message, and each API needs the permission its manifest declares.
 */
import {
  BrowserWindow,
  ipcMain,
  webContents,
  type DownloadItem,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type ServiceWorkerMain,
  type Session,
  type WebContents,
} from "electron";
import { searchUrl } from "@shared/engines";
import { hasSiteAccess } from "@shared/extensions";
import { safeFilename } from "@shared/security";
import { isInternalUrl } from "@shared/internal";
import { isGroupColor, type TabGroupInfo } from "@shared/tab-groups";
import type { Browser } from "./browser";
import { findHost, NativePort } from "./native-messaging";
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
  downloads: "downloads",
  native: "nativeMessaging",
};

/** How long runtime.sendNativeMessage waits for the host's answer. */
const SEND_TIMEOUT = 5 * 60_000;

interface ExtensionDownload {
  id: number;
  url: string;
  filename: string;
  state: "in_progress" | "interrupted" | "complete";
  item?: DownloadItem;
}

/** How long an event waits for an extension to start listening (runtime.onInstalled, …). */
const PENDING_EVENT_TTL = 60_000;

type Host = { kind: "frame"; wc: WebContents } | { kind: "worker"; worker: ServiceWorkerMain };

const hostGone = (host: Host) =>
  host.kind === "frame" ? host.wc.isDestroyed() : host.worker.isDestroyed();

function sendTo(host: Host, ...args: unknown[]): void {
  if (hostGone(host)) return;
  if (host.kind === "frame") host.wc.send(EVENT, ...args);
  else host.worker.send(EVENT, ...args);
}

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
  /** chrome.downloads started by extensions: extension ID → download ID → download. */
  private readonly downloads = new Map<string, Map<number, ExtensionDownload>>();
  /** Downloads an extension started that haven't begun yet: URL → downloads, oldest first. */
  private readonly startingDownloads = new Map<string, ExtensionDownload[]>();
  private nextDownloadId = 1;
  /** Native messaging ports: port ID → the host process and who opened it. */
  private readonly ports = new Map<string, { id: string; host: Host; port: NativePort }>();
  private sends = 0;

  constructor(
    private readonly browser: Browser,
    private readonly ses: Session,
  ) {}

  install(): void {
    ipcMain.handle(CALL, (event, name: unknown, ...args: unknown[]) => {
      const id = this.frameExtension(event);
      if (!id || typeof name !== "string") throw new Error("Not an extension");
      // navigator.credentials: pages only (service workers have none).
      if (name.startsWith("webauthn.")) return this.webauthn(id, event.sender, name, args);
      return this.call(id, name, args, { kind: "frame", wc: event.sender });
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
        // A stopped worker's native messaging ports end with it.
        if (runningStatus === "stopped")
          this.closePorts((h) => h.kind === "worker" && h.worker.versionId === versionId);
        return;
      }
      this.starting.set(versionId, []);
      const worker = this.ses.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = worker ? extensionIdOf(worker.scope) : null;
      if (!worker || !id || this.workers.has(worker)) return;
      this.workers.add(worker);
      worker.ipc.handle(CALL, (_event, name: unknown, ...args: unknown[]) => {
        if (typeof name !== "string") throw new Error("Bad call");
        return this.call(id, name, args, { kind: "worker", worker });
      });
      worker.ipc.on(SUBSCRIBE, (_event, name: unknown) => {
        if (typeof name === "string") this.subscribe(id, name, { kind: "worker", worker });
      });
    });
    // Downloads extensions start, for downloads.search and onChanged.
    this.ses.on("will-download", (_event, item) => {
      // The address asked for: getURL() is the one after redirects.
      const url = item.getURLChain()[0] ?? item.getURL();
      const waiting = this.startingDownloads.get(url);
      const download = waiting?.shift();
      if (!download) return;
      if (!waiting?.length) this.startingDownloads.delete(url);
      download.item = item;
      const owner = [...this.downloads].find(([, list]) => list.get(download.id) === download)?.[0];
      item.once("done", (_e, state) => {
        const current = state === "completed" ? "complete" : "interrupted";
        download.filename = item.getSavePath() || download.filename;
        download.state = current;
        if (owner)
          this.emit(owner, "downloads.onChanged", {
            id: download.id,
            state: { previous: "in_progress", current },
            ...(current === "interrupted" ? { error: { current: "USER_CANCELED" } } : {}),
          });
      });
    });
  }

  /** An extension was switched off or removed: the apps it talks to end. */
  unloaded(id: string): void {
    this.closePorts((_h, owner) => owner === id);
    this.downloads.delete(id);
    this.pending.delete(id);
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

  private webauthn(id: string, sender: WebContents, name: string, [a, b]: unknown[]): unknown {
    const webauthn = this.browser.extensions.webauthn;
    switch (name) {
      case "webauthn.isAvailable":
        return webauthn.isAvailable();
      case "webauthn.create":
        return webauthn.request(id, sender, "create", a, b);
      case "webauthn.get":
        return webauthn.request(id, sender, "get", a, b);
      case "webauthn.cancel":
        webauthn.cancel(id, a);
        return undefined;
      default:
        throw new Error(`${name} isn't available in Luma`);
    }
  }

  private async call(id: string, name: string, args: unknown[], host: Host): Promise<unknown> {
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
      case "tabGroups.move": {
        const found = this.findGroup(a);
        if (!found) throw new Error(`No group with id: ${String(a)}.`);
        const p = isObj(b) ? b : {};
        if (typeof p.index !== "number") throw new Error("tabGroups.move needs an index");
        if (p.windowId !== undefined && p.windowId !== found.win.win.id)
          throw new Error("Moving tab groups to another window isn't available in Luma.");
        return groupInfo(found.win, found.win.moveGroup(found.group.id, p.index, false));
      }
      case "tabs.group":
        return this.groupTabs(a);
      case "tabs.ungroup":
        for (const tab of this.tabsOf(a)) tab.window.ungroupTabs([tab]);
        return undefined;
      case "tabs.captureVisibleTab":
        return this.captureVisibleTab(id, a, b);
      case "downloads.download":
        return this.download(id, a);
      case "downloads.search":
        return this.downloadSearch(id, a);
      case "native.connect":
        return this.nativeConnect(id, a, b, host);
      case "native.post": {
        const entry = this.ports.get(String(a));
        if (entry?.id === id) entry.port.post(b);
        return undefined;
      }
      case "native.disconnect": {
        const entry = this.ports.get(String(a));
        if (entry?.id === id) {
          this.ports.delete(String(a));
          entry.port.close();
        }
        return undefined;
      }
      case "native.send":
        return this.nativeSend(id, a, b, host);
      default:
        throw new Error(`chrome.${name} isn't available in Luma`);
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

  // ---- tabs.captureVisibleTab ----

  /** The visible part of a window's active tab, as Chrome's data: URL. */
  private async captureVisibleTab(id: string, a: unknown, b: unknown): Promise<string> {
    const windowId = typeof a === "number" ? a : undefined;
    const options = isObj(typeof a === "number" || a == null ? b : a)
      ? ((typeof a === "number" || a == null ? b : a) as Record<string, unknown>)
      : {};
    const win = this.targetWindow(windowId !== undefined ? { windowId } : {});
    const tab = win?.activeTab;
    const wc = tab?.wc;
    if (!win || !tab || !wc || wc.isDestroyed()) throw new Error("No active tab to capture");
    const url = wc.getURL();
    const manifest = this.ses.extensions.getExtension(id)?.manifest as
      { permissions?: unknown; host_permissions?: unknown } | undefined;
    // Only web pages the extension may read anyway (its host permissions):
    // never Luma's own pages, other extensions, local files or the
    // Web Store. (activeTab alone isn't enough: Luma doesn't grant
    // it per click, so it would mean every page, any time, unasked.)
    const allowed =
      /^https?:/i.test(url) &&
      !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i.test(url) &&
      hasSiteAccess(
        { permissions: manifest?.permissions, host_permissions: manifest?.host_permissions },
        url,
      );
    if (!allowed || isInternalUrl(url)) throw new Error(`Cannot access contents of url "${url}".`);
    const image = await wc.capturePage();
    if (options.format === "png") return image.toDataURL();
    const quality = num(options.quality);
    const jpeg = image.toJPEG(quality !== undefined ? Math.max(0, Math.min(100, quality)) : 92);
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  }

  // ---- downloads ----

  private download(id: string, options: unknown): number {
    const o = isObj(options) ? options : {};
    const url = typeof o.url === "string" ? o.url : "";
    const own = `chrome-extension://${id}/`;
    const blobOfOwn = url.startsWith(`blob:${own}`);
    if (!/^(https?:|data:)/i.test(url) && !blobOfOwn && !url.startsWith(own))
      throw new Error("Invalid URL");
    const filename = typeof o.filename === "string" ? safeFilename(o.filename) : "";
    const download: ExtensionDownload = {
      id: this.nextDownloadId++,
      url,
      filename,
      state: "in_progress",
    };
    let list = this.downloads.get(id);
    if (!list) this.downloads.set(id, (list = new Map<number, ExtensionDownload>()));
    list.set(download.id, download);
    this.startingDownloads.set(url, [...(this.startingDownloads.get(url) ?? []), download]);
    setTimeout(() => {
      // Never started (an error before the download began): stop waiting for it.
      const waiting = this.startingDownloads.get(url)?.filter((d) => d !== download);
      if (waiting?.length) this.startingDownloads.set(url, waiting);
      else this.startingDownloads.delete(url);
    }, 60_000).unref();
    if (filename) this.browser.downloads.suggestName(this.ses, url, filename);
    // A blob lives in the page that made it: download it from there.
    const page = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.session === this.ses && wc.getURL().startsWith(own));
    if (page) page.downloadURL(url);
    else this.ses.downloadURL(url);
    return download.id;
  }

  private downloadSearch(id: string, query: unknown): unknown[] {
    const q = isObj(query) ? query : {};
    return [...(this.downloads.get(id)?.values() ?? [])]
      .filter((d) => q.id === undefined || d.id === q.id)
      .filter((d) => q.url === undefined || d.url === q.url)
      .filter((d) => q.state === undefined || d.state === q.state)
      .map((d) => ({
        id: d.id,
        url: d.url,
        finalUrl: d.url,
        filename: d.item?.getSavePath() || d.filename,
        state: d.state,
        paused: d.item?.isPaused() ?? false,
        bytesReceived: d.item?.getReceivedBytes() ?? 0,
        totalBytes: d.item?.getTotalBytes() ?? 0,
        fileSize: d.item?.getTotalBytes() ?? 0,
        mime: d.item?.getMimeType() ?? "",
        exists: d.state === "complete",
        incognito: false,
        danger: "safe",
        canResume: false,
        startTime: new Date(
          d.item?.getStartTime() ? d.item.getStartTime() * 1000 : Date.now(),
        ).toISOString(),
      }));
  }

  // ---- Native messaging ----

  private async nativeConnect(
    id: string,
    portId: unknown,
    name: unknown,
    host: Host,
  ): Promise<void> {
    if (typeof portId !== "string" || typeof name !== "string" || this.ports.has(portId))
      throw new Error("Bad native port");
    const release = this.holdHost(host, () => this.closePorts((_h, _o, p) => p === portId));
    // Registered before the host is found: the extension may post right away.
    const port = new NativePort(
      (message) => sendTo(host, "native.message", portId, message),
      (error) => {
        release();
        this.ports.delete(portId);
        sendTo(host, "native.disconnect", portId, error);
      },
    );
    this.ports.set(portId, { id, host, port });
    let found;
    try {
      found = await findHost(name, id);
    } catch (err) {
      release();
      this.ports.delete(portId);
      throw err;
    }
    if (!port.isClosed) port.start(found, id);
  }

  /**
   * Ties a native port to the page or worker that opened it: a page that
   * closes or leaves ends the port (`end`), and a service worker stays
   * awake while its port is open, as in Chrome. Returns the undo.
   */
  private holdHost(host: Host, end: () => void): () => void {
    if (host.kind === "worker") {
      let task: { end: () => void } | null = null;
      try {
        task = host.worker.startTask();
      } catch {
        // The worker is already gone.
      }
      return () => {
        task?.end();
        task = null;
      };
    }
    const wc = host.wc;
    const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) end();
    };
    wc.once("destroyed", end);
    wc.on("did-start-navigation", onNavigate);
    return () => {
      if (wc.isDestroyed()) return;
      wc.off("destroyed", end);
      wc.off("did-start-navigation", onNavigate);
    };
  }

  /** runtime.sendNativeMessage: the host's first answer. */
  private async nativeSend(
    id: string,
    name: unknown,
    message: unknown,
    host: Host,
  ): Promise<unknown> {
    if (typeof name !== "string") throw new Error("Bad native host name");
    const found = await findHost(name, id);
    const portId = `send-${++this.sends}`;
    return new Promise((resolve, reject) => {
      let answered = false;
      const timer = setTimeout(() => port.close("Native host did not answer."), SEND_TIMEOUT);
      const release = this.holdHost(host, () => port.close());
      const port: NativePort = new NativePort(
        (reply) => {
          if (answered) return;
          answered = true;
          resolve(reply);
          port.close();
        },
        (error) => {
          clearTimeout(timer);
          release();
          this.ports.delete(portId);
          if (!answered) reject(new Error(error ?? "Native host has exited."));
        },
      );
      // Tracked like a port, so switching the extension off ends it.
      this.ports.set(portId, { id, host, port });
      port.start(found, id);
      port.post(message);
    });
  }

  private closePorts(which: (host: Host, owner: string, portId: string) => boolean): void {
    for (const [portId, entry] of [...this.ports]) {
      if (!which(entry.host, entry.id, portId)) continue;
      this.ports.delete(portId);
      entry.port.close();
    }
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

  /** A tab an extension may debug: a normal web page, never Luma's own pages. */
  private debuggable(target: unknown): WebContents {
    const tabId = isObj(target) ? num(target.tabId) : undefined;
    const tab = tabId !== undefined ? this.browser.tabFor(tabId) : undefined;
    const wc = tab?.wc;
    if (!tab || !wc || tab.window.isPrivate) throw new Error("No tab with this ID");
    if (isInternalUrl(wc.getURL())) throw new Error("Cannot access a Luma page");
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
    // Luma's own pages are never debugged: leaving for one ends it.
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
