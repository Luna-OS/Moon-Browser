/**
 * The right-click menu of pages: links, images, selected text, editable
 * fields — the essentials, without the noise.
 */
import {
  clipboard,
  Menu,
  MenuItem,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from "electron";
import { searchUrl } from "@shared/engines";
import { isInternalUrl } from "@shared/internal";
import type { Tab } from "./tab";

const trimmed = (text: string, max = 32) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function showPageMenu(tab: Tab, params: ContextMenuParams): void {
  const wc = tab.wc;
  if (!wc) return;
  const win = tab.window;
  const browser = win.browser;
  const items: MenuItemConstructorOptions[] = [];
  const section = (entries: MenuItemConstructorOptions[]) => {
    if (!entries.length) return;
    if (items.length) items.push({ type: "separator" });
    items.push(...entries);
  };

  const link = params.linkURL && /^(https?|file|moon):/i.test(params.linkURL) ? params.linkURL : "";
  if (link) {
    const web = !isInternalUrl(link);
    section([
      {
        label: "Open link in new tab",
        click: () => win.openTab({ url: link, background: true, openerId: tab.id }),
      },
      {
        label: "Open link in new window",
        visible: web,
        click: () => browser.createWindow({ urls: [link] }),
      },
      {
        label: "Open link in private window",
        visible: web,
        click: () => browser.createWindow({ private: true, urls: [link] }),
      },
      { label: "Save link as…", visible: web, click: () => wc.downloadURL(link) },
      { label: "Copy link address", click: () => void clipboard.writeText(link) },
    ]);
  }

  if (params.mediaType === "image" && params.srcURL) {
    section([
      {
        label: "Open image in new tab",
        visible: /^https?:/i.test(params.srcURL),
        click: () => win.openTab({ url: params.srcURL, background: true, openerId: tab.id }),
      },
      { label: "Save image as…", click: () => wc.downloadURL(params.srcURL) },
      { label: "Copy image", click: () => wc.copyImageAt(params.x, params.y) },
      {
        label: "Copy image address",
        visible: !params.srcURL.startsWith("data:"),
        click: () => void clipboard.writeText(params.srcURL),
      },
    ]);
  }

  if ((params.mediaType === "video" || params.mediaType === "audio") && params.srcURL) {
    section([
      {
        label: params.mediaFlags.isPaused ? "Play" : "Pause",
        click: () =>
          void wc
            .executeJavaScript(
              `(() => { const m = document.elementFromPoint(${Math.round(params.x)}, ${Math.round(params.y)}); if (m && "paused" in m) { m.paused ? m.play() : m.pause(); } })()`,
              true,
            )
            .catch(() => undefined),
      },
      {
        label: "Save as…",
        visible: /^https?:/i.test(params.srcURL),
        click: () => wc.downloadURL(params.srcURL),
      },
      { label: "Copy address", click: () => void clipboard.writeText(params.srcURL) },
    ]);
  }

  if (params.isEditable) {
    const suggestions = params.dictionarySuggestions
      .slice(0, 4)
      .map((word): MenuItemConstructorOptions => ({
        label: word,
        click: () => wc.replaceMisspelling(word),
      }));
    if (params.misspelledWord) {
      section([
        ...(suggestions.length ? suggestions : [{ label: "No suggestions", enabled: false }]),
        {
          label: "Add to dictionary",
          click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
      ]);
    }
    section([
      { label: "Undo", role: "undo", enabled: params.editFlags.canUndo },
      { label: "Redo", role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
      { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
      { label: "Paste", role: "paste", enabled: params.editFlags.canPaste },
      {
        label: "Paste as plain text",
        role: "pasteAndMatchStyle",
        enabled: params.editFlags.canPaste,
      },
      { label: "Select all", role: "selectAll", enabled: params.editFlags.canSelectAll },
    ]);
  } else if (params.selectionText.trim()) {
    const text = params.selectionText.trim();
    const engine = browser.engine();
    section([
      { label: "Copy", role: "copy" },
      {
        label: `Search ${engine.name} for “${trimmed(text)}”`,
        click: () => win.openTab({ url: searchUrl(engine, text), openerId: tab.id }),
      },
    ]);
  }

  if (!link && !params.isEditable && !params.selectionText.trim() && params.mediaType === "none") {
    const nav = wc.navigationHistory;
    section([
      { label: "Back", enabled: nav.canGoBack(), click: () => tab.back() },
      { label: "Forward", enabled: nav.canGoForward(), click: () => tab.forward() },
      { label: "Reload", click: () => tab.reload() },
    ]);
    section([
      {
        label: "Save page as…",
        visible: /^https?:/.test(tab.url),
        click: () => wc.downloadURL(tab.url),
      },
      { label: "Print…", click: () => wc.print() },
      {
        label: "View page source",
        visible: /^https?:/.test(tab.url),
        click: () => win.openTab({ url: `view-source:${tab.url}`, openerId: tab.id }),
      },
    ]);
  }

  // Items the extensions added with chrome.contextMenus.
  const extensionItems = win.isPrivate ? [] : browser.extensions.contextMenuItems(wc, params);

  section([{ label: "Inspect", click: () => wc.inspectElement(params.x, params.y) }]);

  const menu = Menu.buildFromTemplate(items.filter((i) => i.visible !== false));
  if (extensionItems.length) {
    // Just above "Inspect", in a group of their own.
    const at = Math.max(0, menu.items.length - 2);
    extensionItems.forEach((item, i) => menu.insert(at + i, item));
    menu.insert(at, new MenuItem({ type: "separator" }));
  }
  menu.popup({ window: win.win });
}
