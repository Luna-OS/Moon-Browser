import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WindowState } from "@shared/types";
import {
  BackIcon,
  CloseIcon,
  DownloadIcon,
  ForwardIcon,
  HomeIcon,
  MenuIcon,
  PuzzleIcon,
  ReloadIcon,
  ShieldIcon,
  SplitIcon,
  UpdateIcon,
} from "@theme/icons";
import { useDocumentTheme } from "@theme/useTheme";
import { AddressBar } from "./AddressBar";
import { BookmarksBar, FindBar, PromptBar } from "./Bars";
import { ContentArea } from "./ContentArea";
import { useBrowserActions } from "./extension-actions";
import { ExtensionButtons, ExtensionsMenu } from "./Extensions";
import { useOverlay } from "./overlay";
import { DownloadsPanel, MainMenu, Popover, ShieldPanel, type PopoverKind } from "./Popovers";
import { onUiEvent, ui, useWindowState } from "./store";
import { GroupEditor } from "./TabGroups";
import { TabStrip } from "./TabStrip";

export function App() {
  const state = useWindowState();
  useDocumentTheme(state?.theme, state?.private);
  if (!state) return <div className="h-full bg-(--mb-frame)" />;
  return <Browser state={state} />;
}

function Browser({ state }: { state: WindowState }) {
  const [popover, setPopover] = useState<{
    kind: PopoverKind;
    anchor: DOMRect;
    groupId?: number;
  } | null>(null);
  const [dropdown, setDropdown] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The tab the find bar was opened for; switching tabs closes it, like Chrome. */
  const [findTab, setFindTab] = useState<number | null>(null);
  const findOpen = findTab === state.activeId;
  const snapshots = useOverlay(popover !== null || dropdown || dragging);
  const actions = useBrowserActions(!state.private);
  const content = useRef<HTMLDivElement>(null);
  const activeRef = useRef(state.activeId);
  useEffect(() => {
    activeRef.current = state.activeId;
  }, [state.activeId]);

  const tab = state.tabs.find((t) => t.id === state.activeId);
  const prompt =
    state.prompts.find((p) => p.tabId === state.activeId) ??
    state.prompts.find((p) =>
      state.split ? p.tabId === state.split.leftId || p.tabId === state.split.rightId : false,
    );
  const running = state.downloads.filter((d) => d.state === "progressing");
  const progress = running.length
    ? running.reduce((sum, d) => sum + (d.total ? d.received / d.total : 0), 0) / running.length
    : 0;

  // Tell the main process where the page area is.
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      void ui.command({ type: "insets", top: r.top, bottom: window.innerHeight - r.bottom });
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      onUiEvent((event) => {
        if (event.type === "find") setFindTab(activeRef.current);
        if (event.type === "closePopovers") setPopover(null);
        if (event.type === "editGroup") {
          // The new group's label appears with the next state; wait for it.
          let tries = 0;
          const open = () => {
            const chip = document.querySelector(`[data-group-chip="${event.groupId}"]`);
            if (chip)
              setPopover({
                kind: "group",
                anchor: chip.getBoundingClientRect(),
                groupId: event.groupId,
              });
            else if (tries++ < 30) requestAnimationFrame(open);
          };
          requestAnimationFrame(open);
        }
      }),
    [],
  );

  const toggle = (kind: PopoverKind) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = event.currentTarget.getBoundingClientRect();
    setPopover((p) => (p?.kind === kind ? null : { kind, anchor }));
  };
  const closePopover = useCallback(() => setPopover(null), []);
  const onDropdown = useCallback((open: boolean) => setDropdown(open), []);
  const shieldOn =
    state.protection.adblock && !state.protection.siteAllowed && !!state.protection.site;

  return (
    <div className="flex h-full flex-col">
      {!state.fullscreen && (
        <header>
          <TabStrip
            state={state}
            onEditGroup={(groupId, anchor) => setPopover({ kind: "group", anchor, groupId })}
          />
          <div className="mb-toolbar">
            <button
              type="button"
              className="mb-icon-btn"
              aria-label="Back"
              title="Back (Alt+Left)"
              disabled={!tab?.canGoBack}
              onClick={() => void ui.command({ type: "back" })}
            >
              <BackIcon />
            </button>
            <button
              type="button"
              className="mb-icon-btn"
              aria-label="Forward"
              title="Forward (Alt+Right)"
              disabled={!tab?.canGoForward}
              onClick={() => void ui.command({ type: "forward" })}
            >
              <ForwardIcon />
            </button>
            {tab?.loading ? (
              <button
                type="button"
                className="mb-icon-btn"
                aria-label="Stop loading"
                title="Stop (Esc)"
                onClick={() => void ui.command({ type: "stop" })}
              >
                <CloseIcon size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="mb-icon-btn"
                aria-label="Reload"
                title="Reload (Ctrl+R)"
                onClick={(e) => void ui.command({ type: e.shiftKey ? "hardReload" : "reload" })}
              >
                <ReloadIcon />
              </button>
            )}
            {state.showHomeButton && (
              <button
                type="button"
                className="mb-icon-btn"
                aria-label="Home"
                title="Home (Alt+Home)"
                onClick={() => void ui.command({ type: "home" })}
              >
                <HomeIcon />
              </button>
            )}
            <div className="mx-1 flex min-w-0 flex-1">
              <AddressBar
                tab={tab}
                engineName={state.searchEngineName}
                bookmarked={state.bookmarked}
                onDropdownChange={onDropdown}
              />
            </div>
            {!state.private && <ExtensionButtons state={state} actions={actions} />}
            {!state.private && (
              <button
                type="button"
                className="mb-icon-btn"
                aria-label="Extensions"
                title="Extensions"
                aria-expanded={popover?.kind === "extensions"}
                onClick={toggle("extensions")}
              >
                <PuzzleIcon />
              </button>
            )}
            <button
              type="button"
              className="mb-icon-btn relative"
              aria-label="Moon Shield"
              title={
                shieldOn ? `Moon Shield: ${tab?.blocked ?? 0} blocked` : "Moon Shield is off here"
              }
              aria-pressed={shieldOn}
              aria-expanded={popover?.kind === "shield"}
              onClick={toggle("shield")}
            >
              <ShieldIcon off={!!state.protection.site && !shieldOn} />
              {shieldOn && !!tab?.blocked && (
                <span className="mb-shield-count">{tab.blocked > 99 ? "99+" : tab.blocked}</span>
              )}
            </button>
            <button
              type="button"
              className="mb-icon-btn"
              aria-label={state.split ? "Close split view" : "Split view"}
              title={state.split ? "Close split view" : "Split view: show two tabs side by side"}
              aria-pressed={!!state.split}
              onClick={() => void ui.command({ type: state.split ? "unsplit" : "split" })}
            >
              <SplitIcon />
            </button>
            {state.downloads.length > 0 && (
              <button
                type="button"
                className="mb-icon-btn relative"
                aria-label="Downloads"
                title="Downloads"
                aria-expanded={popover?.kind === "downloads"}
                onClick={toggle("downloads")}
              >
                {running.length > 0 && (
                  <svg className="absolute inset-0.5" viewBox="0 0 36 36" aria-hidden="true">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="var(--mb-accent)"
                      strokeWidth="2.5"
                      strokeDasharray={`${Math.max(4, progress * 94)} 94`}
                      transform="rotate(-90 18 18)"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
                <DownloadIcon />
              </button>
            )}
            {state.updateReady && (
              <button
                type="button"
                className="mb-update-pill"
                title={`Restart Moon Browser to install version ${state.updateReady}. Your tabs come back.`}
                onClick={() => void ui.command({ type: "installUpdate" })}
              >
                <UpdateIcon size={14} /> Update
              </button>
            )}
            <button
              type="button"
              className="mb-icon-btn"
              aria-label="Menu"
              title="Menu"
              aria-expanded={popover?.kind === "menu"}
              onClick={toggle("menu")}
            >
              <MenuIcon />
            </button>
          </div>
          {state.showBookmarksBar && <BookmarksBar bookmarks={state.bookmarksBar} />}
          {prompt && <PromptBar key={prompt.id} prompt={prompt} />}
        </header>
      )}

      <div ref={content} className="relative flex min-h-0 flex-1 flex-col">
        <ContentArea state={state} snapshots={snapshots} onDividerDrag={setDragging} />
      </div>

      {findOpen && !state.fullscreen && <FindBar state={state} onClose={() => setFindTab(null)} />}

      {popover && popover.kind === "group" && (
        <Popover
          anchor={popover.anchor}
          align="left"
          width={250}
          label="Tab group"
          onClose={closePopover}
        >
          {(() => {
            const group = state.groups.find((g) => g.id === popover.groupId);
            return group ? (
              <GroupEditor key={group.id} group={group} onClose={closePopover} />
            ) : null;
          })()}
        </Popover>
      )}
      {popover && popover.kind !== "group" && (
        <Popover
          anchor={popover.anchor}
          width={
            popover.kind === "menu"
              ? 290
              : popover.kind === "shield" || popover.kind === "extensions"
                ? 320
                : 340
          }
          label={
            popover.kind === "menu"
              ? "Menu"
              : popover.kind === "shield"
                ? "Moon Shield"
                : popover.kind === "extensions"
                  ? "Extensions"
                  : "Downloads"
          }
          onClose={closePopover}
        >
          {popover.kind === "menu" && <MainMenu state={state} onClose={closePopover} />}
          {popover.kind === "shield" && <ShieldPanel state={state} onClose={closePopover} />}
          {popover.kind === "downloads" && <DownloadsPanel state={state} onClose={closePopover} />}
          {popover.kind === "extensions" && (
            <ExtensionsMenu
              state={state}
              actions={actions}
              anchor={popover.anchor}
              onClose={closePopover}
            />
          )}
        </Popover>
      )}
    </div>
  );
}
