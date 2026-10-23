import { useEffect, useState } from "react";
import { WEB_STORE_URL, webStoreDetailUrl } from "@shared/extensions";
import { timeAgo } from "@shared/format";
import type { ExtensionError, ExtensionInfo } from "@shared/types";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardIcon,
  ExternalIcon,
  FolderIcon,
  GlobeIcon,
  PuzzleIcon,
  ReloadIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  UpdateIcon,
  WarningIcon,
} from "@theme/icons";
import { api, useLive } from "./api";
import { Card, EmptyState, PageShell } from "./ui";

/** Password managers people usually look for first. */
const SUGGESTIONS = [
  { name: "NordPass", id: "eiaeiblijfjekdanodkjadfinkhbfgcd" },
  { name: "Bitwarden", id: "nngceckbapebfimnlniiiahkandclblb" },
  { name: "1Password", id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa" },
];

/** With more extensions than this, the page offers a search box. */
const SEARCH_FROM = 6;
/** Permissions shown before "+N more". */
const PERMISSIONS_SHOWN = 3;

/** The permission about which websites it can read and change. */
const SITE_ACCESS = /^Read and change (all )?your data on /;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ExtensionsPage() {
  const [list] = useLive(api.extensions, ["extensions"]);
  const [developer] = useLive(api.developerMode, ["extensions"]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (ext) =>
      !q ||
      ext.name.toLowerCase().includes(q) ||
      ext.description.toLowerCase().includes(q) ||
      ext.id.includes(q),
  );
  const on = list?.filter((ext) => ext.enabled).length ?? 0;
  const troubled = list?.filter((ext) => ext.errors.length > 0).length ?? 0;
  return (
    <PageShell
      title="Extensions"
      subtitle="From the Chrome Web Store — in normal windows, never in private ones."
      actions={
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-(--mb-text-muted)">
            Developer mode
            <input
              type="checkbox"
              className="mb-switch"
              checked={developer === true}
              onChange={(e) => {
                setLoadError(null);
                void api.setDeveloperMode(e.target.checked);
              }}
            />
          </label>
          <a
            className="mb-btn mb-btn-primary no-underline"
            href={WEB_STORE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalIcon /> Chrome Web Store
          </a>
        </>
      }
    >
      {developer && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.75rem] border border-(--mb-border) bg-(--mb-inset) text-(--mb-accent)"
              aria-hidden="true"
            >
              <FolderIcon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Your own extensions</div>
              <p className="m-0 mt-0.5 text-xs leading-relaxed text-(--mb-text-muted)">
                Load an extension from a folder with a manifest.json. It runs only while developer
                mode is on, and “Reload” picks up your changes.
              </p>
              {loadError && (
                <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-(--mb-danger)">
                  <WarningIcon size={12} /> {loadError}
                </p>
              )}
            </div>
            <button
              type="button"
              className="mb-btn mb-btn-ghost"
              onClick={() => {
                setLoadError(null);
                void api.loadUnpacked().then(setLoadError);
              }}
            >
              <FolderIcon /> Load unpacked
            </button>
          </div>
        </Card>
      )}
      {list && list.length === 0 && (
        <Card>
          <EmptyState title="No extensions yet">
            Open an extension in the Chrome Web Store and choose “Add to Moon Browser”. Before
            anything is added, Moon Browser shows what the extension will be able to do.
          </EmptyState>
          <div className="flex flex-wrap items-center justify-center gap-2 px-5 pb-7">
            <span className="text-xs text-(--mb-text-muted)">Password managers:</span>
            {SUGGESTIONS.map((s) => (
              <a
                key={s.id}
                className="mb-chip no-underline hover:border-(--mb-accent)"
                href={webStoreDetailUrl(s.id)}
                target="_blank"
                rel="noreferrer"
              >
                {s.name}
              </a>
            ))}
          </div>
        </Card>
      )}
      {list && list.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-(--mb-text-muted)">
              <span>{plural(list.length, "extension")}</span>
              <span className="text-(--mb-text-faint)">·</span>
              <span>{on} on</span>
              {troubled > 0 && (
                <>
                  <span className="text-(--mb-text-faint)">·</span>
                  <span className="text-(--mb-warning)">{troubled} with issues</span>
                </>
              )}
            </p>
            {list.length >= SEARCH_FROM && (
              <label
                className="mb-glass flex h-9 w-full items-center gap-2 px-3 sm:w-64"
                style={{ borderRadius: "0.75rem" }}
              >
                <span className="text-(--mb-text-muted)">
                  <SearchIcon size={14} />
                </span>
                <input
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-(--mb-text) outline-none placeholder:text-(--mb-text-faint)"
                  placeholder="Search extensions"
                  aria-label="Search extensions"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            )}
          </div>
          {shown.length === 0 ? (
            <Card>
              <EmptyState title="Nothing found">No extension matches your search.</EmptyState>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 has-[>[data-open]]:items-start">
              {shown.map((ext) => (
                <ExtensionCard key={ext.id} ext={ext} developer={developer === true} />
              ))}
            </div>
          )}
        </>
      )}
      <p className="m-0 text-center text-xs leading-relaxed text-(--mb-text-faint)">
        Extensions are updated from the Chrome Web Store automatically. Moon Shield keeps blocking
        ads and trackers on its own — no ad-blocking extension needed.
      </p>
    </PageShell>
  );
}

