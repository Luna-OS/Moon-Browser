/**
 * Reading the data of Chromium-based browsers (Comet, Chrome, Brave, Edge,
 * Helium, …): their bookmarks file and the rows of their history database.
 * Pure parts, so they are tested without a real profile.
 */

/** Chromium stores times as microseconds since 1601-01-01 (UTC). */
export function chromeTimeToMs(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time / 1000 - 11_644_473_600_000);
}

/**
 * The visited pages of a Chromium `History` database. Its timestamps are
 * too large for JavaScript numbers, so they become milliseconds in SQL.
 */
export const HISTORY_QUERY = `SELECT url, title, visit_count, typed_count,
  CASE WHEN last_visit_time > 0 THEN last_visit_time / 1000 - 11644473600000 ELSE 0 END AS last_visit
  FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT 20000`;

/** A bookmark or a folder from another browser. */
export type ImportedNode =
  | { kind: "url"; url: string; title: string }
  | { kind: "folder"; title: string; children: ImportedNode[] };

const IMPORTABLE = /^(https?|file):/i;

/** Names Chromium gives its roots where the file doesn't say. */
const ROOTS: [key: string, name: string][] = [
  ["other", "Other bookmarks"],
  ["synced", "Mobile bookmarks"],
];

/**
 * The bookmarks of a Chromium `Bookmarks` file, folders and all: the
 * bookmarks bar's contents as they are, then "Other bookmarks" and "Mobile
 * bookmarks" as folders of their own (when they hold anything).
 */
export function bookmarkTree(json: unknown): ImportedNode[] {
  const roots = (json as { roots?: Record<string, unknown> } | null)?.roots;
  if (!roots || typeof roots !== "object") return [];

  const read = (node: unknown, depth: number): ImportedNode | null => {
    if (!node || typeof node !== "object" || depth > 32) return null;
    const n = node as { type?: string; url?: string; name?: string; children?: unknown[] };
    const title = typeof n.name === "string" ? n.name.slice(0, 512) : "";
    if (n.type === "url")
      return typeof n.url === "string" && IMPORTABLE.test(n.url)
        ? { kind: "url", url: n.url, title }
        : null;
    if (!Array.isArray(n.children)) return null;
    return { kind: "folder", title, children: contents(n.children, depth + 1) };
  };
  const contents = (children: unknown[], depth: number): ImportedNode[] =>
    children.map((c) => read(c, depth)).filter((c): c is ImportedNode => c !== null);

  const bar = read(roots.bookmark_bar, 0);
  const out = bar?.kind === "folder" ? bar.children : [];
  for (const [key, name] of ROOTS) {
    const root = read(roots[key], 0);
    if (root?.kind === "folder" && root.children.length)
      out.push({ ...root, title: root.title || name });
  }
  return out;
}

export interface HistoryRow {
  url: unknown;
  title: unknown;
  visit_count: unknown;
  typed_count: unknown;
  /** Milliseconds since 1970, see HISTORY_QUERY. */
  last_visit: unknown;
}

export interface ImportedVisit {
  url: string;
  title: string;
  visits: number;
  typed: number;
  lastVisit: number;
}

/** Rows of Chromium's `urls` table as history entries; junk is skipped. */
export function historyFromRows(rows: readonly HistoryRow[]): ImportedVisit[] {
  const out: ImportedVisit[] = [];
  for (const row of rows) {
    if (typeof row.url !== "string" || !/^https?:/i.test(row.url) || row.url.length > 8192)
      continue;
    const lastVisit = Number(row.last_visit);
    if (!Number.isFinite(lastVisit) || lastVisit <= 0) continue;
    out.push({
      url: row.url,
      title: typeof row.title === "string" ? row.title.slice(0, 512) : "",
      visits: Math.max(1, Number(row.visit_count) || 1),
      typed: Math.max(0, Number(row.typed_count) || 0),
      lastVisit,
    });
  }
  return out;
}

/** Profile names from Chromium's `Local State` file: folder → display name. */
export function profilesFromLocalState(json: unknown): { dir: string; name: string }[] {
  const cache = (json as { profile?: { info_cache?: Record<string, { name?: unknown }> } } | null)
    ?.profile?.info_cache;
  if (!cache || typeof cache !== "object") return [];
  return Object.entries(cache)
    .filter(([dir]) => /^[\w .-]+$/.test(dir))
    .map(([dir, info]) => ({
      dir,
      name: typeof info?.name === "string" && info.name ? info.name : dir,
    }));
}
