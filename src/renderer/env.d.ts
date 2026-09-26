/// <reference types="vite/client" />
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type { MoonInternalApi, MoonUiApi } from "../shared/api";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      /** The extensions' toolbar buttons (electron-chrome-extensions). */
      "browser-action-list": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        partition?: string;
        tab?: number;
        alignment?: string;
      };
    }
  }
}

declare global {
  interface Window {
    /** Only in the browser UI (moon://ui). */
    moonUI: MoonUiApi;
    /** Only on internal pages (moon://settings, …). */
    moon: MoonInternalApi;
  }
}

export {};
