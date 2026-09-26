/// <reference types="vite/client" />
import type { MoonInternalApi, MoonUiApi } from "../shared/api";

declare global {
  interface Window {
    /** Only in the browser UI (moon://ui). */
    moonUI: MoonUiApi;
    /** Only on internal pages (moon://settings, …). */
    moon: MoonInternalApi;
  }
}

export {};
