/**
 * Site permissions. Harmless capabilities (fullscreen, writing to the
 * clipboard, …) are granted, device access without a chooser is refused,
 * and everything personal — camera, microphone, location, notifications,
 * reading the clipboard, opening other apps, pop-ups without a click — is
 * asked for in a bar above the page. Decisions can be remembered per site;
 * in private windows only until the window closes.
 */
import type {
  PermissionCheckHandlerHandlerDetails,
  PermissionRequest,
  Session,
  WebContents,
} from "electron";
import { originOf } from "@shared/sites";
import type { PermissionKind, PermissionPrompt } from "@shared/types";
import type { Browser } from "./browser";
import type { Tab } from "./tab";

type Decision = "allow" | "deny";

const ALWAYS_ALLOWED = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock",
  "keyboardLock",
  "speaker-selection",
  "persistent-storage",
  "background-sync",
  "fileSystem",
  "midi",
]);

/** Web permissions an extension gets by declaring them in its manifest. */
const EXTENSION_PERMISSIONS: Record<string, string> = {
  "clipboard-read": "clipboardRead",
  notifications: "notifications",
  geolocation: "geolocation",
};

/** The extension a page or worker belongs to, from its origin. */
function extensionIdOf(origin: string): string | null {
  const m = /^chrome-extension:\/\/([a-p]{32})(\/|$)/.exec(origin);
  return m ? m[1] : null;
}

interface Pending {
  prompt: PermissionPrompt;
  resolvers: ((allow: boolean) => void)[];
  private: boolean;
}

export class Permissions {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Remembered decisions of private windows, gone when the app quits. */
  private readonly privateDecisions = new Map<string, Decision>();

  constructor(private readonly browser: Browser) {}

