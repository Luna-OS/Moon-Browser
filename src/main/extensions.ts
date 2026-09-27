/**
 * Chrome extensions, installed from the Chrome Web Store.
 *
 * Electron runs extensions itself but knows nothing about tabs, windows or
 * toolbar buttons. electron-chrome-extensions (GPL-3.0) adds those chrome.*
 * APIs and the extension buttons with their pop-ups;
 * electron-chrome-web-store makes "Add to Chrome" work on
 * chromewebstore.google.com, downloads the signed package from Google's
 * update server and keeps extensions up to date.
 *
 * Extensions run in normal windows only, never in private ones. Before an
 * extension is added, Moon Browser shows what it will be able to do.
 */
import {
  app,
  dialog,
  Menu,
  nativeImage,
  webContents,
  type BaseWindow,
  type BrowserWindow,
  type ContextMenuParams,
  type Extension,
  type MenuItem,
  type Session,
  type WebContents,
} from "electron";
import { ElectronChromeExtensions, setSessionPartitionResolver } from "electron-chrome-extensions";
import {
  downloadExtension,
  installChromeWebStore,
  uninstallExtension,
} from "electron-chrome-web-store";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join, normalize, sep } from "node:path";
import { Script } from "node:vm";
import {
  compareVersions,
  describePermissions,
  EXTENSION_ID,
  EXTENSIONS_PARTITION,
  extensionPageUrl,
  hasSiteAccess,
  listsError,
  localize,
  optionsPage,
  pickIcon,
  sidePanelPage,
  unsupportedFeatures,
  type ManifestLike,
} from "@shared/extensions";
import { internalUrl, NEWTAB_URL } from "@shared/internal";
import type { TabGroupInfo } from "@shared/tab-groups";
import type { ExtensionEntry, ExtensionInfo } from "@shared/types";
import type { Browser } from "./browser";
import { Dnr } from "./dnr";
import { ExtensionProxy } from "./extension-proxy";
import { ExtensionWebAuthn } from "./extension-webauthn";
import { ExtensionApis, extensionIdOf, groupInfo } from "./extension-apis";
import { extensionApiPreload, extensionExtraPreload, profilePath } from "./paths";
import type { ExtensionPrefs, UnpackedExtension } from "./profile";
import type { MoonWindow } from "./window";

interface PanelOptions {
  path?: string;
  enabled?: boolean;
}

/**
 * The window electron-chrome-extensions opens for a toolbar button's pop-up.
 * The library doesn't export its type; show(), updatePosition() and
 * queryPreferredSize() are private there, so they are checked before use.
 */
interface PopupView {
  browserWindow?: BrowserWindow;
  destroy(): void;
  isDestroyed(): boolean;
  whenReady(): Promise<void>;
  setSize(size: { width: number; height: number }): void;
  usingPreferredSize?: boolean;
  show?: () => void;
  queryPreferredSize?: () => Promise<void>;
}

/** How long a pop-up may wait for Chromium to report its page's size. */
const POPUP_SIZE_WAIT = 600;

/** How many errors the extensions page keeps per extension. */
const MAX_ERRORS = 30;
/** How long a new extension's service worker may take to register. */
const WORKER_REGISTRATION_TIMEOUT = 30_000;

interface Installed {
  id: string;
  path: string;
  manifest: ManifestLike & Record<string, unknown>;
  /** Loaded from a folder in developer mode, not installed from the Web Store. */
  unpacked?: boolean;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A path inside `root`, or null if `rel` tries to leave it. */
function inside(root: string, rel: string): string | null {
  const full = normalize(join(root, rel));
  return full.startsWith(root + sep) ? full : null;
}

/** The extension ID a public key stands for, as Chrome computes it. */
function idFromKey(key: string): string {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as unknown;
  } catch {
    return null;
  }
}

export class Extensions {
  readonly path = profilePath("Extensions");
  /** chrome.declarativeNetRequest rules, applied by the browsing session. */
  readonly dnr = new Dnr();
  /** chrome.proxy: the browsing session's proxy, as an extension set it. */
  readonly proxy: ExtensionProxy;
  /** navigator.credentials in extension pages (Windows Hello, security keys). */
  readonly webauthn: ExtensionWebAuthn;
  private api: ElectronChromeExtensions | null = null;
  private apis: ExtensionApis | null = null;
  private session: Session | null = null;
  /** Set while Moon Browser itself tells the extension system a tab is gone. */
  private untracking = false;
  /** chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick }). */
  private readonly panelBehaviors = new Map<string, boolean>();
  /** chrome.sidePanel.setOptions: for all tabs, and per tab (webContents id). */
  private readonly panelDefaults = new Map<string, PanelOptions>();
  private readonly panelPerTab = new Map<string, Map<number, PanelOptions>>();
  private readonly errors = new Map<string, string[]>();
  private readonly icons = new Map<string, string | null>();
  /** The extension whose toolbar pop-up is open. */
  private popupExtension: string | null = null;
  /** Extensions loaded while Moon Browser starts get runtime.onStartup. */
  private starting = true;
  /** Unpacked extensions being reloaded: loading them again is an update. */
  private readonly reloading = new Set<string>();
  /** Web Store extensions whose files turned out damaged (see checkFiles). */
  private readonly damaged = new Set<string>();
  private readonly checkedFiles = new Set<string>();

