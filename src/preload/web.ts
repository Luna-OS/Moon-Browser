/**
 * Runs in every page and service worker of the browsing sessions, before
 * their own scripts: the Badging API (navigator.setAppBadge) answers as in
 * Chrome for sites that aren't installed apps — it resolves and does
 * nothing. Electron would put every site's unread count ("99+") on Moon
 * Browser's taskbar icon.
 */
import { contextBridge } from "electron";

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
