import { useEffect, useState } from "react";
import { groupByDay, timeLabel } from "@shared/format";
import type { HistoryEntry } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import { CloseIcon, SearchIcon, TrashIcon } from "@theme/icons";
import { shortHost } from "@shared/display";
import { api } from "./api";
import { Card, EmptyState, PageShell } from "./ui";

const PAGE = 150;

export function HistoryPage() {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [tick, setTick] = useState(0);
  const [now] = useState(Date.now);

  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void api.history({ text, limit: PAGE }).then((list) => {
        if (!alive) return;
        setEntries(list);
        setMore(list.length === PAGE);
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [text, tick]);

  useEffect(() => window.moon.on((e) => e === "history" && setTick((t) => t + 1)), []);

  const loadMore = () => {
    if (!entries?.length) return;
    const before = entries[entries.length - 1].lastVisit;
    void api.history({ text, limit: PAGE, before }).then((list) => {
      setEntries((prev) => [...(prev ?? []), ...list]);
      setMore(list.length === PAGE);
    });
  };

  const remove = (url: string) => {
    setEntries((prev) => prev?.filter((e) => e.url !== url) ?? null);
    void api.removeHistory([url]);
  };

  const groups = entries ? groupByDay(entries, (e) => e.lastVisit, now) : [];

  return (
    <PageShell
      title="History"
      subtitle="Kept on this computer only. Private windows leave no trace here."
      actions={
        <a href="moon://settings/#privacy" className="mb-btn mb-btn-ghost no-underline">
          <TrashIcon /> Clear browsing data
        </a>
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
          placeholder="Search history"
          aria-label="Search history"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {entries && entries.length === 0 && (
        <Card>
          <EmptyState title={text ? "Nothing found" : "No history yet"}>
            {text ? "No visited page matches your search." : "Pages you visit will show up here."}
          </EmptyState>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.label} title={group.label}>
          <ul className="m-0 list-none p-1.5">
            {group.items.map((e) => (
              <li
                key={e.url}
                className="group flex items-center gap-3 rounded-[0.7rem] px-3 py-1.5 hover:bg-(--mb-hover)"
              >
                <span className="w-16 shrink-0 text-xs whitespace-nowrap text-(--mb-text-faint) tabular-nums">
                  {timeLabel(e.lastVisit)}
                </span>
                <Favicon url={e.url} src={e.favicon} />
                <a
                  href={e.url}
                  className="min-w-0 flex-1 truncate text-sm text-(--mb-text) no-underline hover:underline"
                  title={e.url}
                >
                  {e.title || e.url}
                  <span className="ml-2 text-xs text-(--mb-text-faint)">{shortHost(e.url)}</span>
                </a>
                <button
                  type="button"
                  className="mb-icon-btn h-7! w-7! opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove ${e.title || e.url} from history`}
                  onClick={() => remove(e.url)}
                >
                  <CloseIcon size={13} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {more && (
        <button type="button" className="mb-btn mb-btn-ghost self-center" onClick={loadMore}>
          Show older
        </button>
      )}
    </PageShell>
  );
}
