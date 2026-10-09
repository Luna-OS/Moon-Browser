/**
 * Settings that change how Chromium itself starts, so they take effect after
 * a restart: hardware acceleration and protected content.
 *
 * Protected content is DRM (Encrypted Media Extensions with Widevine), which
 * Netflix, Disney+, Prime Video and Spotify need. Moon Browser is built on
 * castLabs' Electron for Content Security, which installs Google's Widevine
 * module through Chromium's component updater and keeps it up to date. With
 * the setting off, the component updater never runs (nothing is downloaded
 * from Google) and sites are refused the media keys (src/main/permissions.ts).
 */
import type { Settings } from "@shared/types";
import { app, components } from "electron";

export type EngineSettings = Pick<Settings, "protectedContent" | "hardwareAcceleration">;

/** Must run before the app is ready. */
export function applyEngineSettings(settings: EngineSettings): void {
  if (!settings.hardwareAcceleration) app.disableHardwareAcceleration();
  if (!settings.protectedContent) app.commandLine.appendSwitch("disable-component-update");
}

/**
 * Installs the Widevine module on the first start (and loads it on later
 * ones). Waits a few seconds at most: offline, or with a slow connection,
 * the browser starts anyway and the module follows when it's there.
 */
export async function prepareProtectedContent(settings: EngineSettings): Promise<void> {
  if (!settings.protectedContent || typeof components?.whenReady !== "function") return;
  const ready = components.whenReady().then(
    () => console.log("[moon] protected content ready:", components.status()),
    (err: unknown) => console.warn("[moon] the Widevine module isn't available:", err),
  );
  await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

/** Whether a changed setting waits for a restart. */
export function engineSettingsChanged(started: EngineSettings, now: Settings): boolean {
  return (
    started.protectedContent !== now.protectedContent ||
    started.hardwareAcceleration !== now.hardwareAcceleration
  );
}
