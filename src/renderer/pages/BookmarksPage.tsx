import { useState } from "react";
import { childrenOf, descendantsOf, folderChoices, pathOf } from "@shared/bookmarks";
import type { Bookmark } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import {
  BackIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EditIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@theme/icons";
import { shortHost } from "@shared/display";
import { api, useLive } from "./api";
import { Card, EmptyState, PageShell } from "./ui";

export function BookmarksPage() {
  const [bookmarks] = useLive(api.bookmarks, ["bookmarks"]);
  const [settings] = useLive(api.settings, ["settings"]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  /** The folder on show; null is the bookmarks bar. */
  const [folder, setFolder] = useState<string | null>(null);

  const all = bookmarks ?? [];
  // A folder that was deleted meanwhile: back to the bar.
  const here = folder && all.some((b) => b.id === folder && b.isFolder) ? folder : null;
  const q = filter.trim().toLowerCase();
  const list = q
    ? all.filter(
        (b) =>
          !b.isFolder && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)),
      )
    : childrenOf(all, here);

  // The way down to this folder, for the breadcrumbs.
  const trail: Bookmark[] = [];
  for (let id = here; id !== null && trail.length < 32;) {
    const f = all.find((b) => b.id === id);
    if (!f) break;
    trail.unshift(f);
    id = f.parent;
  }

  /** A new folder in `parent`, shown there with its name ready to type. */
  const newFolder = (parent: string | null) =>
    void api.addBookmarkFolder("New folder", parent).then((f) => {
      setFilter("");
      setFolder(parent);
      setEditing(f.id);
    });
  const hereTitle = trail[trail.length - 1]?.title;

  return (
    <PageShell
      title="Bookmarks"
      subtitle="Add one with the star in the address bar or Ctrl+D."
      actions={
        <>
          {settings && (
            <label className="flex cursor-pointer items-center gap-2.5 pr-2 text-sm text-(--mb-text-muted)">
              Show bookmarks bar
              <input
                type="checkbox"
                className="mb-switch"
                checked={settings.settings.showBookmarksBar}
                onChange={(e) => void api.showBookmarksBar(e.target.checked)}
              />
            </label>
          )}
          <button type="button" className="mb-btn mb-btn-ghost" onClick={() => newFolder(here)}>
            <PlusIcon size={15} />{" "}
            {here === null ? "New folder" : `New folder in “${hereTitle || "Folder"}”`}
          </button>
        </>
      }
    >
      <label
        className="mb-glass flex h-11 items-center gap-2.5 px-4"
        style={{ borderRadius: "0.9rem" }}
      >
        <span className="text-(--mb-text-muted)">
          <SearchIcon size={16} />
        </span>
        <input
          className="h-full flex-1 border-0 bg-transparent text-sm text-(--mb-text) outline-none placeholder:text-(--mb-text-faint)"
          placeholder="Search bookmarks"
          aria-label="Search bookmarks"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>

      {!q && (
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
          {here !== null && (
            <button
              type="button"
              className="mb-icon-btn h-7! w-7!"
              aria-label="Up one folder"
              onClick={() => setFolder(trail[trail.length - 1]?.parent ?? null)}
            >
              <BackIcon size={15} />
            </button>
          )}
          <button
            type="button"
            className="mb-crumb"
            aria-current={here === null ? "page" : undefined}
            onClick={() => setFolder(null)}
          >
            Bookmarks bar
          </button>
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <span className="text-(--mb-text-faint)">/</span>
              <button
                type="button"
                className="mb-crumb"
                aria-current={f.id === here ? "page" : undefined}
                onClick={() => setFolder(f.id)}
              >
                {f.title}
              </button>
            </span>
          ))}
        </nav>
      )}

      <Card>
        {bookmarks && list.length === 0 ? (
          <EmptyState
            title={q ? "Nothing found" : here ? "This folder is empty" : "No bookmarks yet"}
          >
            {q
              ? "No bookmark matches your search."
              : here
                ? "Move bookmarks here with “Move to”, or bookmark a page into it with the star."
                : "Pages you bookmark will be kept here."}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none p-1.5">
            {list.map((b, i) =>
              editing === b.id ? (
                <EditRow key={b.id} bookmark={b} onDone={() => setEditing(null)} />
              ) : (
                <li
                  key={b.id}
                  className="group flex items-center gap-3 rounded-[0.7rem] px-3 py-2 hover:bg-(--mb-hover)"
                >
                  {b.isFolder ? (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-sm text-(--mb-text)"
                      onClick={() => setFolder(b.id)}
                    >
                      <span className="text-(--mb-accent)">
                        <FolderIcon size={16} />
                      </span>
                      <span className="truncate font-medium">{b.title}</span>
                      <span className="text-xs text-(--mb-text-faint)">
                        {childrenOf(all, b.id).length}
                      </span>
                    </button>
                  ) : (
                    <>
                      <Favicon url={b.url} src={b.favicon} />
                      <a
                        href={b.url}
                        className="min-w-0 flex-1 truncate text-sm text-(--mb-text) no-underline hover:underline"
                        title={b.url}
                      >
                        {b.title || b.url}
                        <span className="ml-2 text-xs text-(--mb-text-faint)">
                          {q ? pathOf(all, b.id) || shortHost(b.url) : shortHost(b.url)}
                        </span>
                      </a>
                    </>
                  )}
                  <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {!q && (
                      <>
                        <button
                          type="button"
                          className="mb-icon-btn h-7! w-7!"
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => void api.updateBookmark(b.id, { index: i - 1 })}
                        >
                          <ChevronUpIcon />
                        </button>
                        <button
                          type="button"
                          className="mb-icon-btn h-7! w-7!"
                          aria-label="Move down"
                          disabled={i === list.length - 1}
                          onClick={() => void api.updateBookmark(b.id, { index: i + 1 })}
                        >
                          <ChevronDownIcon />
                        </button>
                      </>
                    )}
                    {b.isFolder && (
                      <button
                        type="button"
                        className="mb-icon-btn h-7! w-7!"
                        aria-label={`New folder in “${b.title || "Folder"}”`}
                        title="New folder inside"
                        onClick={() => newFolder(b.id)}
                      >
                        <PlusIcon size={15} />
                      </button>
                    )}
                    <MoveTo bookmark={b} all={all} />
                    <button
                      type="button"
                      className="mb-icon-btn h-7! w-7!"
                      aria-label={b.isFolder ? "Rename" : "Edit"}
                      onClick={() => setEditing(b.id)}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="mb-icon-btn h-7! w-7!"
                      aria-label="Delete"
                      onClick={() => {
                        const inside = b.isFolder ? descendantsOf(all, b.id).size : 0;
                        if (
                          inside === 0 ||
                          confirm(
                            `Delete “${b.title}” and the ${inside} bookmarks and folders in it?`,
                          )
                        )
                          void api.removeBookmark(b.id);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}

/** Moves a bookmark or folder to another folder (never into itself). */
function MoveTo({ bookmark, all }: { bookmark: Bookmark; all: Bookmark[] }) {
  const inside = bookmark.isFolder ? descendantsOf(all, bookmark.id) : new Set<string>();
  const choices = folderChoices(all).filter(
    (f) => f.id === null || (f.id !== bookmark.id && !inside.has(f.id)),
  );
  return (
    <select
      className="mb-move-to"
      aria-label="Move to folder"
      title="Move to folder"
      value={bookmark.parent ?? ""}
      onChange={(e) => void api.updateBookmark(bookmark.id, { parent: e.target.value || null })}
    >
      {choices.map((f) => (
        <option key={f.id ?? ""} value={f.id ?? ""}>
          {f.path}
        </option>
      ))}
    </select>
  );
}

function EditRow({ bookmark, onDone }: { bookmark: Bookmark; onDone: () => void }) {
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  return (
    <li className="px-2 py-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void api
            .updateBookmark(bookmark.id, bookmark.isFolder ? { title } : { title, url })
            .then(onDone);
        }}
      >
        <input
          className="mb-input min-w-40 flex-1"
          aria-label="Name"
          value={title}
          // A new folder is named right away.
          autoFocus={bookmark.isFolder}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setTitle(e.target.value)}
        />
        {!bookmark.isFolder && (
          <input
            className="mb-input min-w-60 flex-[2]"
            aria-label="Address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
        <button type="submit" className="mb-btn mb-btn-primary mb-btn-sm">
          Save
        </button>
        <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={onDone}>
          Cancel
        </button>
      </form>
    </li>
  );
}
