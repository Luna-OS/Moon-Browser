/// <reference types="vite/client" />
import type { MoonInternalApi, MoonUiApi } from "../shared/api";

/** An extension's toolbar button, as electron-chrome-extensions reports it. */
export interface BrowserActionInfo {
  id: string;
  title?: string;
  text?: string;
  color?: string;
  popup?: string;
  iconModified?: number;
  /** Values an extension set for one tab (keyed by the tab's webContents id). */
  tabs: Record<string, Omit<BrowserActionInfo, "id" | "tabs">>;
}

export interface BrowserActionState {
  activeTabId?: number;
  actions: BrowserActionInfo[];
}

/** `window.browserAction`, from injectBrowserAction() in the UI preload. */
export interface BrowserActionApi {
  getState(partition: string): Promise<BrowserActionState>;
  activate(
    partition: string,
    details: {
      eventType: "click" | "contextmenu";
      extensionId: string;
      tabId: number;
      alignment: string;
      anchorRect: { x: number; y: number; width: number; height: number };
    },
  ): Promise<void>;
  addEventListener(name: "update", listener: (state: BrowserActionState) => void): void;
  removeEventListener(name: "update", listener: (state: BrowserActionState) => void): void;
  addObserver(partition: string): void;
  removeObserver(partition: string): void;
}

declare global {
  interface Window {
    /** Only in the browser UI (moon://ui). */
    moonUI: MoonUiApi;
    /** Only in the browser UI: the extensions' buttons and pop-ups. */
    browserAction?: BrowserActionApi;
    /** Only on internal pages (moon://settings, …). */
    moon: MoonInternalApi;
  }
}

export {};
