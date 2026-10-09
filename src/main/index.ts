/**
 * Moon Browser — the web, calmly under the moon.
 *
 * Entry point of the main process: app-wide hardening, the single-instance
 * lock, and the start of the browser.
 */
import { app, Menu } from "electron";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Browser } from "./browser";
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
Menu.setApplicationMenu(null);

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
  // Hardware acceleration and protected content, as set in Settings → System.
  applyEngineSettings(browser.startedWith);

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

  app.on("activate", () => {
    if (browser.windows.size === 0) browser.createWindow({});
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
    await Promise.all([browser.init(), prepareProtectedContent(browser.startedWith)]);
    registerIpc(browser);
    browser.restoreOrOpen(urlsFromArgv(process.argv));
  });
}
