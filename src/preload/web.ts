/**
 * Runs in every page and service worker of the browsing sessions, before
 * their own scripts:
 *
 * - `window.chrome` gets Chrome's own members (chrome-object.ts): Electron
 *   leaves it empty, and Google's sign-in turns such a browser away.
 * - The Badging API (navigator.setAppBadge) answers as in Chrome for sites
 *   that aren't installed apps — it resolves and does nothing. Electron
 *   would put every site's unread count ("99+") on Moon Browser's taskbar
 *   icon.
 * - alert(), confirm() and prompt() ask in Moon Browser's own dialog over
 *   the tab (page-dialogs.ts), not in the system's message box.
 * - Permissions nobody decided yet read as undecided, as in Chrome
 *   (permissions.ts): Notification.permission "default" and
 *   navigator.permissions "prompt", where Electron says "denied".
 */
import { contextBridge, ipcRenderer } from "electron";
import { completeChromeObject } from "@shared/chrome-object";
import {
  PAGE_DIALOG_CHANNEL,
  PERMISSION_STATE_CHANNEL,
  type PageDialogKind,
  type PageDialogReply,
  type PermissionState,
} from "@shared/ipc";

if (typeof window !== "undefined") contextBridge.executeInMainWorld({ func: completeChromeObject });

/** Whether a permission of this page is still to be asked for (see permissions.ts). */
function permissionState(name: string): PermissionState {
  try {
    return ipcRenderer.sendSync(PERMISSION_STATE_CHANNEL, name) as PermissionState;
  } catch {
    return "deny";
  }
}

// Runs in the page's world (serialized: everything it needs is inside).
function undecidedPermissions(state: typeof permissionState): void {
  const g = globalThis as unknown as {
    Notification?: object;
    PermissionStatus?: { prototype: object };
  };
  /** Swaps a getter's "denied" for `undecided` while nobody has decided. */
  const wrap = (
    owner: object | undefined,
    property: string,
    undecided: string,
    nameOf: (self: unknown) => string,
  ) => {
    const descriptor = owner ? Object.getOwnPropertyDescriptor(owner, property) : undefined;
    const original: unknown = descriptor ? Reflect.get(descriptor, "get") : undefined;
    if (!owner || !descriptor || typeof original !== "function") return;
    // A proxy keeps the getter's name, length and native look.
    const get = new Proxy(original as (this: unknown) => unknown, {
      apply(target, self: unknown, args: unknown[]): unknown {
        const value: unknown = Reflect.apply(target, self, args);
        return value === "denied" && state(nameOf(self)) === "ask" ? undecided : value;
      },
    });
    Object.defineProperty(owner, property, { ...descriptor, get });
  };
  wrap(g.Notification, "permission", "default", () => "notifications");
  wrap(g.PermissionStatus?.prototype, "state", "prompt", (self) =>
    String((self as { name?: unknown }).name),
  );
}

if (typeof window !== "undefined")
  contextBridge.executeInMainWorld({ func: undecidedPermissions, args: [permissionState] });

function quietBadges(): void {
  const g = globalThis as {
    Navigator?: { prototype: object };
    WorkerNavigator?: { prototype: object };
  };
  for (const proto of [g.Navigator?.prototype, g.WorkerNavigator?.prototype]) {
    if (!proto) continue;
    for (const name of ["setAppBadge", "clearAppBadge"]) {
      const original = (proto as Record<string, unknown>)[name];
      if (typeof original !== "function") continue;
      // A proxy keeps the function's name, length and native look.
      const quiet = new Proxy(original, { apply: () => Promise.resolve() });
      Object.defineProperty(proto, name, {
        value: quiet,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
}

contextBridge.executeInMainWorld({ func: quietBadges });

/** Asks the browser and waits for the answer, as the real dialogs make the page wait. */
function askBrowser(kind: PageDialogKind, message: string, value: string): PageDialogReply {
  try {
    return ipcRenderer.sendSync(PAGE_DIALOG_CHANNEL, kind, message, value) as PageDialogReply;
  } catch {
    return { native: true };
  }
}

// Runs in the page's world (serialized: everything it needs is inside).
function moonDialogs(ask: typeof askBrowser): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const wrap = (kind: PageDialogKind) => {
    const original = g[kind];
    if (typeof original !== "function") return;
    // A proxy keeps the function's name, length and native look.
    const replacement = new Proxy(original, {
      apply(target, thisArg, args: unknown[]) {
        // Turned into text as the real ones do it (which may throw, as there).
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- what the real ones do
        const text = (v: unknown) => (v === undefined ? "" : String(v));
        const message = args.length ? text(args[0]) : "";
        const value = kind === "prompt" && args.length > 1 ? text(args[1]) : "";
        const reply = ask(kind, message, value);
        if ("native" in reply)
          return Reflect.apply(target as () => unknown, thisArg, args) as unknown;
        if (kind === "alert") return undefined;
        if (kind === "confirm") return reply.ok;
        return reply.ok ? reply.text : null;
      },
    });
    Object.defineProperty(g, kind, {
      value: replacement,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
  wrap("alert");
  wrap("confirm");
  wrap("prompt");
}

if (typeof window !== "undefined")
  contextBridge.executeInMainWorld({ func: moonDialogs, args: [askBrowser] });
