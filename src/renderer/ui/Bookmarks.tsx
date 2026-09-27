/**
 * The bookmarks bar with its folders, a folder's menu (folders inside open
 * in place, with a way back; new folders go in), and the star's editor:
 * name, folder (or a new one), remove.
 */
import { useEffect, useState } from "react";
import type { Bookmark, BookmarkFolderChoice } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import { BackIcon, ChevronDownIcon, FolderIcon, PlusIcon, TabIcon } from "@theme/icons";
import { ui } from "./store";

const open = (url: string, e: React.MouseEvent) =>
  void ui.command({
    type: "openUrl",
    url,
    disposition:
      e.ctrlKey || e.metaKey || e.button === 1 ? "background" : e.shiftKey ? "window" : "current",
  });

const menu = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  void ui.command({ type: "bookmarkMenu", id, x: e.clientX, y: e.clientY });
};

export function BookmarksBar({
  bookmarks,
  openFolder,
  onOpenFolder,
}: {
  bookmarks: Bookmark[];
  /** The folder whose menu is open. */
  openFolder: string | null;
  onOpenFolder: (folder: Bookmark, anchor: DOMRect) => void;
}) {
  return (
    <nav
      className="mb-bookmarks-bar"
      aria-label="Bookmarks bar"
      onContextMenu={(e) => {
        // On the bar itself, not on one of its bookmarks.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        void ui.command({ type: "bookmarksBarMenu", x: e.clientX, y: e.clientY });
      }}
    >
      {bookmarks.length === 0 && (
        <span className="px-2 text-xs text-(--mb-text-faint)">
          Bookmark pages with the star or Ctrl+D to see them here.
        </span>
      )}
      {bookmarks.map((b) =>
        b.isFolder ? (
          <button
            type="button"
            key={b.id}
            className="mb-bookmark"
            data-bookmark-folder={b.id}
            aria-haspopup="menu"
            aria-expanded={openFolder === b.id}
            title={b.title}
            onClick={(e) => onOpenFolder(b, e.currentTarget.getBoundingClientRect())}
            onContextMenu={menu(b.id)}
          >
            <span className="text-(--mb-accent)">
              <FolderIcon size={14} />
            </span>
            <span>{b.title || "Folder"}</span>
          </button>
        ) : (
          <button
            type="button"
            key={b.id}
            className="mb-bookmark"
            title={`${b.title}\n${b.url}`}
            onClick={(e) => open(b.url, e)}
            onAuxClick={(e) => {
              if (e.button === 1) open(b.url, e);
            }}
            onContextMenu={menu(b.id)}
          >
            <Favicon url={b.url} src={b.favicon} size={14} />
            <span>{b.title || b.url}</span>
          </button>
        ),
      )}
    </nav>
  );
}