  constructor(private readonly browser: Browser) {
    this.proxy = new ExtensionProxy(browser);
    this.webauthn = new ExtensionWebAuthn(browser);
  }

  get ready(): boolean {
    return this.api !== null;
  }

  /** Loaded extensions (the enabled ones). */
  count(): number {
    return this.session?.extensions.getAllExtensions().length ?? 0;
  }

  async init(ses: Session): Promise<void> {
    this.session = ses;
    this.proxy.attach(ses);
    const browser = this.browser;
    // The toolbar's buttons live in the UI's session and name the browsing
    // session by this partition; nothing else resolves to it.
    setSessionPartitionResolver((partition) =>
      partition === EXTENSIONS_PARTITION ? ses : browser.uiSession,
    );

    this.api = new ElectronChromeExtensions({
      license: "GPL-3.0",
      session: ses,
      createTab: (details) => {
        const win = this.windowFor(details.windowId);
        const url = typeof details.url === "string" ? details.url : NEWTAB_URL;
        const tab = win.openTab({ url, background: details.active === false });
        if (details.pinned) tab.pinned = true;
        const wc = tab.wc;
        if (!wc) return Promise.reject(new Error("The tab has no page"));
        return Promise.resolve([wc, win.win]);
      },
      selectTab: (wc) => {
        const tab = browser.tabFor(wc.id);
        if (tab && tab.window.activeId !== tab.id) tab.window.activate(tab.id);
      },
      removeTab: (wc) => {
        if (this.untracking) return;
        browser.tabFor(wc.id)?.close();
      },
      createWindow: (details) => {
        const urls = (Array.isArray(details.url) ? details.url : details.url ? [details.url] : [])
          .filter((u): u is string => typeof u === "string")
          .slice(0, 10);
        return Promise.resolve(browser.createWindow({ urls }).win);
      },
      removeWindow: (win) => {
        this.moonWindow(win)?.win.close();
      },
      assignTabDetails: (details, wc) => {
        const tab = browser.tabFor(wc.id);
        if (tab) {
          details.pinned = tab.pinned;
          details.groupId = tab.groupId ?? -1;
        }
      },
      requestPermissions: async (extension, request) => {
        const wanted = describePermissions({
          permissions: request.permissions ?? [],
          host_permissions: request.origins ?? [],
        });
        if (!wanted.length) return true;
        const response = await browser.ask({
          tone: "calm",
          glyph: "permission",
          image: this.largeIconOf(extension),
          eyebrow: "Extension permissions",
          title: `“${extension.name}” asks for more access`,
          list: { label: "It could then", items: wanted },
          buttons: [
            { label: "Deny", style: "secondary" },
            { label: "Allow", style: "primary" },
          ],
          defaultId: 0,
          cancelId: 0,
        });
        return response === 1;
      },
    });

    // The APIs the library lacks (side panel, identity, …), in extension
    // pages and service workers.
    this.apis = new ExtensionApis(browser, ses);
    this.apis.install();
    ses.registerPreloadScript({
      id: "moon-extension-apis",
      type: "frame",
      filePath: extensionExtraPreload,
    });
    ses.registerPreloadScript({
      id: "moon-extension-apis-worker",
      type: "service-worker",
      filePath: extensionExtraPreload,
    });

    // Our patched copy of the chrome.* API preload replaces the library's
    // own, which would leave its IPC bridge reachable by extension code.
    for (const [id, type] of [
      ["crx-mv2-preload", "frame"],
      ["crx-mv3-preload", "service-worker"],
    ] as const) {
      ses.unregisterPreloadScript(id);
      ses.registerPreloadScript({ id, type, filePath: extensionApiPreload });
    }

    // Links in an extension's pop-up open as tabs, not as bare windows.
    this.api.on("browser-action-popup-created", (popup: PopupView & { extensionId: string }) =>
      this.watchPopup(popup),
    );

    // The icons of the toolbar's extension buttons.
    ElectronChromeExtensions.handleCRXProtocol(browser.uiSession);

    ses.extensions.on("extension-loaded", (_event, extension) => {
      this.icons.delete(extension.id);
      void this.dnr.load(extension);
      this.proxy.loaded(extension.id);
      this.lifecycleEvents(extension);
      // Web Store installs load without their service worker running.
      void this.startWorker(extension);
      this.changed();
    });
    ses.extensions.on("extension-unloaded", (_event, extension) => {
      this.dnr.unload(extension.id);
      this.proxy.unloaded(extension.id);
      for (const win of browser.windows) win.closeSidePanel(extension.id);
      this.changed();
    });

    // Errors of extensions — their service workers, pages and content
    // scripts — for the extensions page, like Chrome's "Errors" button.
    ses.serviceWorkers.on("console-message", (_event, details) => {
      const id = extensionIdOf(details.sourceUrl);
      if (details.level < 3 || !id) return;
      this.recordError(
        id,
        `${details.message} (${shortSource(details.sourceUrl)}:${details.lineNumber})`,
      );
      if (details.message.includes("SyntaxError")) void this.checkFiles(id);
    });
    app.on("web-contents-created", (_event, contents) => {
      if (contents.session !== ses) return;
      contents.on("console-message", (details) => {
        if (details.level !== "error") return;
        const id = extensionIdOf(details.sourceId) ?? extensionIdOf(contents.getURL());
        if (id)
          this.recordError(
            id,
            `${details.message} (${shortSource(details.sourceId)}:${details.lineNumber})`,
          );
      });
    });

    await installChromeWebStore({
      session: ses,
      extensionsPath: this.path,
      // Loaded below, skipping the ones switched off.
      loadExtensions: false,
      allowUnpackedExtensions: false,
      autoUpdate: true,
      beforeInstall: async (details) => {
        const contents = webContents.fromFrame(details.frame);
        const tab = contents ? browser.tabFor(contents.id) : undefined;
        if (!tab || tab.window.isPrivate) return { action: "deny" };
        const allowed = await this.confirmInstall(
          tab.window.win,
          details.localizedName,
          details.manifest,
          details.icon,
        );
        if (allowed) this.setDisabled(details.id, false);
        return { action: allowed ? "allow" : "deny" };
      },
    });

    for (const ext of await this.installed()) {
      if (!this.disabled().has(ext.id)) await this.load(ext);
    }
    if (this.prefs().developerMode) {
      for (const u of this.prefs().unpacked) {
        if (!this.disabled().has(u.id)) await this.loadUnpackedEntry(u);
      }
    }
    this.starting = false;
  }

