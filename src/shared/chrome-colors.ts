import type { ResolvedTheme } from "./types";

/**
 * Colors the main process needs for native parts of the window: the
 * background before the UI paints and the window buttons (min/max/close)
 * drawn next to the tab strip. They match the tab strip in tokens.css.
 */
export const FRAME_COLORS: Record<
  ResolvedTheme,
  { frame: string; privateFrame: string; symbols: string }
> = {
  dark: { frame: "#0b0920", privateFrame: "#1d1742", symbols: "#f4f1ff" },
  light: { frame: "#ece7f7", privateFrame: "#ddd5f5", symbols: "#1c1733" },
};

/** Height of the tab strip, which doubles as the title bar. */
export const TAB_STRIP_HEIGHT = 40;
