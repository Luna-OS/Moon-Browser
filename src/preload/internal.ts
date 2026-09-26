/**
 * Preload of every tab. On Moon Browser's own pages (moon://settings, …) it
 * exposes `window.moon`; on web pages it does nothing at all. The main
 * process checks each call again, so this is not the only line of defense.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { MoonInternalApi } from "../shared/api";
import {
  INTERNAL_CHANNEL,
  INTERNAL_EVENT_CHANNEL,
  type InternalEvent,
  type InternalMethod,
} from "../shared/ipc";

const api: MoonInternalApi = {
  invoke: (method: InternalMethod, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(INTERNAL_CHANNEL, method, ...args),
  on: (listener: (event: InternalEvent) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, event: InternalEvent) => listener(event);
    ipcRenderer.on(INTERNAL_EVENT_CHANNEL, wrapped);
    return () => ipcRenderer.off(INTERNAL_EVENT_CHANNEL, wrapped);
  },
};

if (window.location.protocol === "moon:") {
  contextBridge.exposeInMainWorld("moon", api);
}
