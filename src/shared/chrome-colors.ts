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

/** The background of Moon's own pages (--mb-bg in tokens.css), shown before they paint. */
export const PAGE_BACKGROUND: Record<ResolvedTheme, string> = {
  dark: "#0b0920",
  light: "#f5f2fb",
};

/** The dimming behind a Moon dialog at the window's edges (.mb-dialog-backdrop in ui.css). */
export const DIALOG_SCRIM: Record<ResolvedTheme, { color: string; alpha: number }> = {
  dark: { color: "#0b0920", alpha: 0.84 },
  light: { color: "#2b2160", alpha: 0.28 },
};

/** `over` laid on `base` with the given opacity, both as #rrggbb. */
export function mixColors(base: string, over: string, alpha: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(base, i) * (1 - alpha) + channel(over, i) * alpha)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Height of the tab strip, which doubles as the title bar. */
export const TAB_STRIP_HEIGHT = 40;
