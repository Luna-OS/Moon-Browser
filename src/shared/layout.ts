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

/** The side panel: its title bar, the gap to the pages, and its width limits. */
export const SIDE_PANEL_HEADER = 40;
export const SIDE_PANEL_WIDTH = 380;
const SIDE_PANEL_MIN = 280;
const PAGES_MIN = 320;

export function clampPanelWidth(width: number, areaWidth: number): number {
  const max = Math.max(SIDE_PANEL_MIN, Math.min(720, areaWidth - PAGES_MIN - SPLIT_GAP));
  const w = Number.isFinite(width) ? width : SIDE_PANEL_WIDTH;
  return Math.round(Math.min(max, Math.max(SIDE_PANEL_MIN, w)));
}

/**
 * The page area split for the side panel: the pages on the left, the panel
 * on the right with its title bar (drawn by the UI) above the extension's
 * page (a native view placed by the main process).
 */
export function sidePanelRects(
  area: Rect,
  width: number,
): { pages: Rect; panel: Rect; view: Rect } {
  const w = clampPanelWidth(width, area.width);
  const pagesWidth = Math.max(0, area.width - w - SPLIT_GAP);
  const panel: Rect = {
    x: area.x + pagesWidth + SPLIT_GAP,
    y: area.y,
    width: w,
    height: area.height,
  };
  return {
    pages: { x: area.x, y: area.y, width: pagesWidth, height: area.height },
    panel,
    view: {
      x: panel.x,
      y: panel.y + SIDE_PANEL_HEADER,
      width: panel.width,
      height: Math.max(0, panel.height - SIDE_PANEL_HEADER),
    },
  };
}