  /**
   * chrome.runtime.onInstalled and onStartup, which Electron never fires —
   * though extensions set themselves up there (defaults, menus, first
   * state). "install" the first time Moon Browser loads an extension,
   * "update" when its version changed or an unpacked one was reloaded,
   * onStartup for the others when Moon Browser starts. Delivered as soon as
   * the extension's service worker listens.
   */
  private lifecycleEvents(ext: Extension): void {
    const apis = this.apis;
    if (!apis) return;
    const prefs = this.prefs();
    const previous = prefs.versions[ext.id];
    const reloaded = this.reloading.delete(ext.id);
    if (previous !== ext.version) {
      prefs.versions[ext.id] = ext.version;
      this.browser.profile.extensions.changed();
    }
    if (!previous) apis.emitSoon(ext.id, "runtime.onInstalled", { reason: "install" });
    else if (previous !== ext.version || reloaded)
      apis.emitSoon(ext.id, "runtime.onInstalled", { reason: "update", previousVersion: previous });
    else if (this.starting) apis.emitSoon(ext.id, "runtime.onStartup");
  }

  // ---- Tabs and windows ----

  /** A tab got a page (new, or woken up). */
  addTab(wc: WebContents, win: MoonWindow): void {
    if (!this.api || win.isPrivate || wc.session !== this.session) return;
    this.api.addTab(wc, win.win);
  }

  /** A tab let go of its page (closed, or put to sleep). */
  removeTab(wc: WebContents): void {
    if (!this.api || wc.isDestroyed() || wc.session !== this.session) return;
    this.untracking = true;
    try {
      this.api.removeTab(wc);
    } finally {
      this.untracking = false;
    }
  }

  selectTab(wc: WebContents): void {
    if (!this.api || wc.isDestroyed() || wc.session !== this.session) return;
    this.api.selectTab(wc);
  }

  contextMenuItems(wc: WebContents, params: ContextMenuParams): MenuItem[] {
    if (!this.api || wc.session !== this.session) return [];
    try {
      return this.api.getContextMenuItems(wc, params);
    } catch {
      return [];
    }
  }

  /** A normal (not private) window: this one, the focused one, any — or a new one. */
  windowFor(windowId: number | undefined): MoonWindow {
    const normal = [...this.browser.windows].filter((w) => !w.isPrivate && !w.closed);
    return (
      normal.find((w) => w.win.id === windowId) ??
      (this.browser.focusedWindow()?.isPrivate === false
        ? this.browser.focusedWindow()
        : undefined) ??
      normal[0] ??
      this.browser.createWindow({})
    );
  }

  private moonWindow(win: BaseWindow | BrowserWindow): MoonWindow | undefined {
    return [...this.browser.windows].find((w) => w.win === win);
  }

  // ---- Installing ----

  private async confirmInstall(
    parent: BrowserWindow,
    name: string,
    manifest: ManifestLike,
    icon: Electron.NativeImage,
  ): Promise<boolean> {
    const can = describePermissions(manifest);
    const response = await this.browser.ask(
      {
        tone: "calm",
        glyph: "extension",
        image: icon.isEmpty() ? undefined : icon.resize({ width: 96, height: 96 }).toDataURL(),
        eyebrow: "Add extension",
        title: `Add “${name}” to Moon Browser?`,
        message: can.length ? undefined : "It needs no special permissions.",
        list: can.length ? { label: "It can", items: can } : undefined,
        notes: [
          ...unsupportedFeatures(manifest),
          "Extensions run in normal windows, not in private ones.",
        ],
        buttons: [
          { label: "Cancel", style: "secondary" },
          { label: "Add extension", style: "primary" },
        ],
        defaultId: 1,
        cancelId: 0,
      },
      this.moonWindow(parent),
    );
    return response === 1;
  }

