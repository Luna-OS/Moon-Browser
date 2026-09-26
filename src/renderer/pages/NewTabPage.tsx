import { useEffect, useRef, useState } from "react";
import { formatNumber, greeting } from "@shared/format";
import { moonPhase } from "@shared/moon";
import type { Settings } from "@shared/types";
import { Favicon } from "@theme/Favicon";
import { CloseIcon, FolderIcon, MaskIcon, SearchIcon, ShieldIcon } from "@theme/icons";
import { MoonPhase } from "@theme/MoonPhase";
import { shortHost } from "@shared/display";
import { api, useLive } from "./api";

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function NewTabPage({ settings }: { settings: Settings | null }) {
  const [info, reload] = useLive(api.newTab, ["history", "settings"]);
  const now = useNow(10_000);
  const moon = moonPhase(now);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const showShortcuts = settings?.newTabShortcuts !== false && !!info?.topSites.length;

  return (
    <main className="flex min-h-screen flex-col items-center px-6 pt-[12vh] pb-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <div title={`${moon.name} · ${Math.round(moon.illumination * 100)}% lit`}>
          <MoonPhase phase={moon.phase} size={92} />
        </div>
        <div className="mb-title text-6xl leading-none font-semibold tracking-tight tabular-nums">
          {time}
        </div>
        <p className="m-0 text-sm text-(--mb-text-muted)">
          {greeting(now.getHours())} · {moon.name}, {Math.round(moon.illumination * 100)}% lit
        </p>
      </div>

      <form
        className="mb-glass mt-9 flex w-full max-w-xl items-center gap-3 px-4"
        style={{ borderRadius: "999px", height: 52 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) void api.navigate(query);
        }}
      >
        <span className="text-(--mb-text-muted)">
          <SearchIcon size={18} />
        </span>
        <input
          ref={input}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[0.95rem] text-(--mb-text) outline-none placeholder:text-(--mb-text-faint)"
          placeholder={`Search with ${info?.engine ?? "your search engine"} or type an address`}
          aria-label="Search or type an address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>

      {showShortcuts && info && (
        <nav
          aria-label="Shortcuts"
          className="mt-10 grid w-full max-w-2xl grid-cols-4 gap-3 max-sm:grid-cols-2"
        >
          {info.topSites.map((site) => (
            <div key={site.url} className="group relative">
              <a
                href={site.url}
                className="flex flex-col items-center gap-2 rounded-2xl px-2 py-3.5 text-(--mb-text) no-underline transition-colors hover:bg-(--mb-hover)"
                title={site.title || site.url}
              >
                <span
                  className="mb-glass flex h-13 w-13 items-center justify-center"
                  style={{ borderRadius: "1rem" }}
                >
                  <Favicon url={site.url} src={site.favicon} size={24} />
                </span>
                <span className="w-full truncate text-center text-xs text-(--mb-text-muted)">
                  {site.title || shortHost(site.url)}
                </span>
              </a>
              <button
                type="button"
                className="mb-icon-btn absolute top-1 right-1 h-6! w-6! opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Remove ${shortHost(site.url)} from shortcuts`}
                title="Remove"
                onClick={() => void api.hideTopSite(site.url).then(reload)}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </nav>
      )}

      {info?.importFrom && (
        <div
          className="mb-glass mt-10 flex max-w-xl items-center gap-3 py-2.5 pr-2 pl-4 text-sm"
          style={{ borderRadius: "1rem" }}
        >
          <span className="text-(--mb-accent)">
            <FolderIcon size={17} />
          </span>
          <span className="flex-1">
            Bring your bookmarks and history over from {info.importFrom}.
          </span>
          <a
            href="moon://settings/#import"
            className="mb-btn mb-btn-primary mb-btn-sm no-underline"
          >
            Import
          </a>
          <button
            type="button"
            className="mb-icon-btn h-7! w-7!"
            aria-label="Don't show again"
            title="Don't show again"
            onClick={() => void api.dismissImportHint().then(reload)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      <div className="flex-1" />
      {info?.private ? (
        <p className="mb-chip mt-10 h-auto! px-3! py-1.5! text-center font-medium!">
          <MaskIcon size={14} /> Private window — no history is kept, and cookies disappear when the
          last private window closes.
        </p>
      ) : (
        info &&
        info.totalBlocked > 0 && (
          <p className="mb-chip mb-chip-mint mt-10 h-auto! px-3! py-1.5!">
            <ShieldIcon size={13} /> Moon Shield has blocked {formatNumber(info.totalBlocked)} ads
            and trackers
          </p>
        )
      )}
    </main>
  );
}
