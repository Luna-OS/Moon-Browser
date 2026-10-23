/**
 * The menu bar on macOS. Without one, macOS has no Cmd+C, Cmd+V, Cmd+Z or
 * Cmd+Q: editing in text fields and quitting go through the menu there.
 * Windows and Linux have no menu bar (the ☰ menu is Moon Browser's own).
 *
 * Keys pressed in a window are handled before they reach the menu
 * (src/shared/shortcuts.ts), so its items only act when no browser window
 * has the keyboard: with every window closed, or from DevTools.
 */
import { app, Menu, webContents, type MenuItemConstructorOptions } from "electron";
import { internalUrl } from "@shared/internal";
import type { UiCommand } from "@shared/ipc";
import type { Browser } from "./browser";

const HOMEPAGE = "https://github.com/Luna-OS/Moon-Browser";

export function installAppMenu(browser: Browser): void {
  if (process.platform !== "darwin") return;

  /** Runs a command in the window in front, opening one if every window is closed. */
  const run = (cmd: UiCommand) => {
    const win = browser.focusedWindow();
    if (win) {
      win.command(cmd);
      return;
    }
    if (cmd.type === "newPrivateWindow") browser.createWindow({ private: true });
    else if (cmd.type === "openPage") browser.createWindow({ urls: [internalUrl(cmd.page)] });
    else if (cmd.type === "openUrl") browser.createWindow({ urls: [cmd.url] });
    else if (cmd.type === "newTab" || cmd.type === "newWindow" || cmd.type === "focusAddressBar")
      browser.createWindow({});
  };
  const item = (
    label: string,
    accelerator: string | undefined,
    cmd: UiCommand,
  ): MenuItemConstructorOptions => ({ label, accelerator, click: () => run(cmd) });
  type Page = Extract<UiCommand, { type: "openPage" }>["page"];
  const page = (label: string, accelerator: string | undefined, name: Page) =>
    item(label, accelerator, { type: "openPage", page: name });
  const link = (label: string, url: string) =>
    item(label, undefined, { type: "openUrl", url, disposition: "foreground" });
  const sep: MenuItemConstructorOptions = { type: "separator" };

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        link("About Moon Browser", "moon://about/"),
        sep,
        page("Settings…", "Cmd+,", "settings"),
        page("Extensions", undefined, "extensions"),
        sep,
        { role: "services" },
        sep,
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        sep,
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        item("New Tab", "Cmd+T", { type: "newTab" }),
        item("New Window", "Cmd+N", { type: "newWindow" }),
        item("New Private Window", "Shift+Cmd+N", { type: "newPrivateWindow" }),
        item("Reopen Closed Tab", "Shift+Cmd+T", { type: "reopenClosedTab" }),
        item("Open Location…", "Cmd+L", { type: "focusAddressBar" }),
        sep,
        { role: "close", label: "Close Window", accelerator: "Shift+Cmd+W" },
        {
          label: "Close Tab",
          accelerator: "Cmd+W",
          click: () => {
            // In DevTools, Cmd+W closes DevTools, as in Chrome.
            const inspected = webContents
              .getAllWebContents()
              .find((wc) => !wc.isDestroyed() && wc.isDevToolsOpened() && wc.isDevToolsFocused());
            if (inspected) inspected.closeDevTools();
            else run({ type: "closeTab" });
          },
        },
        sep,
        item("Print…", "Cmd+P", { type: "print" }),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        sep,
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        sep,
        item("Find…", "Cmd+F", { type: "find" }),
        item("Find Next", "Cmd+G", { type: "findNext" }),
        item("Find Previous", "Shift+Cmd+G", { type: "findPrevious" }),
        sep,
        { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
      ],
    },
    {
      label: "View",
      submenu: [
        item("Show or Hide Bookmarks Bar", "Shift+Cmd+B", { type: "toggleBookmarksBar" }),
        sep,
        item("Reload", "Cmd+R", { type: "reload" }),
        item("Reload Without Cache", "Shift+Cmd+R", { type: "hardReload" }),
        sep,
        item("Zoom In", "Cmd+Plus", { type: "zoomIn" }),
        item("Zoom Out", "Cmd+-", { type: "zoomOut" }),
        item("Actual Size", "Cmd+0", { type: "zoomReset" }),
        sep,
        { role: "togglefullscreen" },
        sep,
        {
          label: "Developer",
          submenu: [
            item("View Source", "Alt+Cmd+U", { type: "viewSource" }),
            item("Developer Tools", "Alt+Cmd+I", { type: "devtools" }),
          ],
        },
      ],
    },
    {
      label: "History",
      submenu: [
        item("Back", "Cmd+[", { type: "back" }),
        item("Forward", "Cmd+]", { type: "forward" }),
        item("Home", "Shift+Cmd+H", { type: "home" }),
        sep,
        page("Show All History", "Cmd+Y", "history"),
      ],
    },
    {
      label: "Bookmarks",
      submenu: [
        item("Bookmark This Page…", "Cmd+D", { type: "bookmark" }),
        page("Bookmark Manager", "Alt+Cmd+B", "bookmarks"),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        sep,
        item("Select Next Tab", "Alt+Cmd+Right", { type: "nextTab" }),
        item("Select Previous Tab", "Alt+Cmd+Left", { type: "previousTab" }),
        sep,
        page("Downloads", "Alt+Cmd+L", "downloads"),
        sep,
        { role: "front" },
      ],
    },
    {
      role: "help",
      submenu: [
        link("Moon Browser on GitHub", HOMEPAGE),
        link("Report a Problem", `${HOMEPAGE}/issues`),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  app.dock?.setMenu(
    Menu.buildFromTemplate([
      { label: "New Window", click: () => browser.createWindow({}) },
      { label: "New Private Window", click: () => browser.createWindow({ private: true }) },
    ]),
  );
}
