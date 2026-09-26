/**
 * Pages are native views drawn above the browser UI, so a menu or the
 * address bar's suggestions would end up hidden behind them. While any of
 * those is open, the main process takes a snapshot of the visible pages, the
 * UI shows the snapshot in their place, and the real pages step aside —
 * the same trick other Electron browsers use. It is invisible to the eye.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { OverlaySnapshot } from "@shared/ipc";
import { ui } from "./store";

export function useOverlay(active: boolean): OverlaySnapshot[] | null {
  const [snapshots, setSnapshots] = useState<OverlaySnapshot[] | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    if (active) {
      void ui.openOverlay().then((shots) => {
        if (gen !== generation.current) return;
        flushSync(() => setSnapshots(shots));
        // Two frames: the snapshot is painted before the pages step aside.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (gen === generation.current) ui.overlayReady();
          }),
        );
      });
    } else {
      void ui.closeOverlay().then(() => {
        if (gen === generation.current) setSnapshots(null);
      });
    }
  }, [active]);

  return snapshots;
}
