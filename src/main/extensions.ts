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
import { installChromeWebStore, uninstallExtension } from "electron-chrome-web-store";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  compareVersions,
  describePermissions,
  EXTENSION_ID,
  EXTENSIONS_PARTITION,
  extensionPageUrl,
  hasSiteAccess,
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
import { ExtensionApis, extensionIdOf, groupInfo } from "./extension-apis";
import { extensionApiPreload, extensionExtraPreload, profilePath } from "./paths";
import type { MoonWindow } from "./window";

interface PanelOptions {
  path?: string;
  enabled?: boolean;
}

/** How many errors the extensions page keeps per extension. */
const MAX_ERRORS = 30;

interface Installed {
  id: string;
  path: string;
  manifest: ManifestLike & Record<string, unknown>;
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

  constructor(private readonly browser: Browser) {}

  get ready(): boolean {
    return this.api !== null;
  }

  /** Loaded extensions (the enabled ones). */
  count(): number {
    return this.session?.extensions.getAllExtensions().length ?? 0;
  }

  async init(ses: Session): Promise<void> {
    this.session = ses;
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
        const parent = browser.focusedWindow()?.win;
        const options = {
          type: "question" as const,
          buttons: ["Allow", "Deny"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          title: "Extension permissions",
          message: `“${extension.name}” asks for more access`,
          detail: `It could then:\n• ${wanted.join("\n• ")}`,
        };
        const { response } = parent
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options);
        return response === 0;
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
    this.api.on("browser-action-popup-created", (popup: { browserWindow?: BrowserWindow }) => {
      popup.browserWindow?.webContents.setWindowOpenHandler(({ url }) => {
        if (/^(https?|chrome-extension):/i.test(url)) this.windowFor(undefined).openTab({ url });
        return { action: "deny" };
      });
    });

    // The icons of the toolbar's extension buttons.
    ElectronChromeExtensions.handleCRXProtocol(browser.uiSession);

    ses.extensions.on("extension-loaded", (_event, extension) => {
      this.icons.delete(extension.id);
      // Web Store installs load without their service worker running.
      void this.startWorker(extension);
      this.changed();
    });
    ses.extensions.on("extension-unloaded", (_event, extension) => {
      for (const win of browser.windows) win.closeSidePanel(extension.id);
      this.changed();
    });

    // Errors of extensions — their service workers, pages and content
    // scripts — for the extensions page, like Chrome's "Errors" button.
    ses.serviceWorkers.on("console-message", (_event, details) => {
      const id = extensionIdOf(details.sourceUrl);
      if (details.level >= 3 && id)
        this.recordError(
          id,
          `${details.message} (${shortSource(details.sourceUrl)}:${details.lineNumber})`,
        );
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
    const missing = unsupportedFeatures(manifest);
    const detail = [
      can.length ? `It can:\n• ${can.join("\n• ")}` : "It needs no special permissions.",
      ...missing,
      "Extensions run in normal windows, not in private ones.",
    ].join("\n\n");
    const { response } = await dialog.showMessageBox(parent, {
      type: "question",
      buttons: ["Add extension", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Add extension",
      message: `Add “${name}” to Moon Browser?`,
      detail,
      icon: icon.isEmpty() ? undefined : icon.resize({ width: 64, height: 64 }),
    });
    return response === 0;
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

  private async startWorker(extension: Extension): Promise<void> {
    const manifest = extension.manifest as {
      manifest_version?: number;
      background?: { service_worker?: string };
    };
    if (manifest.manifest_version !== 3 || !manifest.background?.service_worker) return;
    await this.session?.serviceWorkers
      .startWorkerForScope(`chrome-extension://${extension.id}`)
      .catch((err: unknown) =>
        this.recordError(
          extension.id,
          `The service worker didn't start: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
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
    for (const ext of await this.installed()) {
      const messages = await this.messages(ext);
      const text = (v: unknown) => (typeof v === "string" ? localize(v, messages) : "");
      const iconPath = pickIcon(ext.manifest, 48);
      const iconFile = iconPath ? inside(ext.path, iconPath) : null;
      const image = iconFile ? nativeImage.createFromPath(iconFile) : null;
      out.push({
        id: ext.id,
        name: text(ext.manifest.name) || ext.id,
        version: String(ext.manifest.version),
        description: text(ext.manifest.description),
        enabled: !!ses?.extensions.getExtension(ext.id),
        icon:
          image && !image.isEmpty() ? image.resize({ width: 48, height: 48 }).toDataURL() : null,
        hasOptions: optionsPage(ext.manifest) !== null,
        permissions: describePermissions(ext.manifest),
        unsupported: unsupportedFeatures(ext.manifest),
        errors: this.errors.get(ext.id) ?? [],
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
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
    this.setDisabled(id, !enabled);
    if (!enabled) {
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
    } else {
      const ext = (await this.installed()).find((e) => e.id === id);
      if (ext) await this.load(ext);
    }
    this.changed();
  }

  async remove(id: string): Promise<void> {
    const ses = this.session;
    if (!ses || !EXTENSION_ID.test(id)) return;
    await uninstallExtension(id, { session: ses, extensionsPath: this.path });
    // Its storage goes with it, as in Chrome.
    await ses.clearStorageData({ origin: `chrome-extension://${id}` }).catch(() => undefined);
    this.setDisabled(id, false);
    this.errors.delete(id);
    this.changed();
  }

  /** Opens the extension's settings page in a tab of a normal window. */
  async openOptions(id: string): Promise<void> {
    if (!EXTENSION_ID.test(id)) return;
    const ext = (await this.installed()).find((e) => e.id === id);
    const page = ext && optionsPage(ext.manifest);
    if (!page || !this.session?.extensions.getExtension(id)) return;
    const win = this.windowFor(undefined);
    win.openTab({ url: `chrome-extension://${id}/${page.replace(/^\/+/, "")}` });
    win.win.focus();
  }

  /** Whether a loaded extension declared `permission` in its manifest. */
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
          void dialog
            .showMessageBox(win.win, {
              type: "question",
              buttons: ["Remove", "Cancel"],
              defaultId: 1,
              cancelId: 1,
              noLink: true,
              title: "Remove extension",
              message: `Remove “${entry.name}”?`,
              detail: "Its data in Moon Browser is deleted with it.",
            })
            .then(({ response }) => {
              if (response === 0) void this.remove(id);
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
    kind: "onCreated" | "onUpdated" | "onRemoved",
    win: MoonWindow,
    group: TabGroupInfo,
  ): void {
    if (win.isPrivate) return;
    this.apis?.emitAll(`tabGroups.${kind}`, "tabGroups", groupInfo(win, group));
  }

  // ---- Errors ----

  recordError(id: string, text: string): void {
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
