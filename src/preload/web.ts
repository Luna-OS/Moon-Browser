/**
 * Runs in every page and service worker of the browsing sessions, before
 * their own scripts:
 *
 * - The Badging API (navigator.setAppBadge) answers as in Chrome for sites
 *   that aren't installed apps — it resolves and does nothing. Electron
 *   would put every site's unread count ("99+") on Moon Browser's taskbar
 *   icon.
 * - alert(), confirm() and prompt() ask in Moon Browser's own dialog over
 *   the tab (page-dialogs.ts), not in the system's message box.
 */
import { contextBridge, ipcRenderer } from "electron";
import { PAGE_DIALOG_CHANNEL, type PageDialogKind, type PageDialogReply } from "@shared/ipc";

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
