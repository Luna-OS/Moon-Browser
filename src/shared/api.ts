/**
 * The APIs the preload scripts expose to the renderers, as plain types so
 * the renderers don't depend on Electron.
 */
import type { InternalEvent, InternalMethod, OverlaySnapshot, UiCommand, UiEvent } from "./ipc";
import type { Suggestion, WindowState } from "./types";

export interface SuggestResult {
  suggestions: Suggestion[];
  inline: string | null;
  engine: string;
}

/** `window.moonUI` — only in the browser UI (moon://ui). */
export interface MoonUiApi {
  command(cmd: UiCommand): Promise<void>;
  suggest(text: string): Promise<SuggestResult>;
  openOverlay(): Promise<OverlaySnapshot[]>;
  overlayReady(): void;
  closeOverlay(): Promise<void>;
  onState(listener: (state: WindowState) => void): () => void;
  onEvent(listener: (event: UiEvent) => void): () => void;
}

/** `window.moon` — only on internal pages (moon://settings, …). */
export interface MoonInternalApi {
  invoke(method: InternalMethod, ...args: unknown[]): Promise<unknown>;
  on(listener: (event: InternalEvent) => void): () => void;
}