function ExtensionCard({ ext, developer }: { ext: ExtensionInfo; developer: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [allPermissions, setAllPermissions] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const permissions = allPermissions
    ? ext.permissions
    : ext.permissions.slice(0, PERMISSIONS_SHOWN);
  const hidden = ext.permissions.length - permissions.length;
  return (
    <article
      className="mb-glass flex min-w-0 flex-col"
      aria-label={ext.name}
      // Open issues make it taller than its neighbor, which keeps its size.
      data-open={(issuesOpen && ext.errors.length > 0) || undefined}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3.5">
          <span
            className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[0.9rem] border border-(--mb-border) bg-(--mb-inset) transition-opacity"
            style={{ opacity: ext.enabled ? 1 : 0.45 }}
          >
            {ext.icon ? (
              <img src={ext.icon} width={34} height={34} alt="" />
            ) : (
              <PuzzleIcon size={22} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2
                className={`m-0 truncate text-[0.95rem] font-semibold ${ext.enabled ? "" : "text-(--mb-text-muted)"}`}
                title={ext.name}
              >
                {ext.name}
              </h2>
              {ext.version && (
                <span className="shrink-0 text-xs text-(--mb-text-faint)">{ext.version}</span>
              )}
            </div>
            {(!ext.enabled || ext.unpacked || ext.damaged) && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {!ext.enabled && <span className="mb-chip">Off</span>}
                {ext.unpacked && <span className="mb-chip">Unpacked</span>}
                {ext.damaged && <span className="mb-chip mb-chip-warning">Damaged</span>}
              </div>
            )}
            {ext.description && (
              <p className="m-0 mt-1 line-clamp-2 text-xs leading-relaxed text-(--mb-text-muted)">
                {ext.description}
              </p>
            )}
          </div>
          <input
            type="checkbox"
            className="mb-switch mt-0.5"
            aria-label={`${ext.name} on or off`}
            title={ext.enabled ? "On" : "Off"}
            checked={ext.enabled}
            onChange={(e) => void api.setExtensionEnabled(ext.id, e.target.checked)}
          />
        </div>

        {ext.permissions.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="It can">
            {permissions.map((text) => (
              <li
                key={text}
                className="inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border border-(--mb-border) bg-(--mb-inset) px-2.5 py-0.5 text-[0.7rem] leading-snug text-(--mb-text-muted)"
              >
                {SITE_ACCESS.test(text) && (
                  <span className="text-(--mb-accent)">
                    <GlobeIcon size={11} />
                  </span>
                )}
                {text}
              </li>
            ))}
            {(hidden > 0 || allPermissions) && ext.permissions.length > PERMISSIONS_SHOWN && (
              <li>
                <button
                  type="button"
                  className="inline-flex h-6 cursor-pointer items-center rounded-full border border-dashed border-(--mb-border-strong) bg-transparent px-2.5 text-[0.7rem] text-(--mb-accent) hover:bg-(--mb-hover)"
                  onClick={() => setAllPermissions(!allPermissions)}
                >
                  {allPermissions ? "Less" : `+${hidden} more`}
                </button>
              </li>
            )}
          </ul>
        )}

        {ext.unsupported.map((text) => (
          <p key={text} className="m-0 flex items-start gap-1.5 text-xs text-(--mb-warning)">
            <span className="mt-px">
              <WarningIcon size={12} />
            </span>
            {text}
          </p>
        ))}

        {ext.damaged && (
          <div className="flex flex-wrap items-center gap-2 rounded-[0.7rem] border border-(--mb-border) bg-(--mb-inset) px-3 py-2.5 text-xs">
            <span className="text-(--mb-warning)">
              <WarningIcon size={13} />
            </span>
            <span className="min-w-0 flex-1 leading-relaxed text-(--mb-text-muted)">
              Its files are damaged, so it can't work. Repairing installs it again from the Chrome
              Web Store; your settings and logins in it stay.
            </span>
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-primary"
              disabled={repairing}
              onClick={() => {
                setRepairing(true);
                void api.repairExtension(ext.id).finally(() => setRepairing(false));
              }}
            >
              <UpdateIcon size={13} /> {repairing ? "Repairing…" : "Repair"}
            </button>
          </div>
        )}

        {developer && (
          <p className="m-0 font-mono text-[0.68rem] leading-relaxed break-all text-(--mb-text-faint)">
            ID {ext.id}
            {ext.path && (
              <>
                <br />
                {ext.path}
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-t border-(--mb-border) px-4 py-2.5">
        {confirming ? (
          <>
            <span className="mr-auto min-w-0 text-xs text-(--mb-text-muted)">
              Remove {ext.name}?{ext.unpacked && " Its folder stays."}
            </span>
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-danger"
              onClick={() => void api.removeExtension(ext.id)}
            >
              Remove
            </button>
            <button type="button" className="mb-btn mb-btn-sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            {ext.hasOptions && ext.enabled && (
              <button
                type="button"
                className="mb-btn mb-btn-sm mb-btn-ghost"
                onClick={() => void api.extensionOptions(ext.id)}
              >
                <SettingsIcon size={13} /> Options
              </button>
            )}
            {ext.unpacked ? (
              <button
                type="button"
                className="mb-btn mb-btn-sm mb-btn-ghost"
                onClick={() => void api.reloadExtension(ext.id)}
              >
                <ReloadIcon size={13} /> Reload
              </button>
            ) : (
              <a
                className="mb-btn mb-btn-sm mb-btn-ghost no-underline"
                href={webStoreDetailUrl(ext.id)}
                target="_blank"
                rel="noreferrer"
              >
                Web Store
              </a>
            )}
            <button
              type="button"
              className="mb-btn mb-btn-sm text-(--mb-text-muted) hover:text-(--mb-danger)"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon size={13} /> Remove
            </button>
            {ext.errors.length > 0 && (
              <button
                type="button"
                className="mb-chip mb-chip-warning ml-auto h-7! cursor-pointer gap-1.5! px-2.5! text-[0.72rem]!"
                aria-expanded={issuesOpen}
                onClick={() => setIssuesOpen(!issuesOpen)}
              >
                <WarningIcon size={12} />
                {plural(ext.errors.length, "issue")}
                {issuesOpen ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
              </button>
            )}
          </>
        )}
      </div>

      {issuesOpen && ext.errors.length > 0 && (
        <Issues ext={ext} onCleared={() => setIssuesOpen(false)} />
      )}
    </article>
  );
}

/** Re-renders now and then, so "2 min ago" stays true. */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

function issuesText(ext: ExtensionInfo, errors: ExtensionError[]): string {
  const lines = errors.map((e) => {
    const where = e.source ? ` (${e.source})` : "";
    const times = e.count > 1 ? ` ×${e.count}` : "";
    return `[${new Date(e.last).toISOString()}] ${e.message}${where}${times}`;
  });
  return [`${ext.name} ${ext.version} (${ext.id})`, ...lines].join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not allowed (the page isn't focused): the old way still works.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function Issues({ ext, onCleared }: { ext: ExtensionInfo; onCleared: () => void }) {
  const now = useNow(30_000);
  const [copied, setCopied] = useState(false);
  // Newest first.
  const errors = [...ext.errors].reverse();
  return (
    <div className="border-t border-(--mb-border) bg-(--mb-inset) px-4 pt-3 pb-3.5 [border-bottom-left-radius:inherit] [border-bottom-right-radius:inherit]">
      <div className="flex items-center gap-1.5">
        <p className="m-0 mr-auto text-xs text-(--mb-text-muted)">Newest first</p>
        <button
          type="button"
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() =>
            void copyText(issuesText(ext, errors)).then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <ClipboardIcon size={13} /> {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="mb-btn mb-btn-sm mb-btn-ghost"
          onClick={() => {
            onCleared();
            void api.clearExtensionErrors(ext.id);
          }}
        >
          Clear
        </button>
      </div>
      <ul className="m-0 mt-2.5 flex max-h-80 list-none flex-col gap-1.5 overflow-y-auto p-0">
        {errors.map((error) => (
          <li
            key={`${error.message}\n${error.source ?? ""}`}
            className="rounded-[0.6rem] border border-(--mb-border) bg-(--mb-hover) px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <p className="m-0 min-w-0 flex-1 font-mono text-[0.72rem] leading-relaxed break-words whitespace-pre-wrap text-(--mb-text)">
                {error.message}
              </p>
              {error.count > 1 && (
                <span
                  className="mb-chip mb-chip-warning shrink-0"
                  title={`Happened ${error.count} times`}
                >
                  ×{error.count}
                </span>
              )}
            </div>
            <p className="m-0 mt-1 flex flex-wrap gap-x-2 text-[0.68rem] text-(--mb-text-faint)">
              {error.source && <span className="font-mono break-all">{error.source}</span>}
              <span title={new Date(error.last).toLocaleString()}>{timeAgo(error.last, now)}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
