import { useEffect, useRef, type ReactNode } from "react";
import { formatBytes, formatNumber } from "@shared/format";
import type { DownloadInfo, WindowState } from "@shared/types";
import {
  BookmarksIcon,
  CloseIcon,
  CodeIcon,
  DownloadIcon,
  ExpandIcon,
  FileIcon,
  FindIcon,
  FolderIcon,
  HistoryIcon,
  InfoIcon,
  MaskIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PrintIcon,
  SettingsIcon,
  ShieldIcon,
  SplitIcon,
  TabIcon,
  WindowIcon,
} from "@theme/icons";
import type { UiCommand } from "@shared/ipc";
import { ui } from "./store";

export type PopoverKind = "menu" | "shield" | "downloads";

const run = (cmd: UiCommand) => void ui.command(cmd);

/** A popover anchored below a toolbar button, closed by Escape or a click outside. */
export function Popover({
  anchor,
  align = "right",
  width,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect;
  align?: "left" | "right";
  width: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button, input")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left =
    align === "right"
      ? Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
      : Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  return (
    <>
      <div className="mb-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        className="mb-popover mb-menu"
        style={{ left, top: anchor.bottom + 6, width }}
      >
        {children}
      </div>
    </>
  );
}

function Item({
  icon,
  label,
  keys,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  keys?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className="mb-menu-item" onClick={onClick}>
      {icon}
      <span className="flex-1">{label}</span>
      {keys && <span className="text-xs text-(--mb-text-faint)">{keys}</span>}
    </button>
  );
}

const Sep = () => <div className="mb-menu-sep" role="separator" />;

export function MainMenu({ state, onClose }: { state: WindowState; onClose: () => void }) {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const mod = state.platform === "darwin" ? "⌘" : "Ctrl+";
  const act = (cmd: UiCommand) => () => {
    onClose();
    run(cmd);
  };
  return (
    <div role="menu" aria-label="Moon Browser menu">
      <Item icon={<TabIcon />} label="New tab" keys={`${mod}T`} onClick={act({ type: "newTab" })} />
      <Item
        icon={<WindowIcon />}
        label="New window"
        keys={`${mod}N`}
        onClick={act({ type: "newWindow" })}
      />
      <Item
        icon={<MaskIcon />}
        label="New private window"
        keys={`${mod}Shift+N`}
        onClick={act({ type: "newPrivateWindow" })}
      />
      <Sep />
      <Item
        icon={<HistoryIcon />}
        label="History"
        keys={`${mod}H`}
        onClick={act({ type: "openPage", page: "history" })}
      />
      <Item
        icon={<DownloadIcon />}
        label="Downloads"
        keys={`${mod}J`}
        onClick={act({ type: "openPage", page: "downloads" })}
      />
      <Item
        icon={<BookmarksIcon />}
        label="Bookmarks"
        keys={`${mod}Shift+O`}
        onClick={act({ type: "openPage", page: "bookmarks" })}
      />
      <Sep />
      <div className="flex h-9 items-center gap-1 px-2">
        <span className="flex-1 pl-0.5">Zoom</span>
        <button
          type="button"
          className="mb-icon-btn h-7! w-7!"
          aria-label="Zoom out"
          onClick={() => run({ type: "zoomOut" })}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-sm w-14 tabular-nums"
          title="Reset zoom"
          onClick={() => run({ type: "zoomReset" })}
        >
          {tab?.zoom ?? 100}%
        </button>
        <button
          type="button"
          className="mb-icon-btn h-7! w-7!"
          aria-label="Zoom in"
          onClick={() => run({ type: "zoomIn" })}
        >
          <PlusIcon size={14} />
        </button>
        <button
          type="button"
          className="mb-icon-btn h-7! w-7!"
          aria-label="Full screen"
          title="Full screen (F11)"
          onClick={act({ type: "fullscreen" })}
        >
          <ExpandIcon size={14} />
        </button>
      </div>
      <Sep />
      <Item
        icon={<FindIcon />}
        label="Find in page…"
        keys={`${mod}F`}
        onClick={act({ type: "find" })}
      />
      <Item icon={<PrintIcon />} label="Print…" keys={`${mod}P`} onClick={act({ type: "print" })} />
      <Item
        icon={<SplitIcon />}
        label={state.split ? "Close split view" : "Split view"}
        onClick={act(state.split ? { type: "unsplit" } : { type: "split" })}
      />
      <Item
        icon={<CodeIcon />}
        label="Developer tools"
        keys="F12"
        onClick={act({ type: "devtools" })}
      />
      <Sep />
      <Item
        icon={<SettingsIcon />}
        label="Settings"
        keys={`${mod},`}
        onClick={act({ type: "openPage", page: "settings" })}
      />
      <Item
        icon={<InfoIcon size={16} />}
        label="About Moon Browser"
        onClick={act({ type: "openUrl", url: "moon://about/", disposition: "foreground" })}
      />
      <Item
        icon={<CloseIcon size={16} />}
        label="Quit"
        keys={`${mod}Shift+Q`}
        onClick={act({ type: "quit" })}
      />
    </div>
  );
}

export function ShieldPanel({ state, onClose }: { state: WindowState; onClose: () => void }) {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const { protection } = state;
  const on = protection.adblock && !protection.siteAllowed;
  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex items-center gap-2.5">
        <span className={on ? "text-(--mb-accent)" : "text-(--mb-text-faint)"}>
          <ShieldIcon size={22} off={!on} />
        </span>
        <div className="min-w-0">
          <div className="font-semibold">Moon Shield</div>
          <div className="truncate text-xs text-(--mb-text-muted)">
            {protection.site || "Moon Browser's own pages need no shield"}
          </div>
        </div>
      </div>

      {protection.site && (
        <>
          <div className="mb-inset flex items-baseline gap-2 px-3 py-2.5">
            <span className="mb-title text-2xl font-semibold tabular-nums">
              {formatNumber(tab?.blocked ?? 0)}
            </span>
            <span className="text-xs text-(--mb-text-muted)">
              ads and trackers blocked on this page
            </span>
          </div>
          <label
            className="flex cursor-pointer items-center gap-3 px-1"
            aria-label="Protection for this site"
          >
            <span className="flex-1">
              <span className="block">Protection for this site</span>
              <span className="block text-xs text-(--mb-text-muted)">
                {protection.siteAllowed
                  ? "Off — ads, trackers and third-party cookies are allowed here"
                  : "Blocks ads, trackers and third-party cookies"}
              </span>
            </span>
            <input
              type="checkbox"
              className="mb-switch"
              checked={!protection.siteAllowed}
              onChange={() => {
                run({ type: "toggleProtection" });
              }}
            />
          </label>
          {!protection.adblock && (
            <p className="m-0 px-1 text-xs text-(--mb-warning)">
              Ad blocking is switched off in Settings.
            </p>
          )}
        </>
      )}
      <button
        type="button"
        className="mb-btn mb-btn-ghost mb-btn-sm self-start"
        onClick={() => {
          onClose();
          run({ type: "openUrl", url: "moon://settings/#privacy", disposition: "foreground" });
        }}
      >
        Privacy settings
      </button>
    </div>
  );
}

