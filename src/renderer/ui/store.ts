/**
 * The window state from the main process as an external store. It is
 * subscribed to at module load — before React renders — so the first state
 * message can never be missed.
 */
import { useSyncExternalStore } from "react";
import type { UiEvent } from "@shared/ipc";
import type { WindowState } from "@shared/types";

let current: WindowState | null = null;
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(event: UiEvent) => void>();
const queued: UiEvent[] = [];

window.moonUI.onState((state) => {
  current = state;
  for (const l of stateListeners) l();
});

window.moonUI.onEvent((event) => {
  if (eventListeners.size === 0) queued.push(event);
  for (const l of eventListeners) l(event);
});

export function useWindowState(): WindowState | null {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    () => current,
  );
}

/** Events like "focus the address bar"; ones sent before anyone listened are replayed. */
export function onUiEvent(listener: (event: UiEvent) => void): () => void {
  eventListeners.add(listener);
  for (const event of queued.splice(0)) listener(event);
  return () => eventListeners.delete(listener);
}

export const ui = window.moonUI;
