/**
 * chrome.proxy for extensions. Electron has the API but refuses every call;
 * here, as in Chrome, the extension that last set a proxy controls the
 * browsing session's proxy until it clears it, or is switched off or
 * removed. Private windows keep the system's settings.
 */
import type { Session } from "electron";
import { toElectronProxy } from "@shared/proxy";
import type { Browser } from "./browser";

const SYSTEM = { mode: "system" } as const;

export class ExtensionProxy {
  private session: Session | null = null;
  /** The controlling extension's setting is in effect (it is loaded). */
  private applied = false;

  constructor(private readonly browser: Browser) {}

  private get prefs() {
    return this.browser.profile.extensions.get();
  }

  attach(ses: Session): void {
    this.session = ses;
  }

  /** An extension was loaded: its saved proxy setting takes effect again. */
  loaded(id: string): void {
    const saved = this.prefs.proxy;
    if (saved?.id !== id) return;
    try {
      void this.session?.setProxy(toElectronProxy(saved.value));
      this.applied = true;
    } catch {
      this.forget(id);
    }
  }

  /** Switched off or removed: its setting stops applying. */
  unloaded(id: string): void {
    if (this.prefs.proxy?.id !== id || !this.applied) return;
    this.applied = false;
    void this.session?.setProxy(SYSTEM);
    this.changed();
  }

  forget(id: string): void {
    if (this.prefs.proxy?.id !== id) return;
    this.unloaded(id);
    delete this.prefs.proxy;
    this.browser.profile.extensions.changed();
    this.changed();
  }

  private details(id: string) {
    const saved = this.prefs.proxy;
    const controlled = saved && this.applied;
    return {
      value: controlled ? saved.value : SYSTEM,
      levelOfControl: !controlled
        ? "controllable_by_this_extension"
        : saved.id === id
          ? "controlled_by_this_extension"
          : "controlled_by_other_extensions",
    };
  }

  /** Tells the extensions that may read the proxy setting that it changed. */
  private changed(): void {
    const ext = this.browser.extensions;
    for (const id of ext.loadedIds())
      if (ext.declares(id, "proxy")) ext.emitTo(id, "proxy.settings.onChange", this.details(id));
  }

  async call(id: string, method: string, arg: unknown): Promise<unknown> {
    const opts = arg && typeof arg === "object" ? (arg as Record<string, unknown>) : {};
    if (typeof opts.scope === "string" && opts.scope.startsWith("incognito"))
      throw new Error("Extensions don't run in private windows");
    switch (method) {
      case "settings.get":
        return this.details(id);
      case "settings.set": {
        const config = toElectronProxy(opts.value);
        if (!this.session) throw new Error("Not ready");
        await this.session.setProxy(config);
        this.prefs.proxy = { id, value: opts.value };
        this.applied = true;
        this.browser.profile.extensions.changed();
        this.changed();
        return undefined;
      }
      case "settings.clear":
        if (this.prefs.proxy?.id === id) this.forget(id);
        return undefined;
      default:
        throw new Error(`chrome.proxy.${method} isn't available in Moon Browser`);
    }
  }
}
