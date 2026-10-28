/**
 * Settings that change how Chromium itself starts, so they take effect after
 * a restart: hardware acceleration, WebGPU everywhere and protected content.
 *
 * WebGPU everywhere is Chrome's "Unsafe WebGPU Support" flag: WebGPU for
 * pages (3D sites, games) also on graphics cards Chromium keeps it from and
 * on Linux, where it hasn't shipped it. Off unless switched on: a driver
 * Chromium distrusts can make such pages crash.
 *
 * Protected content is DRM (Encrypted Media Extensions with Widevine), which
 * Netflix, Disney+, Prime Video and Spotify need. Luma is built on
 * castLabs' Electron for Content Security, which installs Google's Widevine
 * module through Chromium's component updater and keeps it up to date. With
 * the setting off, the component updater never runs (nothing is downloaded
 * from Google) and sites are refused the media keys (src/main/permissions.ts).
 */
import type { Settings } from "@shared/types";
import { app, components } from "electron";

export type EngineSettings = Pick<
  Settings,
  "protectedContent" | "hardwareAcceleration" | "webgpuEverywhere"
>;

/** Must run before the app is ready. */
export function applyEngineSettings(settings: EngineSettings): void {
  if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();
  else if (settings.webgpuEverywhere) app.commandLine.appendSwitch("enable-unsafe-webgpu");
  if (!settings.protectedContent) app.commandLine.appendSwitch("disable-component-update");
}

/**
 * Installs the Widevine module on the first start (and loads it on later
 * ones), right away rather than on the component updater's delay. Nothing
 * waits for it: offline, or with a slow connection, the browser starts
 * anyway and the module follows when it's there.
 */
export function prepareProtectedContent(settings: EngineSettings): void {
  if (!settings.protectedContent || typeof components?.whenReady !== "function") return;
  void components.whenReady().then(
    () => console.log("[moon] protected content ready:", components.status()),
    (err: unknown) => console.warn("[moon] the Widevine module isn't available:", err),
  );
}

/** Whether a changed setting waits for a restart. */
export function engineSettingsChanged(started: EngineSettings, now: Settings): boolean {
  return (
    started.protectedContent !== now.protectedContent ||
    started.hardwareAcceleration !== now.hardwareAcceleration ||
    started.webgpuEverywhere !== now.webgpuEverywhere
  );
}