function downloadStatus(d: DownloadInfo): string {
  switch (d.state) {
    case "completed":
      return formatBytes(d.total || d.received);
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Failed";
    default:
      return d.paused
        ? `Paused — ${formatBytes(d.received)}`
        : d.total > 0
          ? `${formatBytes(d.received)} of ${formatBytes(d.total)}`
          : formatBytes(d.received);
  }
}

export function DownloadsPanel({ state, onClose }: { state: WindowState; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-1 p-1">
      <div className="mb-eyebrow px-2 pt-1 pb-1.5">Downloads</div>
      {state.downloads.length === 0 && (
        <p className="m-0 px-2 pb-2 text-sm text-(--mb-text-muted)">
          Nothing downloaded in this session yet.
        </p>
      )}
      {state.downloads.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-2.5 rounded-[0.6rem] px-2 py-1.5 hover:bg-(--mb-hover)"
        >
          <span className="text-(--mb-text-muted)">
            <FileIcon size={18} />
          </span>
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-inherit"
            disabled={d.state !== "completed"}
            onClick={() => run({ type: "download", id: d.id, action: "open" })}
            title={d.state === "completed" ? "Open" : d.filename}
          >
            <div className="truncate text-[0.8125rem]">{d.filename}</div>
            {d.state === "progressing" && d.total > 0 && (
              <div className="mb-meter my-1">
                <span style={{ width: `${Math.min(100, (d.received / d.total) * 100)}%` }} />
              </div>
            )}
            <div className="text-xs text-(--mb-text-muted)">{downloadStatus(d)}</div>
          </button>
          {d.state === "progressing" && (
            <>
              <button
                type="button"
                className="mb-icon-btn h-7! w-7!"
                aria-label={d.paused ? "Resume" : "Pause"}
                onClick={() =>
                  run({ type: "download", id: d.id, action: d.paused ? "resume" : "pause" })
                }
              >
                {d.paused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button
                type="button"
                className="mb-icon-btn h-7! w-7!"
                aria-label="Cancel"
                onClick={() => run({ type: "download", id: d.id, action: "cancel" })}
              >
                <CloseIcon />
              </button>
            </>
          )}
          {d.state === "completed" && (
            <button
              type="button"
              className="mb-icon-btn h-7! w-7!"
              aria-label="Show in folder"
              title="Show in folder"
              onClick={() => run({ type: "download", id: d.id, action: "show" })}
            >
              <FolderIcon />
            </button>
          )}
        </div>
      ))}
      <div className="mb-menu-sep" />
      <button
        type="button"
        className="mb-menu-item"
        onClick={() => {
          onClose();
          run({ type: "openPage", page: "downloads" });
        }}
      >
        <DownloadIcon /> All downloads
      </button>
    </div>
  );
}
