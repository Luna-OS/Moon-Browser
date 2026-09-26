/**
 * Extensions in the browser UI: the buttons of pinned extensions in the
 * toolbar, and the extensions menu behind the puzzle button — like Chrome's,
 * grouped by whether an extension can read the current site.
 *
 * Icons, badges and pop-ups come from electron-chrome-extensions through
 * `window.browserAction`; everything else from the window state.
 */
import { useState } from "react";
import { EXTENSIONS_PARTITION } from "@shared/extensions";
import type { ExtensionEntry, WindowState } from "@shared/types";
import {
  CloseIcon,
  ExternalIcon,
  MoreIcon,
  PuzzleIcon,
  SettingsIcon,
  ThumbtackIcon,
} from "@theme/icons";
import type { BrowserActionState } from "../env";
import { actionFor, activateExtension, badgeColor, type ActionInfo } from "./extension-actions";
import { ui } from "./store";

function ExtensionIcon({
  entry,
  action,
  tab,
  size = 18,
}: {
  entry: ExtensionEntry;
  action: ActionInfo | undefined;
  tab: number | null;
  size?: number;
}) {
  // The toolbar icon the extension chose (it can change per tab), else its app icon.
  const actionIcon = action
    ? `crx://extension-icon/${entry.id}/32/2?${new URLSearchParams({
        tabId: String(tab ?? -1),
        partition: EXTENSIONS_PARTITION,
        t: String(action.iconModified ?? 0),
      }).toString()}`
    : null;
  const [failed, setFailed] = useState<string | null>(null);
  const src = actionIcon && failed !== actionIcon ? actionIcon : entry.icon;
  if (!src) return <PuzzleIcon size={size} />;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      className="shrink-0"
      onError={() => actionIcon && setFailed(actionIcon)}
    />
  );
}

/** The pinned extensions' buttons in the toolbar. */
export function ExtensionButtons({
  state,
  actions,
}: {
  state: WindowState;
  actions: BrowserActionState | null;
}) {
  return (
    <>
      {state.extensions
        .filter((e) => e.pinned)
        .map((entry) => {
          const action = actionFor(actions, entry.id, state.extensionTab);
          const label = action?.title || entry.name;
          return (
            <button
              key={entry.id}
              type="button"
              className="mb-icon-btn relative"
              aria-label={label}
              title={label}
              aria-pressed={state.sidePanel?.extensionId === entry.id || undefined}
              onClick={(e) =>
                activateExtension(state, entry, e.currentTarget.getBoundingClientRect())
              }
              onContextMenu={(e) => {
                e.preventDefault();
                void ui.command({
                  type: "extensionMenu",
                  extensionId: entry.id,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              <ExtensionIcon entry={entry} action={action} tab={state.extensionTab} />
              {action?.text && (
                <span className="mb-ext-badge" style={{ background: badgeColor(action.color) }}>
                  {action.text.slice(0, 4)}
                </span>
              )}
            </button>
          );
        })}
    </>
  );
}

/** The extensions menu behind the puzzle button. */
export function ExtensionsMenu({
  state,
  actions,
  anchor,
  onClose,
}: {
  state: WindowState;
  actions: BrowserActionState | null;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const full = state.extensions.filter((e) => e.access === "full");
  const none = state.extensions.filter((e) => e.access === "none");

  const row = (entry: ExtensionEntry) => (
    <div key={entry.id} className="flex items-center gap-0.5 pr-1" role="none">
      <button
        type="button"
        role="menuitem"
        className="mb-menu-item min-w-0 flex-1"
        title={entry.opensSidePanel ? `Open ${entry.name} in the side panel` : `Open ${entry.name}`}
        onClick={() => {
          onClose();
          activateExtension(state, entry, anchor);
        }}
      >
        <ExtensionIcon
          entry={entry}
          action={actionFor(actions, entry.id, state.extensionTab)}
          tab={state.extensionTab}
        />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      <button
        type="button"
        className={`mb-icon-btn h-7! w-7! ${entry.pinned ? "text-(--mb-accent)!" : ""}`}
        aria-label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
        aria-pressed={entry.pinned}
        title={entry.pinned ? "Unpin from toolbar" : "Pin to toolbar"}
        onClick={() =>
          void ui.command({ type: "extensionPin", extensionId: entry.id, pinned: !entry.pinned })
        }
      >
        <ThumbtackIcon size={14} filled={entry.pinned} />
      </button>
      <button
        type="button"
        className="mb-icon-btn h-7! w-7!"
        aria-label={`More for ${entry.name}`}
        title="More"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          void ui.command({ type: "extensionMenu", extensionId: entry.id, x: r.left, y: r.bottom });
        }}
      >
        <MoreIcon size={15} />
      </button>
    </div>
  );

  const group = (title: string, hint: string, items: ExtensionEntry[]) =>
    items.length > 0 && (
      <section className="mb-1">
        <h3 className="m-0 px-2.5 pt-2 text-xs font-semibold">{title}</h3>
        <p className="m-0 px-2.5 pb-1.5 text-xs leading-snug text-(--mb-text-muted)">{hint}</p>
        {items.map(row)}
      </section>
    );

  return (
    <div role="menu" aria-label="Extensions">
      <div className="flex items-center justify-between py-1 pr-1 pl-2.5">
        <span className="text-[0.95rem] font-semibold">Extensions</span>
        <button
          type="button"
          className="mb-icon-btn h-7! w-7!"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      {state.extensions.length === 0 ? (
        <p className="m-0 px-2.5 py-3 text-sm leading-relaxed text-(--mb-text-muted)">
          No extensions yet. Add your password manager and more from the Chrome Web Store.
        </p>
      ) : (
        <>
          {group("Full access", "These extensions can read and change data on this site.", full)}
          {group(
            "No access needed",
            "These extensions don't need to read or change data on this site.",
            none,
          )}
        </>
      )}
      <div className="mb-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="mb-menu-item"
        onClick={() => {
          onClose();
          void ui.command({
            type: "openUrl",
            url: "https://chromewebstore.google.com/category/extensions",
            disposition: "foreground",
          });
        }}
      >
        <ExternalIcon size={15} />
        <span className="flex-1">Chrome Web Store</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="mb-menu-item"
        onClick={() => {
          onClose();
          void ui.command({ type: "openPage", page: "extensions" });
        }}
      >
        <SettingsIcon size={15} />
        <span className="flex-1">Manage extensions</span>
      </button>
    </div>
  );
}
