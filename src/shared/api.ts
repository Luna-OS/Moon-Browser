/**
 * The APIs the preload scripts expose to the renderers, as plain types so
 * the renderers don't depend on Electron.
 */
import type { InternalEvent, InternalMethod, OverlaySnapshot, UiCommand, UiEvent } from "./ipc";
import type { Bookmark, BookmarkFolderChoice, Suggestion, WindowState } from "./types";

export interface SuggestResult {
  suggestions: Suggestion[];
  inline: string | null;
  engine: string;
}

/** `window.moonUI` — only in the browser UI (moon://ui). */
export interface MoonUiApi {
  command(cmd: UiCommand): Promise<void>;
  suggest(text: string): Promise<SuggestResult>;
  /** A bookmark folder's contents, for its menu on the bookmarks bar. */
  bookmarkChildren(folder: string): Promise<Bookmark[]>;
  /** Every folder to choose from, the bookmarks bar first. */
  bookmarkFolders(): Promise<BookmarkFolderChoice[]>;
  /** Makes a folder at the end of `parent` (null: the bookmarks bar), for the star's editor. */
  addBookmarkFolder(title: string, parent: string | null): Promise<BookmarkFolderChoice | null>;
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
