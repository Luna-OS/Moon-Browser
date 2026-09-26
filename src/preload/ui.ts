/**
 * Preload of the browser UI (moon://ui). Exposes a small, typed API — the
 * UI never gets Node.js or raw IPC access.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { MoonUiApi, SuggestResult } from "../shared/api";
import { UI_CHANNELS, type OverlaySnapshot, type UiCommand, type UiEvent } from "../shared/ipc";
import type { WindowState } from "../shared/types";

const api: MoonUiApi = {
  command: (cmd: UiCommand): Promise<void> => ipcRenderer.invoke(UI_CHANNELS.command, cmd),
  suggest: (text: string): Promise<SuggestResult> => ipcRenderer.invoke(UI_CHANNELS.suggest, text),
  openOverlay: (): Promise<OverlaySnapshot[]> => ipcRenderer.invoke(UI_CHANNELS.overlayOpen),
  overlayReady: (): void => ipcRenderer.send(UI_CHANNELS.overlayReady),
  closeOverlay: (): Promise<void> => ipcRenderer.invoke(UI_CHANNELS.overlayClose),
  onState: (listener: (state: WindowState) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, state: WindowState) => listener(state);
    ipcRenderer.on(UI_CHANNELS.state, wrapped);
    return () => ipcRenderer.off(UI_CHANNELS.state, wrapped);
  },
  onEvent: (listener: (event: UiEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, event: UiEvent) => listener(event);
    ipcRenderer.on(UI_CHANNELS.event, wrapped);
    return () => ipcRenderer.off(UI_CHANNELS.event, wrapped);
  },
};

contextBridge.exposeInMainWorld("moonUI", api);