  /** The newest version of every extension in the Extensions folder. */
  private async installed(): Promise<Installed[]> {
    const ids = await readdir(this.path, { withFileTypes: true }).catch(() => []);
    const result: Installed[] = [];
    for (const entry of ids) {
      if (!entry.isDirectory() || !EXTENSION_ID.test(entry.name)) continue;
      const dir = join(this.path, entry.name);
      let best: Installed | null = null;
      for (const version of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!version.isDirectory()) continue;
        const path = join(dir, version.name);
        const manifest = await readJson(join(path, "manifest.json"));
        if (!manifest || typeof manifest !== "object") continue;
        const m = manifest as Installed["manifest"];
        // Only Web Store packages as installed: Manifest V3, with the key
        // that the folder's ID was computed from.
        if (typeof m.version !== "string" || m.manifest_version !== 3) continue;
        if (typeof m.key !== "string" || idFromKey(m.key) !== entry.name) continue;
        if (!best || compareVersions(m.version, String(best.manifest.version)) > 0)
          best = { id: entry.name, path, manifest: m };
      }
      if (best) result.push(best);
    }
    return result;
  }

  private async load(ext: Installed): Promise<void> {
    const ses = this.session;
    if (!ses || ses.extensions.getExtension(ext.id)) return;
    try {
      await ses.extensions.loadExtension(ext.path);
    } catch (err) {
      console.error(`[moon] could not load extension ${ext.id}:`, err);
      this.recordError(
        ext.id,
        `Could not load: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * A toolbar button's pop-up, made to behave like Chrome's. It appears once
   * Chromium reports how big its page is; where that report doesn't come,
   * the page is measured instead, so the pop-up still opens. Once shown it
   * takes the focus: typing goes into it, and clicking anywhere else closes
   * it. Links it opens become tabs.
   */
  private watchPopup(popup: PopupView & { extensionId: string }): void {
    const win = popup.browserWindow;
    if (!win) return;
    this.popupExtension = popup.extensionId;
    this.changed();
    win.once("closed", () => {
      if (this.popupExtension === popup.extensionId) this.popupExtension = null;
      this.changed();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^(https?|chrome-extension):/i.test(url)) this.windowFor(undefined).openTab({ url });
      return { action: "deny" };
    });
    win.once("show", () => {
      if (!win.isDestroyed()) win.focus();
    });
    // The library closes the pop-up when it loses the focus to another of
    // Moon Browser's windows, but asks too early: the other window isn't
    // focused yet then. So: closed when another window gets the focus.
    const closeOnFocus = (_event: unknown, focused: BrowserWindow) => {
      if (focused !== win && !popup.isDestroyed()) popup.destroy();
    };
    app.on("browser-window-focus", closeOnFocus);
    win.once("closed", () => app.off("browser-window-focus", closeOnFocus));
    void popup.whenReady().then(async () => {
      await new Promise((resolve) => setTimeout(resolve, POPUP_SIZE_WAIT));
      if (popup.isDestroyed() || win.isDestroyed() || win.isVisible()) return;
      const { show, queryPreferredSize } = popup;
      if (typeof show !== "function" || typeof queryPreferredSize !== "function") return;
      // Measured at the largest pop-up size, as the library does where
      // Chromium can't report sizes.
      popup.usingPreferredSize = false;
      popup.setSize({ width: 800, height: 600 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (popup.isDestroyed()) return;
      await queryPreferredSize.call(popup).catch(() => undefined);
      if (!popup.isDestroyed() && !win.isVisible()) show.call(popup);
    });
  }

  /**
   * Makes sure a loaded extension's service worker runs, as Chrome does at
   * start-up. A new or updated extension first gets its worker registered,
   * which runs it but takes a moment (longer for big workers like a
   * password manager's), and starting a worker that isn't registered yet
   * fails; so a failed start waits for the registration, then checks again.
   */
  private async startWorker(extension: Extension): Promise<void> {
    const ses = this.session;
    const manifest = extension.manifest as {
      manifest_version?: number;
      background?: { service_worker?: string };
    };
    if (!ses || manifest.manifest_version !== 3 || !manifest.background?.service_worker) return;
    const workers = ses.serviceWorkers;
    const scope = `chrome-extension://${extension.id}/`;
    const running = () => Object.values(workers.getAllRunning()).some((w) => w.scope === scope);
    const start = () =>
      workers.startWorkerForScope(scope).then(
        () => null,
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      );

    let onRegistered = (_event: unknown, _details: { scope: string }) => {};
    const registered = new Promise<void>((resolve) => {
      onRegistered = (_event, details) => {
        if (details.scope === scope) resolve();
      };
      workers.on("registration-completed", onRegistered);
    });
    try {
      if ((await start()) === null) return;
      await Promise.race([
        registered,
        new Promise((resolve) => setTimeout(resolve, WORKER_REGISTRATION_TIMEOUT)),
      ]);
      // Switched off or removed in the meantime, or running after its registration.
      if (!ses.extensions.getExtension(extension.id) || running()) return;
      const error = await start();
      if (error !== null && ses.extensions.getExtension(extension.id)) {
        this.recordError(extension.id, `The service worker didn't start: ${error}`);
        void this.checkFiles(extension.id);
      }
    } finally {
      workers.removeListener("registration-completed", onRegistered);
    }
  }

  private disabled(): Set<string> {
    return new Set(this.browser.profile.extensions.get().disabled);
  }

  private setDisabled(id: string, disabled: boolean): void {
    const prefs = this.browser.profile.extensions.get();
    const list = prefs.disabled.filter((x) => x !== id);
    if (disabled) list.push(id);
    prefs.disabled = list;
    this.browser.profile.extensions.changed();
  }

  // ---- The extensions page ----

  async list(): Promise<ExtensionInfo[]> {
    const ses = this.session;
    const out: ExtensionInfo[] = [];
    for (const ext of await this.all()) {
      const messages = await this.messages(ext);
      const text = (v: unknown) => (typeof v === "string" ? localize(v, messages) : "");
      const iconPath = pickIcon(ext.manifest, 48);
      const iconFile = iconPath ? inside(ext.path, iconPath) : null;
      const image = iconFile ? nativeImage.createFromPath(iconFile) : null;
      out.push({
        id: ext.id,
        name: text(ext.manifest.name) || (ext.unpacked ? basename(ext.path) : ext.id),
        version: typeof ext.manifest.version === "string" ? ext.manifest.version : "",
        description: text(ext.manifest.description),
        enabled: !!ses?.extensions.getExtension(ext.id),
        icon:
          image && !image.isEmpty() ? image.resize({ width: 48, height: 48 }).toDataURL() : null,
        hasOptions: optionsPage(ext.manifest) !== null,
        permissions: describePermissions(ext.manifest),
        unsupported: unsupportedFeatures(ext.manifest),
        errors: this.errors.get(ext.id) ?? [],
        unpacked: !!ext.unpacked,
        path: ext.unpacked ? ext.path : null,
        damaged: this.damaged.has(ext.id),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Web Store extensions, and in developer mode the unpacked ones. */
  private async all(): Promise<Installed[]> {
    const all = await this.installed();
    if (!this.prefs().developerMode) return all;
    for (const u of this.prefs().unpacked) {
      const manifest = await readJson(join(u.path, "manifest.json"));
      all.push({
        id: u.id,
        path: u.path,
        manifest: (manifest && typeof manifest === "object"
          ? manifest
          : {}) as Installed["manifest"],
        unpacked: true,
      });
    }
    return all;
  }

  /** The extension's texts in the user's language, falling back to its default. */
  private async messages(ext: Installed): Promise<Record<string, { message?: unknown }>> {
    const locales = [
      ...this.browser.languages().flatMap((l) => [l.replace("-", "_"), l.split("-")[0]]),
      typeof ext.manifest.default_locale === "string" ? ext.manifest.default_locale : "en",
    ];
    for (const locale of locales) {
      if (!/^[\w-]+$/.test(locale)) continue;
      const data = await readJson(join(ext.path, "_locales", locale, "messages.json"));
      if (data && typeof data === "object") return data as Record<string, { message?: unknown }>;
    }
    return {};
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const ses = this.session;
    if (!ses || !EXTENSION_ID.test(id)) return;
    const ext = (await this.all()).find((e) => e.id === id);
    if (!ext) return;
    this.setDisabled(id, !enabled);
    if (!enabled) {
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
    } else if (ext.unpacked) {
      const entry = this.unpackedEntry(id);
      if (entry) await this.loadUnpackedEntry(entry);
    } else {
      await this.load(ext);
    }
    this.changed();
  }

  async remove(id: string): Promise<void> {
    const ses = this.session;
    if (!ses || !EXTENSION_ID.test(id)) return;
    if (this.unpackedEntry(id)) {
      // The folder stays where it is; Moon Browser only forgets it.
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
      const prefs = this.prefs();
      prefs.unpacked = prefs.unpacked.filter((u) => u.id !== id);
      this.browser.profile.extensions.changed();
    } else {
      await uninstallExtension(id, { session: ses, extensionsPath: this.path });
    }
    // Its storage and rules go with it, as in Chrome.
    await ses.clearStorageData({ origin: `chrome-extension://${id}` }).catch(() => undefined);
    this.dnr.forget(id);
    this.proxy.forget(id);
    const prefs = this.prefs();
    if (prefs.versions[id]) {
      delete prefs.versions[id];
      this.browser.profile.extensions.changed();
    }
    this.setDisabled(id, false);
    this.errors.delete(id);
    this.damaged.delete(id);
    this.changed();
  }

  /** Opens the extension's settings page in a tab of a normal window. */
  async openOptions(id: string): Promise<void> {
    if (!EXTENSION_ID.test(id)) return;
    const ext = (await this.all()).find((e) => e.id === id);
    const page = ext && optionsPage(ext.manifest);
    if (!page || !this.session?.extensions.getExtension(id)) return;
    const win = this.windowFor(undefined);
    win.openTab({ url: `chrome-extension://${id}/${page.replace(/^\/+/, "")}` });
    win.win.focus();
  }

  // ---- Damaged files ----

  /**
   * Looks at an extension whose service worker reported a syntax error or
   * didn't start. If its script doesn't even compile, the file on disk is
   * damaged (cut off, say), and the extension can't work until it is
   * installed again. The script is only compiled here, never run.
   */
  private async checkFiles(id: string): Promise<void> {
    const ext = this.session?.extensions.getExtension(id);
    const key = `${id}@${ext?.version}`;
    if (!ext || this.unpackedEntry(id) || this.checkedFiles.has(key)) return;
    this.checkedFiles.add(key);
    const background = (
      ext.manifest as { background?: { service_worker?: unknown; type?: unknown } }
    ).background;
    const worker = background?.service_worker;
    // A module worker isn't a plain script; nothing to compile it as here.
    if (typeof worker !== "string" || background?.type === "module") return;
    const file = inside(ext.path, worker);
    if (!file) return;
    let code: string;
    try {
      code = await readFile(file, "utf8");
    } catch {
      this.markDamaged(id, `${worker} is missing`);
      return;
    }
    try {
      new Script(code, { filename: worker });
    } catch (err) {
      if (err instanceof Error && err.name === "SyntaxError")
        this.markDamaged(id, `${worker}: ${err.message}`);
    }
  }

  private markDamaged(id: string, why: string): void {
    this.damaged.add(id);
    this.recordError(
      id,
      `The extension's files are damaged (${why}). “Repair” installs it again from the Chrome Web Store; its settings and data stay.`,
    );
    this.changed();
  }

  /**
   * Downloads a Web Store extension again and puts it in place of the
   * installed copy. Its storage (logins, settings) stays. The old copy is
   * only replaced once the new one has arrived.
   */
  async repair(id: string): Promise<void> {
    const ses = this.session;
    if (!ses || !EXTENSION_ID.test(id) || this.unpackedEntry(id)) return;
    const staging = join(this.path, ".repair");
    try {
      await rm(staging, { recursive: true, force: true });
      const fresh = await downloadExtension(id, staging);
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
      const dir = join(this.path, id);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await rename(fresh, join(dir, basename(fresh)));
      this.damaged.delete(id);
      this.errors.delete(id);
      this.checkedFiles.clear();
      const ext = (await this.installed()).find((e) => e.id === id);
      if (ext && !this.disabled().has(id)) await this.load(ext);
    } catch (err) {
      this.recordError(id, `Repair didn't work: ${errorText(err)}`);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    this.changed();
  }

  // ---- Developer mode ----

  private prefs(): ExtensionPrefs {
    return this.browser.profile.extensions.get();
  }

  developerMode(): boolean {
    return this.prefs().developerMode;
  }

  /** Unpacked extensions only run while developer mode is on. */
  async setDeveloperMode(on: boolean): Promise<void> {
    const ses = this.session;
    const prefs = this.prefs();
    if (!ses || prefs.developerMode === on) return;
    prefs.developerMode = on;
    this.browser.profile.extensions.changed();
    for (const u of prefs.unpacked) {
      if (!on) {
        if (ses.extensions.getExtension(u.id)) ses.extensions.removeExtension(u.id);
      } else if (!this.disabled().has(u.id)) {
        await this.loadUnpackedEntry(u);
      }
    }
    this.changed();
  }

  /**
   * Asks for a folder and loads the extension in it, after showing what it
   * will be able to do, like a Web Store install. Returns why it didn't
   * work, or null.
   */
  async loadUnpacked(parent: BrowserWindow | undefined): Promise<string | null> {
    const ses = this.session;
    if (!ses || !this.prefs().developerMode) return null;
    const options: Electron.OpenDialogOptions = {
      title: "Load unpacked extension",
      buttonLabel: "Select folder",
      properties: ["openDirectory"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    const raw = await readJson(join(path, "manifest.json"));
    if (!raw || typeof raw !== "object") return "This folder has no manifest.json.";
    const manifest = raw as Installed["manifest"];
    const messages = await this.messages({ id: "", path, manifest });
    const name =
      (typeof manifest.name === "string" ? localize(manifest.name, messages) : "") ||
      basename(path);
    // A key would give it the ID of an extension from the Web Store.
    if (
      typeof manifest.key === "string" &&
      (await this.installed()).some((e) => e.id === idFromKey(manifest.key as string))
    )
      return `“${name}” is already installed from the Chrome Web Store.`;
    if (parent) {
      const iconPath = pickIcon(manifest, 128);
      const iconFile = iconPath ? inside(path, iconPath) : null;
      const icon = iconFile ? nativeImage.createFromPath(iconFile) : nativeImage.createEmpty();
      if (!(await this.confirmInstall(parent, name, manifest, icon))) return null;
    }
    let ext: Extension;
    try {
      ext = await ses.extensions.loadExtension(path);
    } catch (err) {
      return `Couldn't load “${name}”: ${errorText(err)}`;
    }
    const prefs = this.prefs();
    prefs.unpacked = [
      ...prefs.unpacked.filter((u) => u.id !== ext.id && u.path !== path),
      { path, id: ext.id },
    ];
    this.setDisabled(ext.id, false);
    this.changed();
    return null;
  }

  /** Loads an unpacked extension's folder again, with its latest changes. */
  async reload(id: string): Promise<void> {
    const ses = this.session;
    const entry = this.unpackedEntry(id);
    if (!ses || !entry || !this.prefs().developerMode) return;
    this.errors.delete(id);
    if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
    if (!this.disabled().has(id)) {
      this.reloading.add(id);
      await this.loadUnpackedEntry(entry);
    }
    this.changed();
  }

  private unpackedEntry(id: string): UnpackedExtension | undefined {
    return this.prefs().unpacked.find((u) => u.id === id);
  }

  private async loadUnpackedEntry(entry: UnpackedExtension): Promise<void> {
    const ses = this.session;
    if (!ses || ses.extensions.getExtension(entry.id)) return;
    try {
      const ext = await ses.extensions.loadExtension(entry.path);
      if (ext.id !== entry.id) {
        // Its manifest's key changed, and with it the ID.
        entry.id = ext.id;
        this.browser.profile.extensions.changed();
      }
    } catch (err) {
      this.recordError(entry.id, `Couldn't load ${entry.path}: ${errorText(err)}`);
    }
  }

  /** The IDs of the loaded (switched on) extensions. */
  loadedIds(): string[] {
    return this.session?.extensions.getAllExtensions().map((e) => e.id) ?? [];
  }

  /** Delivers an event to an extension's pages and service worker. */
  emitTo(id: string, name: string, ...args: unknown[]): void {
    this.apis?.emit(id, name, ...args);
  }

  /** The extension whose toolbar pop-up is open, if any. */
  openPopup(): string | null {
    return this.popupExtension;
  }

  /** Whether a loaded extension declared `permission` in its manifest. */
  /** A loaded extension's manifest. */
  manifest(id: string): Record<string, unknown> | undefined {
    return this.session?.extensions.getExtension(id)?.manifest as
      Record<string, unknown> | undefined;
  }

  declares(id: string, permission: string): boolean {
    const ext = this.session?.extensions.getExtension(id);
    const permissions = (ext?.manifest as { permissions?: unknown } | undefined)?.permissions;
    return Array.isArray(permissions) && permissions.includes(permission);
  }

  // ---- Toolbar and extensions menu ----

  /** The loaded extensions as a window's toolbar and extensions menu show them. */
  entries(pageUrl: string): ExtensionEntry[] {
    const ses = this.session;
    if (!ses) return [];
    const unpinned = new Set(this.browser.profile.extensions.get().unpinned);
    const webPage = /^(https?|file):/i.test(pageUrl);
    return ses.extensions
      .getAllExtensions()
      .map((ext): ExtensionEntry => {
        const manifest = ext.manifest as ManifestLike;
        return {
          id: ext.id,
          name: ext.name,
          icon: this.iconOf(ext),
          pinned: !unpinned.has(ext.id),
          access: webPage && hasSiteAccess(manifest, pageUrl) ? "full" : "none",
          hasOptions: optionsPage(manifest) !== null,
          opensSidePanel: this.panelBehavior(ext.id) && this.panelUrl(ext.id) !== null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  entry(id: string): ExtensionEntry | undefined {
    return this.entries("").find((e) => e.id === id);
  }

  private iconOf(ext: Extension): string | null {
    const cached = this.icons.get(ext.id);
    if (cached !== undefined) return cached;
    const iconPath = pickIcon(ext.manifest as ManifestLike, 32);
    const file = iconPath ? inside(ext.path, iconPath) : null;
    const image = file ? nativeImage.createFromPath(file) : null;
    const icon =
      image && !image.isEmpty() ? image.resize({ width: 32, height: 32 }).toDataURL() : null;
    this.icons.set(ext.id, icon);
    return icon;
  }

  /** The extension's icon, big enough for a dialog. */
  private largeIconOf(ext: Extension | null | undefined): string | undefined {
    if (!ext) return undefined;
    const iconPath = pickIcon(ext.manifest as ManifestLike, 128);
    const file = iconPath ? inside(ext.path, iconPath) : null;
    const image = file ? nativeImage.createFromPath(file) : null;
    return image && !image.isEmpty()
      ? image.resize({ width: 96, height: 96 }).toDataURL()
      : undefined;
  }

  setPinned(id: string, pinned: boolean): void {
    const prefs = this.browser.profile.extensions.get();
    prefs.unpinned = prefs.unpinned.filter((x) => x !== id);
    if (!pinned) prefs.unpinned.push(id);
    this.browser.profile.extensions.changed();
    this.browser.updateAllWindows();
  }

  /** The ⋮ menu of an extension in the extensions menu (or a right click on its button). */
  showMenu(win: MoonWindow, id: string, x: number, y: number): void {
    const entry = this.entry(id);
    if (!entry) return;
    Menu.buildFromTemplate([
      { label: entry.name, enabled: false },
      { type: "separator" },
      { label: "Options", enabled: entry.hasOptions, click: () => void this.openOptions(id) },
      {
        label: entry.pinned ? "Unpin from toolbar" : "Pin to toolbar",
        click: () => this.setPinned(id, !entry.pinned),
      },
      { type: "separator" },
      {
        label: "Manage extension",
        click: () => win.openTab({ url: internalUrl("extensions") }),
      },
      {
        label: "Remove from Moon Browser…",
        click: () => {
          void this.browser
            .ask(
              {
                tone: "calm",
                glyph: "remove",
                image: this.largeIconOf(this.session?.extensions.getExtension(id)),
                eyebrow: "Remove extension",
                title: `Remove “${entry.name}”?`,
                message: "Its data in Moon Browser is deleted with it.",
                buttons: [
                  { label: "Cancel", style: "secondary" },
                  { label: "Remove", style: "danger" },
                ],
                defaultId: 0,
                cancelId: 0,
              },
              win,
            )
            .then((response) => {
              if (response === 1) void this.remove(id);
            });
        },
      },
    ]).popup({ window: win.win, x: Math.round(x), y: Math.round(y) });
  }

  // ---- Side panel (chrome.sidePanel) ----

  panelBehavior(id: string): boolean {
    return this.panelBehaviors.get(id) === true;
  }

  setPanelBehavior(id: string, openOnActionClick: boolean): void {
    this.panelBehaviors.set(id, openOnActionClick);
    this.browser.updateAllWindows();
  }

  panelOptions(id: string, tabId?: number): { enabled: boolean; path?: string } {
    const ext = this.session?.extensions.getExtension(id);
    const fallback = ext ? sidePanelPage(ext.manifest as ManifestLike) : null;
    const global = this.panelDefaults.get(id) ?? {};
    const own = tabId !== undefined ? this.panelPerTab.get(id)?.get(tabId) : undefined;
    const path = own?.path ?? global.path ?? fallback ?? undefined;
    return { enabled: own?.enabled ?? global.enabled ?? !!path, path };
  }

  setPanelOptions(id: string, options: PanelOptions & { tabId?: number }): void {
    const { tabId, ...values } = options;
    if (values.path !== undefined && !extensionPageUrl(id, values.path)) return;
    if (tabId === undefined) {
      this.panelDefaults.set(id, { ...this.panelDefaults.get(id), ...values });
    } else {
      let perTab = this.panelPerTab.get(id);
      if (!perTab) this.panelPerTab.set(id, (perTab = new Map<number, PanelOptions>()));
      perTab.set(tabId, { ...perTab.get(tabId), ...values });
    }
    for (const win of this.browser.windows) win.refreshSidePanel();
    this.browser.updateAllWindows();
  }

  /** The side panel page of an extension for a tab, or null if it has none there. */
  panelUrl(id: string, tabId?: number): string | null {
    const { enabled, path } = this.panelOptions(id, tabId);
    return enabled && path ? extensionPageUrl(id, path) : null;
  }

  panelOpened(win: MoonWindow, id: string, url: string): void {
    const path = url.replace(`chrome-extension://${id}/`, "");
    this.apis?.emit(id, "sidePanel.onOpened", { windowId: win.win.id, path });
  }

  panelClosed(win: MoonWindow, id: string, url: string): void {
    const path = url.replace(`chrome-extension://${id}/`, "");
    this.apis?.emit(id, "sidePanel.onClosed", { windowId: win.win.id, path });
  }

  // ---- Tab groups (chrome.tabGroups events) ----

  groupChanged(
    kind: "onCreated" | "onUpdated" | "onRemoved" | "onMoved",
    win: MoonWindow,
    group: TabGroupInfo,
  ): void {
    if (win.isPrivate) return;
    this.apis?.emitAll(`tabGroups.${kind}`, "tabGroups", groupInfo(win, group));
  }

  // ---- Errors ----

  recordError(id: string, text: string): void {
    // Unanswered messages: only for one's own extensions in developer mode.
    if (
      !listsError(text, { developerMode: this.developerMode(), unpacked: !!this.unpackedEntry(id) })
    )
      return;
    const list = this.errors.get(id) ?? [];
    list.push(text.length > 500 ? `${text.slice(0, 499)}…` : text);
    this.errors.set(id, list.slice(-MAX_ERRORS));
    this.browser.notifyInternal("extensions");
  }

  clearErrors(id: string): void {
    this.errors.delete(id);
    this.browser.notifyInternal("extensions");
  }

  private changed(): void {
    this.browser.notifyInternal("extensions");
    this.browser.updateAllWindows();
  }
}

/** "chrome-extension://…/js/background.js" → "js/background.js". */
function shortSource(url: string): string {
  return url.replace(/^chrome-extension:\/\/[a-p]{32}\//, "") || url;
}