/** A folder's contents; a folder inside opens in its place. */
export function BookmarkFolderMenu({
  folder,
  onClose,
}: {
  folder: { id: string; title: string };
  onClose: () => void;
}) {
  const [path, setPath] = useState([folder]);
  const [items, setItems] = useState<{ folder: string; list: Bookmark[] } | null>(null);
  const here = path[path.length - 1];

  useEffect(() => {
    let current = true;
    void ui.bookmarkChildren(here.id).then((list) => {
      if (current) setItems({ folder: here.id, list });
    });
    return () => {
      current = false;
    };
  }, [here.id]);

  const list = items?.folder === here.id ? items.list : null;
  const links = list?.filter((b) => !b.isFolder).length ?? 0;
  return (
    <div role="menu" aria-label={here.title} className="mb-folder-menu">
      {path.length > 1 && (
        <button
          type="button"
          role="menuitem"
          className="mb-menu-item mb-folder-back"
          onClick={() => setPath((p) => p.slice(0, -1))}
        >
          <BackIcon size={14} />
          <span className="flex-1 truncate">{here.title}</span>
        </button>
      )}
      {list?.length === 0 && <p className="mb-folder-empty">This folder is empty.</p>}
      {list?.map((b) =>
        b.isFolder ? (
          <button
            type="button"
            role="menuitem"
            key={b.id}
            className="mb-menu-item"
            onClick={() => setPath((p) => [...p, { id: b.id, title: b.title }])}
            onContextMenu={menu(b.id)}
          >
            <span className="text-(--mb-accent)">
              <FolderIcon size={15} />
            </span>
            <span className="flex-1 truncate">{b.title || "Folder"}</span>
            <span className="-rotate-90 text-(--mb-text-faint)">
              <ChevronDownIcon />
            </span>
          </button>
        ) : (
          <button
            type="button"
            role="menuitem"
            key={b.id}
            className="mb-menu-item"
            title={b.url}
            onClick={(e) => {
              open(b.url, e);
              if (!(e.ctrlKey || e.metaKey)) onClose();
            }}
            onAuxClick={(e) => {
              if (e.button === 1) open(b.url, e);
            }}
            onContextMenu={menu(b.id)}
          >
            <Favicon url={b.url} src={b.favicon} size={15} />
            <span className="flex-1 truncate">{b.title || b.url}</span>
          </button>
        ),
      )}
      <div className="mb-menu-sep" role="separator" />
      {links > 0 && (
        <button
          type="button"
          role="menuitem"
          className="mb-menu-item"
          onClick={() => {
            void ui.command({
              type: "openBookmarkFolder",
              id: here.id,
              disposition: "background",
            });
            onClose();
          }}
        >
          <TabIcon size={15} />
          <span className="flex-1">Open all ({links}) in new tabs</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="mb-menu-item"
        onClick={() => {
          // Named in a Moon dialog, which takes the menu's place.
          void ui.command({ type: "newBookmarkFolder", parent: here.id });
          onClose();
        }}
      >
        <PlusIcon size={15} />
        <span className="flex-1 truncate">New folder in “{here.title || "Folder"}”</span>
      </button>
    </div>
  );
}

/** The star's editor: the page's bookmark, its name and folder. */
export function BookmarkEditor({
  bookmark,
  added,
  barVisible,
  onClose,
}: {
  bookmark: Bookmark;
  /** Just bookmarked (rather than opened again). */
  added: boolean;
  /** Whether the bookmarks bar shows (it can be switched here). */
  barVisible: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(bookmark.title);
  const [parent, setParent] = useState(bookmark.parent);
  const [folders, setFolders] = useState<BookmarkFolderChoice[]>([]);
  /** The name of a folder being made in the chosen one; null while not. */
  const [newFolder, setNewFolder] = useState<string | null>(null);
  useEffect(() => {
    void ui.bookmarkFolders().then(setFolders);
  }, []);

  const makeFolder = async () => {
    if (newFolder === null) return;
    const made = await ui.addBookmarkFolder(newFolder, parent);
    setFolders(await ui.bookmarkFolders());
    if (made) setParent(made.id);
    setNewFolder(null);
  };
  const where = folders.find((f) => f.id === parent)?.path ?? "Bookmarks bar";

  const done = () => {
    void ui.command({ type: "updateBookmark", id: bookmark.id, title, parent });
    onClose();
  };
  return (
    <form
      className="flex flex-col gap-2.5 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        done();
      }}
    >
      <p className="mb-eyebrow">{added ? "Bookmark added" : "Edit bookmark"}</p>
      <label className="flex flex-col gap-1 text-xs text-(--mb-text-muted)">
        Name
        <input
          className="mb-input"
          value={title}
          maxLength={512}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="flex flex-col gap-1 text-xs text-(--mb-text-muted)">
        <label htmlFor="mb-bookmark-folder">Folder</label>
        <div className="flex gap-1.5">
          <select
            id="mb-bookmark-folder"
            className="mb-input min-w-0 flex-1"
            value={parent ?? ""}
            onChange={(e) => setParent(e.target.value || null)}
          >
            {folders.map((f) => (
              <option key={f.id ?? ""} value={f.id ?? ""}>
                {f.path}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mb-icon-btn"
            aria-label="New folder"
            title={`New folder in “${where}”`}
            aria-expanded={newFolder !== null}
            onClick={() => setNewFolder((v) => (v === null ? "" : null))}
          >
            <PlusIcon size={15} />
          </button>
        </div>
      </div>
      {newFolder !== null && (
        <div className="flex flex-col gap-1 text-xs text-(--mb-text-muted)">
          <label htmlFor="mb-new-folder">New folder in “{where}”</label>
          <div className="flex gap-1.5">
            <input
              id="mb-new-folder"
              className="mb-input min-w-0 flex-1"
              value={newFolder}
              maxLength={512}
              placeholder="New folder"
              autoFocus
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => {
                // Enter makes the folder here; it doesn't close the editor.
                if (e.key === "Enter") {
                  e.preventDefault();
                  void makeFolder();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setNewFolder(null);
                }
              }}
            />
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => void makeFolder()}
            >
              Create
            </button>
          </div>
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-(--mb-text-muted)">
        <span className="flex-1">Show bookmarks bar</span>
        <input
          type="checkbox"
          className="mb-switch"
          checked={barVisible}
          onChange={() => void ui.command({ type: "toggleBookmarksBar" })}
        />
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          className="mb-btn mb-btn-danger mb-btn-sm"
          onClick={() => {
            void ui.command({ type: "removeBookmark", id: bookmark.id });
            onClose();
          }}
        >
          Remove
        </button>
        <button type="submit" className="mb-btn mb-btn-primary mb-btn-sm">
          Done
        </button>
      </div>
    </form>
  );
}
