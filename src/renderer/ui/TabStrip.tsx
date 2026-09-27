import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { TabGroupInfo } from "@shared/tab-groups";
import type { TabInfo, WindowState } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import { CloseIcon, MaskIcon, PlusIcon, SleepIcon, SpeakerIcon } from "@theme/icons";
import { GROUP_HEX } from "./group-colors";
import { ui } from "./store";
import { GroupChip } from "./TabGroups";

/** What is being dragged: a tab, or a whole group by its label. */
type DragItem = { kind: "tab"; id: number } | { kind: "group"; id: number };
/** Where it would go: next to a tab, or onto / in front of a group's label. */
type DropTarget =
  { kind: "tab"; id: number; side: "before" | "after" } | { kind: "chip"; id: number };

interface Drag {
  item: DragItem;
  startX: number;
  dx: number;
  moved: boolean;
  target: DropTarget | null;
}

/** Pixels the pointer has to travel before a press becomes a drag. */
const DRAG_THRESHOLD = 6;

/** How a tab or group label shows its part in a drag. */
export interface DragLook {
  /** Follows the pointer by this many pixels. */
  offset?: number;
  drop?: "before" | "after" | "join";
}

export function TabStrip({
  state,
  onEditGroup,
}: {
  state: WindowState;
  onEditGroup: (groupId: number, anchor: DOMRect) => void;
}) {
  const splitIds = state.split ? [state.split.leftId, state.split.rightId] : [];
  // Tabs and groups are dragged with the pointer (captured, so the drag
  // goes on over the window's drag area), not with HTML drag and drop:
  // that one doesn't work reliably in the title bar.
  const tabsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const draggedAway = useRef(false);

  const isDragged = (el: HTMLElement, item: DragItem) =>
    item.kind === "tab"
      ? el.dataset.tabId === String(item.id)
      : el.dataset.groupChip === String(item.id) || el.dataset.groupId === String(item.id);

  const targetAt = (x: number, item: DragItem): DropTarget | null => {
    const els = [
      ...(tabsRef.current?.querySelectorAll<HTMLElement>("[data-tab-id],[data-group-chip]") ?? []),
    ].filter((el) => !isDragged(el, item));
    if (!els.length) return null;
    const rects = els.map((el) => el.getBoundingClientRect());
    let i = rects.findIndex((r) => x >= r.left && x <= r.right);
    if (i < 0) {
      // Between two of them, or beyond the ends: the nearest one.
      const dist = rects.map((r) => Math.min(Math.abs(x - r.left), Math.abs(x - r.right)));
      i = dist.indexOf(Math.min(...dist));
    }
    const el = els[i];
    const r = rects[i];
    if (el.dataset.groupChip !== undefined)
      return { kind: "chip", id: Number(el.dataset.groupChip) };
    return {
      kind: "tab",
      id: Number(el.dataset.tabId),
      side: x < r.left + r.width / 2 ? "before" : "after",
    };
  };

  const drop = (item: DragItem, target: DropTarget) => {
    const tabs = state.tabs;
    if (item.kind === "tab") {
      if (target.kind === "chip") {
        void ui.command({ type: "groupTab", tabId: item.id, groupId: target.id });
        return;
      }
      if (target.id === item.id) return;
      const from = tabs.findIndex((t) => t.id === item.id);
      let to = tabs.findIndex((t) => t.id === target.id) + (target.side === "after" ? 1 : 0);
      if (from < to) to--;
      if (from !== to) void ui.command({ type: "move", tabId: item.id, index: to });
      return;
    }
    // A group: to the place among the other tabs (the main process keeps
    // it away from pinned tabs and out of other groups).
    const at =
      target.kind === "chip"
        ? tabs.findIndex((t) => t.groupId === target.id)
        : tabs.findIndex((t) => t.id === target.id) + (target.side === "after" ? 1 : 0);
    if (at < 0) return;
    const index = tabs.slice(0, at).filter((t) => t.groupId !== item.id).length;
    void ui.command({ type: "moveGroup", groupId: item.id, index });
  };

  /** The tab or group label a press started on, unless on a tab's own buttons. */
  const itemAt = (target: EventTarget): DragItem | null => {
    const el = (target as HTMLElement).closest<HTMLElement>("[data-tab-id],[data-group-chip]");
    if (!el) return null;
    if (el.dataset.groupChip !== undefined)
      return { kind: "group", id: Number(el.dataset.groupChip) };
    // Close and mute keep their clicks.
    if ((target as HTMLElement).closest("button")) return null;
    return { kind: "tab", id: Number(el.dataset.tabId) };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    draggedAway.current = false;
    const item = e.button === 0 ? itemAt(e.target) : null;
    dragRef.current = item ? { item, startX: e.clientX, dx: 0, moved: false, target: null } : null;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      // From here on the strip gets the pointer wherever it goes.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const next = { ...d, dx, moved: true, target: targetAt(e.clientX, d.item) };
    dragRef.current = next;
    setDrag(next);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.moved) return;
    setDrag(null);
    // The click that ends a drag isn't one.
    draggedAway.current = true;
    if (d.target && e.type === "pointerup") drop(d.item, d.target);
  };

  /** How an element looks in the current drag. */
  const look = (el: { tabId?: number; groupId?: number | null; chipId?: number }): DragLook => {
    if (!drag) return {};
    const { item, target, dx } = drag;
    const dragged =
      item.kind === "tab"
        ? el.tabId === item.id
        : el.chipId === item.id || (el.tabId !== undefined && el.groupId === item.id);
    if (dragged) return { offset: dx };
    if (!target) return {};
    if (target.kind === "tab" && el.tabId === target.id) return { drop: target.side };
    if (target.kind === "chip" && el.chipId === target.id)
      return { drop: item.kind === "tab" ? "join" : "before" };
    return {};
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
      <div
        className="mb-tabs"
        role="tablist"
        aria-label="Tabs"
        ref={tabsRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (!draggedAway.current) return;
          draggedAway.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {(() => {
          // Each group's label goes in front of its tabs; a collapsed group
          // shows only the label.
          const groups = new Map(state.groups.map((g) => [g.id, g]));
          const items: ReactNode[] = [];
          let previous: number | null = null;
          for (const tab of state.tabs) {
            const group = tab.groupId !== null ? groups.get(tab.groupId) : undefined;
            if (group && tab.groupId !== previous) {
              items.push(
                <GroupChip
                  key={`group-${group.id}`}
                  group={group}
                  count={state.tabs.filter((t) => t.groupId === group.id).length}
                  look={look({ chipId: group.id })}
                  onEdit={(anchor) => onEditGroup(group.id, anchor)}
                />,
              );
            }
            previous = tab.groupId;
            if (group?.collapsed) continue;
            items.push(
              <Tab
                key={tab.id}
                tab={tab}
                group={group}
                active={tab.id === state.activeId}
                inSplit={splitIds.includes(tab.id)}
                look={look({ tabId: tab.id, groupId: tab.groupId })}
              />,
            );
          }
          return items;
        })()}
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
  group,
  active,
  inSplit,
  look,
}: {
  tab: TabInfo;
  group?: TabGroupInfo;
  active: boolean;
  inSplit: boolean;
  look: DragLook;
}) {
  const close = (event: MouseEvent) => {
    event.stopPropagation();
    void ui.command({ type: "close", tabId: tab.id });
  };

  const title = tab.sleeping ? `${tab.title} (asleep)` : tab.title;
  const style: React.CSSProperties & Record<string, string> = {};
  if (group) style["--mb-group"] = GROUP_HEX[group.color];
  if (look.offset !== undefined) style.transform = `translateX(${look.offset}px)`;

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      className="mb-tab"
      data-tab-id={tab.id}
      data-pinned={tab.pinned}
      data-sleeping={tab.sleeping}
      data-split={inSplit}
      data-drop={look.drop}
      data-dragging={look.offset !== undefined || undefined}
      data-group={group ? "" : undefined}
      data-group-id={group?.id}
      style={style}
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
      {group && <span className="mb-tab-group-line" aria-hidden="true" />}
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
