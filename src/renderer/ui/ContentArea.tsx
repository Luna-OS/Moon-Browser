import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OverlaySnapshot } from "@shared/ipc";
import { SIDE_PANEL_HEADER, sidePanelRects, splitRects, SPLIT_GAP } from "@shared/layout";
import type { Rect, TabInfo, WindowState } from "@shared/types";
import { CloseIcon, PuzzleIcon } from "@theme/icons";
import { MoonPhase } from "@theme/MoonPhase";
import { describeError } from "./errors";
import { ui } from "./store";

function Panel({ rect, children }: { rect: Rect; children: ReactNode }) {
  return (
    <div
      className="mb-night absolute flex items-center justify-center overflow-auto p-6"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div className="mb-glass flex max-w-xl flex-col items-center gap-4 px-10 py-9 text-center">
        {children}
      </div>
    </div>
  );
}

function PagePanel({ tab, rect }: { tab: TabInfo; rect: Rect }) {
  if (tab.crashed) {
    return (
      <Panel rect={rect}>
        <MoonPhase phase={0.03} size={72} />
        <h1 className="mb-title m-0 text-2xl font-semibold">This tab stopped working</h1>
        <p className="m-0 text-(--mb-text-muted)">The page crashed or ran out of memory.</p>
        <button
          type="button"
          className="mb-btn mb-btn-primary"
          onClick={() => void ui.command({ type: "reload" })}
        >
          Reload
        </button>
      </Panel>
    );
  }
  if (tab.error) {
    const { title, text } = describeError(tab.error);
    return (
      <Panel rect={rect}>
        <MoonPhase phase={tab.error.kind === "network" ? 0.04 : 0.25} size={72} />
        <h1 className="mb-title m-0 text-2xl font-semibold">{title}</h1>
        <p className="m-0 leading-relaxed text-(--mb-text-muted)">{text}</p>
        <code className="max-w-full truncate text-xs text-(--mb-text-faint)">
          {tab.error.rule
            ? `Rule: ${tab.error.rule}`
            : tab.error.description || `Error ${tab.error.code}`}
        </code>
        <div className="flex gap-2">
          {tab.error.kind !== "network" ? (
            <>
              <button
                type="button"
                className="mb-btn mb-btn-primary"
                onClick={() => void ui.command({ type: "back" })}
              >
                Go back
              </button>
              <button
                type="button"
                className="mb-btn mb-btn-danger"
                onClick={() => void ui.command({ type: "proceed", tabId: tab.id })}
              >
                {tab.error.kind === "https" ? "Continue to site (not secure)" : "Open anyway"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="mb-btn mb-btn-primary"
              onClick={() => void ui.command({ type: "reload" })}
            >
              Try again
            </button>
          )}
        </div>
      </Panel>
    );
  }
  return null;
}

/**
 * The page area. Pages themselves are native views above it; this draws
 * what isn't a page: error and crash panels, the split view divider, and
 * the page snapshots while a menu is open.
 */
export function ContentArea({
  state,
  snapshots,
  onDividerDrag,
}: {
  state: WindowState;
  snapshots: OverlaySnapshot[] | null;
  onDividerDrag: (dragging: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
      setOrigin({ x: r.left, y: r.top });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const active = state.tabs.find((t) => t.id === state.activeId);
  const split = state.split;
  const whole: Rect = { x: 0, y: 0, width: size.width, height: size.height };
  // The side panel takes the right part; the pages get the rest.
  const panel = state.sidePanel ? sidePanelRects(whole, state.sidePanel.width) : null;
  const area = panel ? panel.pages : whole;
  let panes: { tab: TabInfo; rect: Rect }[] = [];
  const splitVisible =
    !!split && !!active && (split.leftId === active.id || split.rightId === active.id);
  if (splitVisible && split) {
    const left = state.tabs.find((t) => t.id === split.leftId);
    const right = state.tabs.find((t) => t.id === split.rightId);
    const [l, r] = splitRects(area, split.ratio);
    if (left && right)
      panes = [
        { tab: left, rect: l },
        { tab: right, rect: r },
      ];
  } else if (active) {
    panes = [{ tab: active, rect: area }];
  }

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!split) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    onDividerDrag(true);
    const move = (e: PointerEvent) => {
      const ratio = (e.clientX - origin.x - SPLIT_GAP / 2) / Math.max(1, size.width - SPLIT_GAP);
      void ui.command({ type: "splitRatio", ratio });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onDividerDrag(false);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const divider = splitVisible && panes.length === 2 ? panes[0].rect.x + panes[0].rect.width : null;

  const startPanelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    onDividerDrag(true);
    const move = (e: PointerEvent) => {
      void ui.command({ type: "sidePanelWidth", width: origin.x + size.width - e.clientX });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      onDividerDrag(false);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <div ref={ref} className="relative min-h-0 flex-1 bg-(--mb-bg)">
      {panes.map(({ tab, rect }) => (
        <PagePanel key={tab.id} tab={tab} rect={rect} />
      ))}
      {snapshots?.map((s, i) => (
        <img
          key={i}
          className="mb-snapshot"
          src={s.dataUrl}
          alt=""
          style={{
            left: s.rect.x - origin.x,
            top: s.rect.y - origin.y,
            width: s.rect.width,
            height: s.rect.height,
          }}
        />
      ))}
      {divider !== null && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize split view"
          className="mb-divider"
          style={{ left: divider - 4, top: 0, width: SPLIT_GAP + 8, height: size.height }}
          onPointerDown={startDrag}
          onDoubleClick={() => void ui.command({ type: "splitRatio", ratio: 0.5 })}
        />
      )}
      {panel && state.sidePanel && (
        <>
          <div
            className="mb-side-panel-head"
            style={{
              left: panel.panel.x,
              top: 0,
              width: panel.panel.width,
              height: SIDE_PANEL_HEADER,
            }}
          >
            {state.sidePanel.icon ? (
              <img src={state.sidePanel.icon} width={16} height={16} alt="" />
            ) : (
              <PuzzleIcon size={16} />
            )}
            <span className="min-w-0 flex-1 truncate">{state.sidePanel.name}</span>
            <button
              type="button"
              className="mb-icon-btn h-7! w-7!"
              aria-label="Close side panel"
              title="Close side panel"
              onClick={() => void ui.command({ type: "sidePanelClose" })}
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            className="mb-divider"
            style={{
              left: panel.pages.width - 4,
              top: 0,
              width: SPLIT_GAP + 8,
              height: size.height,
            }}
            onPointerDown={startPanelDrag}
          />
        </>
      )}
    </div>
  );
}
