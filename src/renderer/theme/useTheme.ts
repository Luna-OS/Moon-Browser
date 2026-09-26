import { useEffect } from "react";
import type { ResolvedTheme } from "@shared/types";

/** Applies the night or day theme to the document. */
export function useDocumentTheme(theme: ResolvedTheme | undefined, isPrivate = false) {
  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.private = String(isPrivate);
  }, [theme, isPrivate]);
}
