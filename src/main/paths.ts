import { app } from "electron";
import { join } from "node:path";

/** Where the built app lives (the app.asar when packaged). */
export const appRoot = app.getAppPath();
export const rendererDir = join(appRoot, "out", "renderer");
export const uiPreload = join(appRoot, "out", "preload", "ui.cjs");
export const internalPreload = join(appRoot, "out", "preload", "internal.cjs");
export const adblockPreload = join(appRoot, "out", "preload", "adblock-cosmetics.cjs");
export const adblockWorker = join(appRoot, "out", "main", "adblock-worker.cjs");
export const windowIcon = join(appRoot, "build", "icons", "512x512.png");

export function profilePath(...parts: string[]): string {
  return join(app.getPath("userData"), ...parts);
}
