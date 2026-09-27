/** Extension button state and activation, shared by the toolbar and the extensions menu. */
import { useEffect, useState } from "react";
import { EXTENSIONS_PARTITION } from "@shared/extensions";
import type { ExtensionEntry, WindowState } from "@shared/types";
import type { BrowserActionInfo, BrowserActionState } from "../env";
import { latestState, ui } from "./store";

/** The extensions' button states (icons, badges, titles), kept up to date. */
export function useBrowserActions(enabled: boolean): BrowserActionState | null {
  const [state, setState] = useState<BrowserActionState | null>(null);
  useEffect(() => {
    const api = window.browserAction;
    if (!enabled || !api) return;
    let alive = true;
    const listener = (next: BrowserActionState) => {
      if (alive) setState(next);
    };
    api.addEventListener("update", listener);
    api.addObserver(EXTENSIONS_PARTITION);
    api.getState(EXTENSIONS_PARTITION).then(listener, () => undefined);
    return () => {
      alive = false;
      api.removeEventListener("update", listener);
      api.removeObserver(EXTENSIONS_PARTITION);
    };
  }, [enabled]);
  return state;
}

export type ActionInfo = Omit<BrowserActionInfo, "tabs">;

/** What an extension set for this tab, over what it set for all tabs. */
export function actionFor(
  actions: BrowserActionState | null,
  id: string,
  tab: number | null,
): ActionInfo | undefined {
  const action = actions?.actions.find((a) => a.id === id);
  if (!action) return undefined;
  const { tabs, ...all } = action;
  return { ...all, ...(tab !== null ? tabs[String(tab)] : undefined) };
}

/** Badge colours come as CSS strings or as [r, g, b, a]. */
export function badgeColor(color: unknown): string | undefined {
  if (typeof color === "string") return color;
  if (Array.isArray(color) && color.length >= 3)
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(color[3] ?? 255) / 255})`;
  return undefined;
}

/**
 * The pop-up that was open when a toolbar button was pressed. Pressing the
 * button usually focuses the browser window, which closes the pop-up before
 * the click arrives, so the click must not open it again.
 */
let popupAtPress: string | null = null;

export function rememberPopup(state: WindowState) {
  popupAtPress = state.extensionPopup;
}

/** Opens an extension's pop-up (or side panel) below `anchor`; a second click closes it. */
export function activateExtension(state: WindowState, entry: ExtensionEntry, anchor: DOMRect) {
  const wasOpen = popupAtPress === entry.id;
  popupAtPress = null;
  if (wasOpen) {
    // Still open a moment later (the press didn't move the focus): the
    // click closes it, as a second click does in Chrome.
    setTimeout(() => {
      if (latestState()?.extensionPopup === entry.id) trigger(state, entry, anchor);
    }, 150);
    return;
  }
  trigger(state, entry, anchor);
}

function trigger(state: WindowState, entry: ExtensionEntry, anchor: DOMRect) {
  if (entry.opensSidePanel) {
    void ui.command({ type: "sidePanelToggle", extensionId: entry.id });
    return;
  }
  void window.browserAction?.activate(EXTENSIONS_PARTITION, {
    eventType: "click",
    extensionId: entry.id,
    tabId: state.extensionTab ?? -1,
    alignment: "",
    anchorRect: { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height },
  });
}
