import { useEffect, useRef, type ReactNode } from "react";
import { formatBytes, formatNumber } from "@shared/format";
import type { DownloadInfo, PermissionKind, SiteDecision, WindowState } from "@shared/types";
import {
  BellIcon,
  BookmarksIcon,
  CameraIcon,
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  CodeIcon,
  DownloadIcon,
  ExpandIcon,
  FileIcon,
  FindIcon,
  FolderIcon,
  HistoryIcon,
  InfoIcon,
  LockIcon,
  MaskIcon,
  MicIcon,
  MinusIcon,
  MoonIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  PlusIcon,
  PopupIcon,
  PrintIcon,
  PuzzleIcon,
  SettingsIcon,
  ShieldIcon,
  SparkleIcon,
  SplitIcon,
  StarIcon,
  TabIcon,
  UpdateIcon,
  WindowIcon,
} from "@theme/icons";
import type { UiCommand } from "@shared/ipc";
import { keys, ui } from "./store";

export type PopoverKind =
  | "menu"
  | "shield"
  | "downloads"
  | "extensions"
  | "group"
  | "bookmarkFolder"
  | "bookmark"
  | "ai"
  | "site";

const run = (cmd: UiCommand) => void ui.command(cmd);

/** Up, Down, Home and End move between a menu's items, as in any menu. */
function moveInMenu(event: KeyboardEvent) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  const from = event.target as HTMLElement;
  if (!keys.includes(event.key) || from.matches("input, select, textarea")) return;
  const menu = from.closest('[role="menu"]');
  if (!menu) return;
  const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
  );
  if (!items.length) return;
  event.preventDefault();
  const down = event.key === "ArrowDown";
  const at = items.indexOf(from);
  let next: number;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (at >= 0) next = (at + (down ? 1 : -1) + items.length) % items.length;
  else {
    // From a control between the items (the zoom buttons): the nearest item that way.
    const after = items.findIndex(
      (el) => !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    const below = after < 0 ? items.length : after;
    next = down ? below % items.length : (below - 1 + items.length) % items.length;
  }
  items[next].focus();
}

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
  // Closing gives the focus back to where it was (the button that opened
  // it), unless something else has taken it meanwhile.
  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement;
    el?.querySelector<HTMLElement>("button, input")?.focus();
    el?.addEventListener("keydown", moveInMenu);
    return () => {
      el?.removeEventListener("keydown", moveInMenu);
      const now = document.activeElement;
      if (now && now !== document.body) return;
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected)
        opener.focus();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Like Chrome's menus, it closes when the window is resized: its button
    // moves away, and the pages' snapshots behind it no longer fit.
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
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
  accent = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  keys?: string;
  /** Stands out: something waiting for the user. */
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`mb-menu-item ${accent ? "text-(--mb-accent) font-medium" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {keys && <span className="text-xs text-(--mb-text-faint)">{keys}</span>}
    </button>
  );
}

const Sep = () => <div className="mb-menu-sep" role="separator" />;

export function MainMenu({ state, onClose }: { state: WindowState; onClose: () => void }) {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const act = (cmd: UiCommand) => () => {
    onClose();
    run(cmd);
  };
  return (
    <div role="menu" aria-label="Luma menu">
      {state.updateReady && (
        <>
          <Item
            accent
            icon={<UpdateIcon size={16} />}
            label={
              state.updateManual
                ? `Download version ${state.updateReady}`
                : `Restart to update to ${state.updateReady}`
            }
            onClick={act({ type: "installUpdate" })}
          />
          <Sep />
        </>
      )}
      <Item
        icon={<TabIcon />}
        label="New tab"
        keys={keys("newTab")}
        onClick={act({ type: "newTab" })}
      />
      <Item
        icon={<WindowIcon />}
        label="New window"
        keys={keys("newWindow")}
        onClick={act({ type: "newWindow" })}
      />
      <Item
        icon={<MaskIcon />}
        label="New private window"
        keys={keys("newPrivateWindow")}
        onClick={act({ type: "newPrivateWindow" })}
      />
      <Sep />
      <Item
        icon={<HistoryIcon />}
        label="History"
        keys={keys("history")}
        onClick={act({ type: "openPage", page: "history" })}
      />
      <Item
        icon={<DownloadIcon />}
        label="Downloads"
        keys={keys("downloads")}
        onClick={act({ type: "openPage", page: "downloads" })}
      />
      <Item
        icon={<BookmarksIcon />}
        label="Bookmarks"
        keys={keys("bookmarks")}
        onClick={act({ type: "openPage", page: "bookmarks" })}
      />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={state.showBookmarksBar}
        className="mb-menu-item"
        onClick={() => run({ type: "toggleBookmarksBar" })}
      >
        <StarIcon />
        <span className="flex-1">Show bookmarks bar</span>
        <span className="text-xs text-(--mb-text-faint)">{keys("bookmarksBar")}</span>
        <span
          className="mb-switch mb-switch-sm"
          data-on={state.showBookmarksBar}
          aria-hidden="true"
        />
      </button>
      <Item
        icon={<PuzzleIcon />}
        label="Extensions"
        onClick={act({ type: "openPage", page: "extensions" })}
      />
      <Item
        icon={<SparkleIcon />}
        label={state.sidePanel?.assistant ? "Close Luma AI" : "Luma AI"}
        keys={keys("ai")}
        onClick={act({ type: "toggleAi" })}
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
          title={`Full screen (${keys("fullscreen")})`}
          onClick={act({ type: "fullscreen" })}
        >
          <ExpandIcon size={14} />
        </button>
      </div>
      <Sep />
      <Item
        icon={<FindIcon />}
        label="Find in page…"
        keys={keys("find")}
        onClick={act({ type: "find" })}
      />
      <Item
        icon={<PrintIcon />}
        label="Print…"
        keys={keys("print")}
        onClick={act({ type: "print" })}
      />
      <Item
        icon={<SplitIcon />}
        label={state.split ? "Close split view" : "Split view"}
        onClick={act(state.split ? { type: "unsplit" } : { type: "split" })}
      />
      <Item
        icon={<CodeIcon />}
        label="Developer tools"
        keys={keys("devtools")}
        onClick={act({ type: "devtools" })}
      />
      <Sep />
      <Item
        icon={<SettingsIcon />}
        label="Settings"
        keys={keys("settings")}
        onClick={act({ type: "openPage", page: "settings" })}
      />
      {!state.isDefaultBrowser && (
        <Item
          icon={<MoonIcon size={16} />}
          label="Set as default browser"
          onClick={act({ type: "makeDefaultBrowser" })}
        />
      )}
      <Item
        icon={<InfoIcon size={16} />}
        label="About Luma"
        onClick={act({ type: "openUrl", url: "moon://about/", disposition: "foreground" })}
      />
      <Item
        icon={<CloseIcon size={16} />}
        label="Quit"
        keys={keys("quit")}
        onClick={act({ type: "quit" })}
      />
    </div>
  );
}

/** An assistant's mark where it has no icon of its own: its initial, or the sparkle for Luma's chat. */
export function AssistantMark({ name, kind }: { name: string; kind: "web" | "api" }) {
  return (
    <span className="mb-ai-mark" aria-hidden="true">
      {kind === "api" ? <SparkleIcon size={12} /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** The switcher of the AI panel: every assistant, and the way to Settings. */
export function AssistantMenu({ state, onClose }: { state: WindowState; onClose: () => void }) {
  const current = state.sidePanel?.assistant?.id;
  return (
    <div role="menu" aria-label="Assistants">
      {state.ai.assistants.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitemradio"
          aria-checked={a.id === current}
          className="mb-menu-item"
          onClick={() => {
            onClose();
            run({ type: "aiOpen", assistantId: a.id });
          }}
        >
          <AssistantMark name={a.name} kind={a.kind} />
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
          {a.id === current && <CheckIcon size={14} />}
        </button>
      ))}
      <Sep />
      <Item
        icon={<SettingsIcon />}
        label="Manage…"
        onClick={() => {
          onClose();
          run({ type: "aiManage" });
        }}
      />
    </div>
  );
}

const SITE_PERMISSIONS: Partial<Record<PermissionKind, { icon: ReactNode; label: string }>> = {
  camera: { icon: <CameraIcon size={15} />, label: "Camera" },
  microphone: { icon: <MicIcon size={15} />, label: "Microphone" },
  geolocation: { icon: <PinIcon size={15} />, label: "Location" },
  notifications: { icon: <BellIcon size={15} />, label: "Notifications" },
  "clipboard-read": { icon: <ClipboardIcon size={15} />, label: "Read the clipboard" },
  popup: { icon: <PopupIcon size={15} />, label: "Pop-ups" },
};

const DECISIONS: { value: SiteDecision; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Block" },
];

/**
 * Behind the address bar's site icon: the connection and what the site may
 * do. Changing a permission holds from now on (as in Settings → Site
 * permissions); the page asks again for what it was refused.
 */
export function SitePanel({ state, onClose }: { state: WindowState; onClose: () => void }) {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  const site = state.site;
  if (!site || !tab) return null;
  const secure = tab.security === "secure";
  const host = site.origin.replace(/^https?:\/\//, "");
  const changed = site.blocked.length > 0;
  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex items-center gap-2.5">
        <span className={secure ? "text-(--mb-success)" : "text-(--mb-warning)"}>
          {secure ? <LockIcon size={18} /> : <InfoIcon size={18} />}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold" title={site.origin}>
            {host}
          </div>
          <div className="text-xs text-(--mb-text-muted)">
            {secure
              ? "Connection is secure"
              : site.origin.startsWith("file:")
                ? "A file on this computer"
                : "Not secure: plain HTTP"}
          </div>
        </div>
      </div>
      {changed && (
        <p className="m-0 px-1 text-xs text-(--mb-warning)">
          Blocked on this page because of an earlier answer:{" "}
          {site.blocked.map((k) => SITE_PERMISSIONS[k]?.label.toLowerCase() ?? k).join(", ")}. Allow
          it below, then try again on the page.
        </p>
      )}
      <div className="flex flex-col gap-1.5" role="list" aria-label="Permissions of this site">
        {site.permissions.map((p) => {
          const info = SITE_PERMISSIONS[p.kind];
          if (!info) return null;
          return (
            <div key={p.kind} role="listitem" className="flex items-center gap-2.5 px-1">
              <span
                className={
                  site.blocked.includes(p.kind) ? "text-(--mb-warning)" : "text-(--mb-text-muted)"
                }
              >
                {info.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{info.label}</span>
              <div
                role="radiogroup"
                aria-label={info.label}
                className="inline-flex shrink-0 gap-0.5 rounded-[0.6rem] border border-(--mb-border) bg-(--mb-inset) p-0.5"
              >
                {DECISIONS.map((d) => {
                  const selected = p.decision === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() =>
                        run({ type: "sitePermission", kind: p.kind, decision: d.value })
                      }
                      className={`inline-flex h-6 cursor-pointer items-center rounded-[0.45rem] border-0 px-2 text-xs font-medium transition-colors duration-150 ${
                        selected
                          ? "bg-(--mb-selected) text-(--mb-accent) shadow-[inset_0_0_0_1px_rgb(185_174_251/0.35)]"
                          : "bg-transparent text-(--mb-text-muted) hover:text-(--mb-text)"
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="mb-btn mb-btn-ghost mb-btn-sm self-start"
        onClick={() => {
          onClose();
          run({ type: "openUrl", url: "moon://settings/#permissions", disposition: "foreground" });
        }}
      >
        All site permissions
      </button>
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
          <div className="font-semibold">Luma Shield</div>
          <div className="truncate text-xs text-(--mb-text-muted)">
            {protection.site || "Luma's own pages need no shield"}
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
