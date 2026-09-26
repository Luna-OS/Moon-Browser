import { useState, type DragEvent, type MouseEvent } from "react";
import type { TabInfo, WindowState } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import { CloseIcon, MaskIcon, PlusIcon, SleepIcon, SpeakerIcon } from "@theme/icons";
import { ui } from "./store";

const DRAG_TYPE = "application/x-moon-tab";

export function TabStrip({ state }: { state: WindowState }) {
  const [drop, setDrop] = useState<{ id: number; side: "before" | "after" } | null>(null);
  const splitIds = state.split ? [state.split.leftId, state.split.rightId] : [];

  const onDragOver = (event: DragEvent, tab: TabInfo) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    if (drop?.id !== tab.id || drop.side !== side) setDrop({ id: tab.id, side });
  };

  const onDrop = (event: DragEvent, tab: TabInfo) => {
    const id = Number(event.dataTransfer.getData(DRAG_TYPE));
    setDrop(null);
    if (!Number.isFinite(id) || id === tab.id) return;
    event.preventDefault();
    const from = state.tabs.findIndex((t) => t.id === id);
    let to = state.tabs.findIndex((t) => t.id === tab.id) + (drop?.side === "after" ? 1 : 0);
    if (from < to) to--;
    void ui.command({ type: "move", tabId: id, index: to });
  };

  return (
    <div className="mb-tabstrip">
      {state.private && (
        <span
          className="mb-private-badge"
          title="Private window: no history, cookies end with the window"
        >
          <MaskIcon size={14} /> Private
        </span>
      )}
      <div className="mb-tabs" role="tablist" aria-label="Tabs">
        {state.tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === state.activeId}
            inSplit={splitIds.includes(tab.id)}
            drop={drop?.id === tab.id ? drop.side : undefined}
            onDragOver={(e) => onDragOver(e, tab)}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => onDrop(e, tab)}
          />
        ))}
        <button
          type="button"
          className="mb-icon-btn mb-newtab"
          title="New tab (Ctrl+T)"
          aria-label="New tab"
          onClick={() => void ui.command({ type: "newTab" })}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

function Tab({
  tab,
  active,
  inSplit,
  drop,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  tab: TabInfo;
  active: boolean;
  inSplit: boolean;
  drop?: "before" | "after";
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const close = (event: MouseEvent) => {
    event.stopPropagation();
    void ui.command({ type: "close", tabId: tab.id });
  };

  const title = tab.sleeping ? `${tab.title} (asleep)` : tab.title;

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      className="mb-tab"
      data-pinned={tab.pinned}
      data-sleeping={tab.sleeping}
      data-split={inSplit}
      data-drop={drop}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(tab.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseDown={(e) => {
        if (e.button === 0) void ui.command({ type: "activate", tabId: tab.id });
      }}
      onAuxClick={(e) => {
        if (e.button === 1) close(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        void ui.command({ type: "tabMenu", tabId: tab.id, x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete") void ui.command({ type: "close", tabId: tab.id });
      }}
    >
      <span className="mb-tab-glow" />
      <span className="mb-tab-icon inline-flex">
        {tab.loading && !tab.sleeping ? (
          <span className="mb-loader" />
        ) : (
          <Favicon url={tab.url} src={tab.favicon} />
        )}
      </span>
      {!tab.pinned && <span className="mb-tab-title">{tab.title}</span>}
      {!tab.pinned && tab.sleeping && (
        <span className="text-(--mb-text-faint)" title="Asleep to save memory">
          <SleepIcon size={12} />
        </span>
      )}
      {!tab.pinned && (tab.audible || tab.muted) && (
        <button
          type="button"
          className="mb-tab-audio"
          aria-label={tab.muted ? "Unmute tab" : "Mute tab"}
          title={tab.muted ? "Unmute tab" : "Mute tab"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void ui.command({ type: "toggleMute", tabId: tab.id });
          }}
        >
          <SpeakerIcon muted={tab.muted} />
        </button>
      )}
      {!tab.pinned && (
        <button
          type="button"
          className="mb-tab-close"
          aria-label={`Close ${tab.title}`}
          title="Close tab (Ctrl+W)"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={close}
        >
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}
