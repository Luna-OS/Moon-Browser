/**
 * Luma — the web, calmly under the moon.
 *
 * Entry point of the main process: app-wide hardening, the single-instance
 * lock, and the start of the browser.
 */
import { app, Menu } from "electron";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LaunchQueue } from "@shared/launch";
import { installAppMenu } from "./app-menu";
import { Browser } from "./browser";
import { cookiesEncrypted, moveCookieStore } from "./cookie-store";
import { applyEngineSettings, prepareProtectedContent } from "./engine-settings";
import { registerIpc } from "./ipc";
import { registerSchemes } from "./protocol";

// A separate profile folder, e.g. for tests or a portable setup.
if (process.env.MOON_BROWSER_PROFILE)
  app.setPath("userData", resolve(process.env.MOON_BROWSER_PROFILE));

// Windows groups taskbar entries and notifications by this ID.
if (process.platform === "win32") app.setAppUserModelId("io.lunaos.moonbrowser");

registerSchemes();
// Every renderer — the UI, internal pages and web pages — runs sandboxed
// (each also asks for it in its webPreferences). Only an explicit
// --no-sandbox, as containers and CI machines running as root need it,
// turns the app-wide switch off.
if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();
// No menu bar on Windows and Linux; macOS gets its own (app-menu.ts).
if (process.platform !== "darwin") Menu.setApplicationMenu(null);

// FedCM ("Sign in with Google" and others through the browser's own account
// chooser): Chromium offers the API, but Electron has no account chooser
// behind it, so every request fails and the sign-in button stops working.
// Without the API, as in Firefox and Safari, sites use their pop-up instead.
{
  const disabled = app.commandLine.getSwitchValue("disable-features");
  app.commandLine.appendSwitch("disable-features", [disabled, "FedCm"].filter(Boolean).join(","));
}

// A bug in one feature must never stop the whole browser with a modal
// error box (Electron's default): log it and keep going.
process.on("uncaughtException", (err) => console.error("[moon] uncaught exception:", err));
process.on("unhandledRejection", (err) => console.error("[moon] unhandled rejection:", err));

/** Web addresses and local files passed on the command line. */
function urlsFromArgv(argv: string[]): string[] {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const urls: string[] = [];
  for (const arg of args) {
    if (!arg || arg.startsWith("-")) continue;
    if (/^https?:\/\//i.test(arg) || /^file:\/\//i.test(arg)) {
      urls.push(arg);
    } else if (/\.(html?|xhtml|svg|pdf|txt|png|jpe?g|gif|webp)$/i.test(arg) && existsSync(arg)) {
      urls.push(pathToFileURL(resolve(arg)).href);
    }
  }
  return urls;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const browser = new Browser();
  // A cookie store written encrypted is unreadable where cookies aren't
  // encrypted (Windows since 0.1.22): start a new one, once.
  {
    const stats = browser.profile.stats.get();
    if (!cookiesEncrypted(process.platform, app.isPackaged) && !stats.unencryptedCookies) {
      if (moveCookieStore(app.getPath("userData")))
        console.log("[moon] cookies were stored encrypted; starting a new cookie store");
      stats.unencryptedCookies = true;
      browser.profile.stats.changed();
    }
  }
  // Hardware acceleration and protected content, as set in Settings → System.
  applyEngineSettings(browser.startedWith);

  // macOS hands over links (Luma as the default browser) and files
  // as events, not on the command line — the first ones before the browser
  // is ready, so they wait for it.
  const launched = new LaunchQueue();
  app.on("open-url", (event, url) => {
    event.preventDefault();
    launched.add(url);
  });
  app.on("open-file", (event, path) => {
    event.preventDefault();
    if (existsSync(path)) launched.add(pathToFileURL(resolve(path)).href);
  });

  app.on("second-instance", (_event, argv) => {
    const urls = urlsFromArgv(argv);
    if (urls.length) browser.openExternalUrls(urls);
    else if (browser.windows.size === 0) browser.createWindow({});
    else {
      const win = browser.focusedWindow();
      if (win?.win.isMinimized()) win.win.restore();
      win?.win.focus();
    }
  });

  // Spell checking starts switched off in every session, before anything
  // loads: on Linux it would fetch dictionaries from Google's servers. The
  // browsing sessions switch it on only when the user chose to.
  app.on("session-created", (ses) => {
    ses.setSpellCheckerEnabled(false);
    if (process.platform === "linux") ses.setSpellCheckerLanguages([]);
  });

  app.on("web-contents-created", (_event, contents) => {
    // No <webview> tags anywhere.
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // macOS: a click on the Dock icon with every window closed opens a new
  // one — once the browser has started, which opens its own.
  let started = false;
  app.on("activate", () => {
    if (started && browser.windows.size === 0) browser.createWindow({});
  });

  let siteDataCleared = false;
  app.on("before-quit", (event) => {
    browser.quit();
    if (browser.settings.clearOnExit && !siteDataCleared) {
      // Hold the quit until cookies and site data are gone.
      event.preventDefault();
      siteDataCleared = true;
      void browser
        .clearSiteDataOnExit()
        .catch((err: unknown) => console.error("[moon] clearing site data failed:", err))
        .finally(() => app.quit());
    }
  });

  void app.whenReady().then(async () => {
    // The Widevine module installs in the background: a first start behind a
    // slow connection doesn't wait for it with an empty screen.
    prepareProtectedContent(browser.startedWith);
    await browser.init();
    registerIpc(browser);
    installAppMenu(browser);
    const early = launched.ready((urls) => browser.openExternalUrls(urls));
    browser.restoreOrOpen([...urlsFromArgv(process.argv), ...early]);
    started = true;
  });
}
