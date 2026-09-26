/**
 * Keyboard shortcuts. Keys are handled in the main process (before a page
 * sees them), so they work no matter whether the page or the toolbar has
 * the focus. The mapping is pure so it can be tested per platform.
 */

export type ShortcutCommand =
  | { type: "newTab" }
  | { type: "newWindow" }
  | { type: "newPrivateWindow" }
  | { type: "closeTab" }
  | { type: "reopenClosedTab" }
  | { type: "nextTab" }
  | { type: "previousTab" }
  | { type: "selectTab"; index: number }
  | { type: "selectLastTab" }
  | { type: "focusAddressBar" }
  | { type: "reload" }
  | { type: "hardReload" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "home" }
  | { type: "find" }
  | { type: "findNext" }
  | { type: "findPrevious" }
  | { type: "bookmark" }
  | { type: "openPage"; page: "history" | "downloads" | "bookmarks" | "settings" }
  | { type: "clearData" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" }
  | { type: "print" }
  | { type: "fullscreen" }
  | { type: "devtools" }
  | { type: "viewSource" }
  | { type: "toggleBookmarksBar" }
  | { type: "quit" };

export interface KeyInput {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function shortcutFor(input: KeyInput, platform: string): ShortcutCommand | null {
  if (input.type !== "keyDown") return null;
  const mac = platform === "darwin";
  const mod = mac ? input.meta : input.control;
  const other = mac ? input.control : input.meta;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const { shift, alt } = input;

  if (other) return null;

  if (mod && !alt) {
    if (!shift) {
      switch (key) {
        case "t":
          return { type: "newTab" };
        case "n":
          return { type: "newWindow" };
        case "w":
        case "F4":
          return { type: "closeTab" };
        case "Tab":
        case "PageDown":
          return { type: "nextTab" };
        case "PageUp":
          return { type: "previousTab" };
        case "l":
        case "k":
        case "e":
          return { type: "focusAddressBar" };
        case "r":
          return { type: "reload" };
        case "F5":
          return { type: "hardReload" };
        case "f":
          return { type: "find" };
        case "g":
          return { type: "findNext" };
        case "d":
          return { type: "bookmark" };
        case "h":
          return mac ? null : { type: "openPage", page: "history" };
        case "y":
          return mac ? { type: "openPage", page: "history" } : null;
        case "j":
          return { type: "openPage", page: "downloads" };
        case ",":
          return { type: "openPage", page: "settings" };
        case "=":
        case "+":
          return { type: "zoomIn" };
        case "-":
          return { type: "zoomOut" };
        case "0":
          return { type: "zoomReset" };
        case "p":
          return { type: "print" };
        case "u":
          return { type: "viewSource" };
        case "9":
          return { type: "selectLastTab" };
        case "q":
          return mac ? { type: "quit" } : null;
      }
      if (/^[1-8]$/.test(key)) return { type: "selectTab", index: Number(key) - 1 };
    } else {
      switch (key) {
        case "n":
          return { type: "newPrivateWindow" };
        case "t":
          return { type: "reopenClosedTab" };
        case "Tab":
          return { type: "previousTab" };
        case "r":
          return { type: "hardReload" };
        case "g":
          return { type: "findPrevious" };
        case "o":
          return { type: "openPage", page: "bookmarks" };
        case "b":
          return { type: "toggleBookmarksBar" };
        case "Delete":
        case "Backspace":
          return { type: "clearData" };
        case "i":
        case "j":
          return { type: "devtools" };
        case "q":
          return mac ? null : { type: "quit" };
        case "+":
        case "=":
          return { type: "zoomIn" };
        case "_":
          return { type: "zoomOut" };
      }
      // Shift+Ctrl+PageUp/Down etc. are left to the page.
    }
    return null;
  }

  if (alt && !mod && !shift) {
    switch (key) {
      case "ArrowLeft":
        return mac ? null : { type: "back" };
      case "ArrowRight":
        return mac ? null : { type: "forward" };
      case "Home":
        return { type: "home" };
      case "d":
        return mac ? null : { type: "focusAddressBar" };
    }
    return null;
  }

  if (!mod && !alt) {
    switch (key) {
      case "F5":
        return shift ? { type: "hardReload" } : { type: "reload" };
      case "F3":
        return shift ? { type: "findPrevious" } : { type: "findNext" };
      case "F6":
        return shift ? null : { type: "focusAddressBar" };
      case "F11":
        return shift ? null : { type: "fullscreen" };
      case "F12":
        return shift ? null : { type: "devtools" };
      case "BrowserBack":
        return { type: "back" };
      case "BrowserForward":
        return { type: "forward" };
      case "BrowserRefresh":
        return { type: "reload" };
      case "BrowserHome":
        return { type: "home" };
    }
  }
  return null;
}