  install(ses: Session, isPrivate: boolean): void {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      void this.onRequest(wc, permission, details, isPrivate).then(callback, () => callback(false));
    });
    ses.setPermissionCheckHandler((wc, permission, origin, details) =>
      this.onCheck(wc, permission, origin, details, isPrivate),
    );
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  }

  prompts(tabIds: ReadonlySet<number>): PermissionPrompt[] {
    return [...this.pending.values()].map((p) => p.prompt).filter((p) => tabIds.has(p.tabId));
  }

  respond(id: number, allow: boolean, remember: boolean): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    const { prompt } = entry;
    if (remember && prompt.kind !== "open-external") {
      const kinds: PermissionKind[] =
        prompt.kind === "camera-microphone" ? ["camera", "microphone"] : [prompt.kind];
      for (const kind of kinds)
        this.remember(prompt.origin, kind, allow ? "allow" : "deny", entry.private);
    }
    for (const resolve of entry.resolvers) resolve(allow);
    if (prompt.kind === "popup" && allow && prompt.detail) {
      const tab = this.browser.tabById(prompt.tabId);
      tab?.window.openTab({ url: prompt.detail, openerId: tab.id });
    }
    this.browser.tabById(prompt.tabId)?.window.update();
  }

  /** Drops the questions of a tab that navigated away or closed. */
  cancelTab(tabId: number): void {
    let changed = false;
    for (const [id, entry] of this.pending) {
      if (entry.prompt.tabId !== tabId) continue;
      this.pending.delete(id);
      for (const resolve of entry.resolvers) resolve(false);
      changed = true;
    }
    if (changed) this.browser.tabById(tabId)?.window.update();
  }

  popupsAllowed(tab: Tab, origin: string): boolean {
    return this.decision(origin, "popup", tab.window.isPrivate) === "allow";
  }

  /** A pop-up without a click: ask whether to open it after all. */
  blockedPopup(tab: Tab, url: string): void {
    const origin = originOf(tab.url);
    if (this.decision(origin, "popup", tab.window.isPrivate) === "deny") return;
    // One question per page is enough.
    for (const p of this.pending.values()) {
      if (p.prompt.tabId === tab.id && p.prompt.kind === "popup") return;
    }
    this.ask(tab, "popup", origin, url).catch(() => undefined);
  }

  private decision(origin: string, kind: PermissionKind, isPrivate: boolean): Decision | undefined {
    const key = `${origin} ${kind}`;
    if (isPrivate && this.privateDecisions.has(key)) return this.privateDecisions.get(key);
    return this.browser.profile.permission(origin, kind);
  }

  private remember(
    origin: string,
    kind: PermissionKind,
    decision: Decision,
    isPrivate: boolean,
  ): void {
    if (isPrivate) this.privateDecisions.set(`${origin} ${kind}`, decision);
    else this.browser.profile.setPermission(origin, kind, decision);
  }

  private ask(tab: Tab, kind: PermissionKind, origin: string, detail?: string): Promise<boolean> {
    if (kind === "camera-microphone") {
      const cam = this.decision(origin, "camera", tab.window.isPrivate);
      const mic = this.decision(origin, "microphone", tab.window.isPrivate);
      if (cam && mic) return Promise.resolve(cam === "allow" && mic === "allow");
    } else if (kind !== "open-external") {
      const stored = this.decision(origin, kind, tab.window.isPrivate);
      if (stored) return Promise.resolve(stored === "allow");
    }
    return new Promise((resolve) => {
      for (const p of this.pending.values()) {
        const same = p.prompt;
        if (
          same.tabId === tab.id &&
          same.kind === kind &&
          same.origin === origin &&
          same.detail === detail
        ) {
          p.resolvers.push(resolve);
          return;
        }
      }
      const prompt: PermissionPrompt = { id: this.nextId++, tabId: tab.id, origin, kind, detail };
      this.pending.set(prompt.id, { prompt, resolvers: [resolve], private: tab.window.isPrivate });
      tab.window.update();
    });
  }

  /** Extensions get what their manifest declares; null for anything that isn't an extension. */
  private forExtension(origin: string, permission: string): boolean | null {
    const id = extensionIdOf(origin);
    if (!id) return null;
    if (ALWAYS_ALLOWED.has(permission)) return true;
    const declared = EXTENSION_PERMISSIONS[permission];
    return !!declared && this.browser.extensions.declares(id, declared);
  }

  private async onRequest(
    wc: WebContents,
    permission: string,
    details: PermissionRequest,
    isPrivate: boolean,
  ): Promise<boolean> {
    if (!isPrivate) {
      const forExtension = this.forExtension(details.requestingUrl || wc.getURL(), permission);
      if (forExtension !== null) return forExtension;
    }
    const tab = this.browser.tabFor(wc.id);
    if (!tab || tab.window.isPrivate !== isPrivate) return false;
    if (ALWAYS_ALLOWED.has(permission)) return true;
    const origin = originOf(details.requestingUrl || tab.url);
    if (!/^https?:\/\//.test(origin)) return false;

    switch (permission) {
      case "media": {
        const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
        const video = types.includes("video");
        const audio = types.includes("audio");
        if (!video && !audio) return false;
        return this.ask(
          tab,
          video && audio ? "camera-microphone" : video ? "camera" : "microphone",
          origin,
        );
      }
      case "geolocation":
        return this.ask(tab, "geolocation", origin);
      case "notifications":
        return this.ask(tab, "notifications", origin);
      case "clipboard-read":
        return this.ask(tab, "clipboard-read", origin);
      case "openExternal": {
        const external = (details as { externalURL?: string }).externalURL ?? "";
        // Only real app links, never file:// or javascript: in disguise.
        if (
          !/^[a-z][a-z0-9+.-]*:/i.test(external) ||
          /^(file|javascript|data|vbscript):/i.test(external)
        ) {
          return false;
        }
        return this.ask(tab, "open-external", origin, external);
      }
      default:
        return false;
    }
  }

  private onCheck(
    wc: WebContents | null,
    permission: string,
    requestingOrigin: string,
    details: PermissionCheckHandlerHandlerDetails,
    isPrivate: boolean,
  ): boolean {
    if (!isPrivate) {
      const forExtension = this.forExtension(requestingOrigin, permission);
      if (forExtension !== null) return forExtension;
    }
    if (!wc) return false;
    const tab = this.browser.tabFor(wc.id);
    if (!tab) return false;
    if (ALWAYS_ALLOWED.has(permission)) return true;
    const origin = originOf(requestingOrigin);
    switch (permission) {
      case "media": {
        const kind =
          details.mediaType === "video"
            ? "camera"
            : details.mediaType === "audio"
              ? "microphone"
              : null;
        return kind !== null && this.decision(origin, kind, isPrivate) === "allow";
      }
      case "geolocation":
      case "notifications":
      case "clipboard-read":
        return this.decision(origin, permission, isPrivate) === "allow";
      default:
        return false;
    }
  }
}
