import { useState } from "react";
import type { Bookmark } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import { ChevronDownIcon, ChevronUpIcon, EditIcon, SearchIcon, TrashIcon } from "@theme/icons";
import { shortHost } from "@shared/display";
import { api, useLive } from "./api";
import { Card, EmptyState, PageShell } from "./ui";

export function BookmarksPage() {
  const [bookmarks] = useLive(api.bookmarks, ["bookmarks"]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const list = (bookmarks ?? []).filter(
    (b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q),
  );

  return (
    <PageShell title="Bookmarks" subtitle="Add one with the star in the address bar or Ctrl+D.">
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

      <Card>
        {bookmarks && list.length === 0 ? (
          <EmptyState title={q ? "Nothing found" : "No bookmarks yet"}>
            {q ? "No bookmark matches your search." : "Pages you bookmark will be kept here."}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none p-1.5">
            {list.map((b) =>
              editing === b.id ? (
                <EditRow key={b.id} bookmark={b} onDone={() => setEditing(null)} />
              ) : (
                <li
                  key={b.id}
                  className="group flex items-center gap-3 rounded-[0.7rem] px-3 py-2 hover:bg-(--mb-hover)"
                >
                  <Favicon url={b.url} src={b.favicon} />
                  <a
                    href={b.url}
                    className="min-w-0 flex-1 truncate text-sm text-(--mb-text) no-underline hover:underline"
                    title={b.url}
                  >
                    {b.title || b.url}
                    <span className="ml-2 text-xs text-(--mb-text-faint)">{shortHost(b.url)}</span>
                  </a>
                  <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {!q && (
                      <>
                        <button
                          type="button"
                          className="mb-icon-btn h-7! w-7!"
                          aria-label="Move up"
                          onClick={() =>
                            void api.updateBookmark(b.id, {
                              index: (bookmarks ?? []).indexOf(b) - 1,
                            })
                          }
                        >
                          <ChevronUpIcon />
                        </button>
                        <button
                          type="button"
                          className="mb-icon-btn h-7! w-7!"
                          aria-label="Move down"
                          onClick={() =>
                            void api.updateBookmark(b.id, {
                              index: (bookmarks ?? []).indexOf(b) + 1,
                            })
                          }
                        >
                          <ChevronDownIcon />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="mb-icon-btn h-7! w-7!"
                      aria-label="Edit"
                      onClick={() => setEditing(b.id)}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="mb-icon-btn h-7! w-7!"
                      aria-label="Delete"
                      onClick={() => void api.removeBookmark(b.id)}
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

function EditRow({ bookmark, onDone }: { bookmark: Bookmark; onDone: () => void }) {
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  return (
    <li className="px-2 py-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void api.updateBookmark(bookmark.id, { title, url }).then(onDone);
        }}
      >
        <input
          className="mb-input min-w-40 flex-1"
          aria-label="Name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="mb-input min-w-60 flex-[2]"
          aria-label="Address"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
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
