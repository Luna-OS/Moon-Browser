/**
 * Tab groups in the tab strip: the coloured label in front of a group's
 * tabs, and the editor for its name and colour.
 */
import { useState, type DragEvent } from "react";
import { GROUP_COLORS, type TabGroupInfo } from "@shared/tab-groups";
import { CloseIcon, PlusIcon, TabIcon } from "@theme/icons";
import { GROUP_COLOR_NAMES, GROUP_HEX } from "./group-colors";
import { ui } from "./store";

const DRAG_TYPE = "application/x-moon-tab";

/** The group's label: click to collapse or expand, right-click to edit, drop a tab to add it. */
export function GroupChip({
  group,
  count,
  onEdit,
}: {
  group: TabGroupInfo;
  count: number;
  onEdit: (anchor: DOMRect) => void;
}) {
  const [dropping, setDropping] = useState(false);
  const name = group.title || `${GROUP_COLOR_NAMES[group.color]} group`;
  return (
    <button
      type="button"
      className="mb-group-chip"
      data-group-chip={group.id}
      data-empty={!group.title || undefined}
      data-drop={dropping || undefined}
      style={{ "--mb-group": GROUP_HEX[group.color] } as React.CSSProperties}
      aria-expanded={!group.collapsed}
      aria-label={`${name}, ${count} ${count === 1 ? "tab" : "tabs"}`}
      title={`${name} — click to ${group.collapsed ? "expand" : "collapse"}, right-click to edit`}
      onClick={() =>
        void ui.command({ type: "groupUpdate", groupId: group.id, collapsed: !group.collapsed })
      }
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit(e.currentTarget.getBoundingClientRect());
      }}
      onDoubleClick={(e) => onEdit(e.currentTarget.getBoundingClientRect())}
      onDragOver={(e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e: DragEvent) => {
        setDropping(false);
        const tabId = Number(e.dataTransfer.getData(DRAG_TYPE));
        if (!Number.isFinite(tabId)) return;
        e.preventDefault();
        void ui.command({ type: "groupTab", tabId, groupId: group.id });
      }}
    >
      {group.title ? <span className="truncate">{group.title}</span> : null}
      {group.collapsed && <span className="mb-group-count">{count}</span>}
    </button>
  );
}

/** Name, colour and actions of a group, in a popover under its label. */
export function GroupEditor({ group, onClose }: { group: TabGroupInfo; onClose: () => void }) {
  const [title, setTitle] = useState(group.title);
  const act = (action: "newTab" | "ungroup" | "close") => {
    onClose();
    void ui.command({ type: "groupAction", groupId: group.id, action });
  };
  return (
    <div className="flex flex-col gap-2 p-1" role="dialog" aria-label="Edit tab group">
      <input
        className="mb-input"
        value={title}
        placeholder="Name this group"
        aria-label="Group name"
        maxLength={60}
        onChange={(e) => {
          setTitle(e.target.value);
          void ui.command({ type: "groupUpdate", groupId: group.id, title: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onClose();
        }}
      />
      <div role="radiogroup" aria-label="Group colour" className="flex flex-wrap gap-1.5 px-0.5">
        {GROUP_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={group.color === color}
            aria-label={GROUP_COLOR_NAMES[color]}
            title={GROUP_COLOR_NAMES[color]}
            className="mb-group-swatch"
            style={{ background: GROUP_HEX[color] }}
            onClick={() => void ui.command({ type: "groupUpdate", groupId: group.id, color })}
          />
        ))}
      </div>
      <div className="mb-menu-sep" role="separator" />
      <button type="button" className="mb-menu-item" onClick={() => act("newTab")}>
        <PlusIcon size={15} /> <span className="flex-1">New tab in group</span>
      </button>
      <button type="button" className="mb-menu-item" onClick={() => act("ungroup")}>
        <TabIcon /> <span className="flex-1">Ungroup</span>
      </button>
      <button type="button" className="mb-menu-item" onClick={() => act("close")}>
        <CloseIcon size={15} /> <span className="flex-1">Close group</span>
      </button>
    </div>
  );
}
