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
  | { type: "openPage"; page: "history" | "downloads" | "bookmarks" | "settings" | "extensions" }
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

  if (mac) {
    const command = macOnly(key, input);
    if (command !== undefined) return command;
  }
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
        // On macOS, Cmd+H hides the app (the app menu's Hide) and Cmd+Y
        // opens the history, as in Chrome.
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
        case "h":
          return mac ? { type: "home" } : null;
        case "b":
          return { type: "toggleBookmarksBar" };
        case "Delete":
        case "Backspace":
          return { type: "clearData" };
        case "i":
          return { type: "devtools" };
        case "j":
          return mac ? { type: "openPage", page: "downloads" } : { type: "devtools" };
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

/**
 * Chrome's own keys on macOS, with Cmd plus Option, Control or a bracket.
 * Undefined for everything else: the shared table decides those.
 */
function macOnly(key: string, input: KeyInput): ShortcutCommand | null | undefined {
  const { meta, control, shift, alt } = input;
  // Ctrl+Tab switches tabs on macOS too.
  if (control && !meta && !alt && key === "Tab") return { type: shift ? "previousTab" : "nextTab" };
  if (!meta) return undefined;
  // With Option or Control held, macOS types other characters (Option+I is
  // a dead key), so these go by the key's place on the keyboard.
  const code = /^Key[A-Z]$/.test(input.code ?? "") ? (input.code ?? "") : "";
  const letter = code ? code.slice(3).toLowerCase() : key;
  if (control) return !shift && !alt && letter === "f" ? { type: "fullscreen" } : null;
  // Cmd+[ and Cmd+] go back and forward; with Shift they switch tabs.
  // Where brackets need Option (German keyboards: Option+5 and 6), the
  // bracket still counts.
  if (key === "[" || key === "{") return { type: shift ? "previousTab" : "back" };
  if (key === "]" || key === "}") return { type: shift ? "nextTab" : "forward" };
  if (!alt || shift) return undefined;
  switch (key === "ArrowLeft" || key === "ArrowRight" ? key : letter) {
    case "ArrowLeft":
      return { type: "previousTab" };
    case "ArrowRight":
      return { type: "nextTab" };
    case "i":
    case "j":
    case "c":
      return { type: "devtools" };
    case "u":
      return { type: "viewSource" };
    case "b":
      return { type: "openPage", page: "bookmarks" };
    case "l":
      return { type: "openPage", page: "downloads" };
  }
  return null;
}

/** Keys the menus and tooltips name. */
export type ShortcutHint =
  | "newTab"
  | "closeTab"
  | "newWindow"
  | "newPrivateWindow"
  | "back"
  | "forward"
  | "reload"
  | "home"
  | "history"
  | "downloads"
  | "bookmarks"
  | "bookmarksBar"
  | "bookmark"
  | "zoomReset"
  | "find"
  | "print"
  | "fullscreen"
  | "devtools"
  | "settings"
  | "quit";

/** Windows and Linux, then macOS (in Apple's order: ⌃ ⌥ ⇧ ⌘). */
const HINTS: Record<ShortcutHint, [string, string]> = {
  newTab: ["Ctrl+T", "⌘T"],
  closeTab: ["Ctrl+W", "⌘W"],
  newWindow: ["Ctrl+N", "⌘N"],
  newPrivateWindow: ["Ctrl+Shift+N", "⇧⌘N"],
  back: ["Alt+Left", "⌘["],
  forward: ["Alt+Right", "⌘]"],
  reload: ["Ctrl+R", "⌘R"],
  home: ["Alt+Home", "⇧⌘H"],
  history: ["Ctrl+H", "⌘Y"],
  downloads: ["Ctrl+J", "⇧⌘J"],
  bookmarks: ["Ctrl+Shift+O", "⌥⌘B"],
  bookmarksBar: ["Ctrl+Shift+B", "⇧⌘B"],
  bookmark: ["Ctrl+D", "⌘D"],
  zoomReset: ["Ctrl+0", "⌘0"],
  find: ["Ctrl+F", "⌘F"],
  print: ["Ctrl+P", "⌘P"],
  fullscreen: ["F11", "⌃⌘F"],
  devtools: ["F12", "⌥⌘I"],
  settings: ["Ctrl+,", "⌘,"],
  quit: ["Ctrl+Shift+Q", "⌘Q"],
};

/** How a shortcut is written on this platform: "Ctrl+Shift+N" or "⇧⌘N". */
export function shortcutHint(hint: ShortcutHint, platform: string): string {
  return HINTS[hint][platform === "darwin" ? 1 : 0];
}
