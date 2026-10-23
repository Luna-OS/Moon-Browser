import { useLayoutEffect } from "react";
import type { ResolvedTheme } from "@shared/types";

/** Applies the night or day theme to the document. */
export function useDocumentTheme(theme: ResolvedTheme | undefined, isPrivate = false) {
  // Before the browser paints, so a theme change never shows a frame of the old one.
  useLayoutEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.private = String(isPrivate);
  }, [theme, isPrivate]);
}
