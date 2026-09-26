import type { Rect } from "./types";

/** Width of the gap between the two panes of a split view (the divider). */
export const SPLIT_GAP = 6;

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.8, Math.max(0.2, ratio));
}

/**
 * The bounds of the left and right pane of a split view. The main process
 * places the pages with it, the UI draws the divider into the gap — both
 * from the same numbers.
 */
export function splitRects(area: Rect, ratio: number): [Rect, Rect] {
  const r = clampRatio(ratio);
  const usable = Math.max(0, area.width - SPLIT_GAP);
  const leftWidth = Math.round(usable * r);
  const left: Rect = { x: area.x, y: area.y, width: leftWidth, height: area.height };
  const right: Rect = {
    x: area.x + leftWidth + SPLIT_GAP,
    y: area.y,
    width: usable - leftWidth,
    height: area.height,
  };
  return [left, right];
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The page area of a window: its content size minus the browser UI around it. */
export function contentArea(width: number, height: number, insets: Insets): Rect {
  return {
    x: Math.round(insets.left),
    y: Math.round(insets.top),
    width: Math.max(0, Math.round(width - insets.left - insets.right)),
    height: Math.max(0, Math.round(height - insets.top - insets.bottom)),
  };
}
