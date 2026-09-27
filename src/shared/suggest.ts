/**
 * Address bar suggestions from the local history, bookmarks and open tabs.
 * Nothing typed ever leaves the machine for suggestions — there are no
 * search-engine suggestions by design.
 */
import type { Bookmark, HistoryEntry, Suggestion } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function stripScheme(url: string): string {
  return url.replace(/^[a-z-]+:\/\//i, "").replace(/^www\./, "");
}

/**
 * How well `text` matches an entry: 0 = not at all. A match at the start of
 * the host beats a match at the start of a word, which beats any substring.
 */
export function matchScore(text: string, url: string, title: string): number {
  const q = text.trim().toLowerCase();
  if (!q) return 0;
  const bare = stripScheme(url).toLowerCase();
  const t = title.toLowerCase();
  if (bare.startsWith(q)) return 10;
  const terms = q.split(/\s+/);
  let score = 0;
  for (const term of terms) {
    const wordStart = new RegExp(`(^|[\\s/._-])${escapeRegExp(term)}`);
    if (wordStart.test(t) || wordStart.test(bare)) score += 4;
    else if (t.includes(term) || bare.includes(term)) score += 1;
    else return 0;
  }
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Frequency and recency of an entry, typed visits weigh more. */
export function frecency(entry: HistoryEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastVisit) / DAY);
  const recency = ageDays < 1 ? 100 : ageDays < 7 ? 70 : ageDays < 30 ? 50 : ageDays < 90 ? 30 : 10;
  return recency * Math.log2(2 + entry.visits + entry.typed * 2);
}

export interface SuggestSources {
  history: Iterable<HistoryEntry>;
  bookmarks: readonly Bookmark[];
  tabs: readonly { id: number; url: string; title: string; favicon: string | null }[];
  now: number;
}

export function suggest(text: string, sources: SuggestSources, limit = 6): Suggestion[] {
  const q = text.trim();
  if (!q) return [];
  const out: (Suggestion & { score: number })[] = [];
  const seen = new Set<string>();

  for (const tab of sources.tabs) {
    const m = matchScore(q, tab.url, tab.title);
    if (m > 0 && /^https?:/.test(tab.url)) {
      out.push({
        kind: "tab",
        title: tab.title || tab.url,
        url: tab.url,
        tabId: tab.id,
        favicon: tab.favicon,
        score: m * 100 + 50,
      });
    }
  }

  const history = [...sources.history];
  const visited = new Map(history.map((h) => [h.url, h]));

  for (const b of sources.bookmarks) {
    if (b.isFolder) continue;
    const m = matchScore(q, b.url, b.title);
    if (m > 0) {
      const h = visited.get(b.url);
      const score = m * 100 + 40 + (h ? frecency(h, sources.now) : 0);
      out.push({
        kind: "bookmark",
        title: b.title || b.url,
        url: b.url,
        favicon: b.favicon,
        score,
      });
      seen.add(b.url);
    }
  }

  for (const h of history) {
    if (seen.has(h.url)) continue;
    const m = matchScore(q, h.url, h.title);
    if (m > 0) {
      out.push({
        kind: "history",
        title: h.title || h.url,
        url: h.url,
        favicon: h.favicon,
        score: m * 100 + frecency(h, sources.now),
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  const result: Suggestion[] = [];
  const urls = new Set<string>();
  for (const { score: _score, ...s } of out) {
    const key = `${s.kind === "tab" ? "tab" : "url"}:${s.url}`;
    if (urls.has(key)) continue;
    urls.add(key);
    result.push(s);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Inline completion: when the typed text is the start of a known host,
 * the rest of it ("git" → "hub.com"). Only for hosts, never for paths.
 */
export function inlineCompletion(
  text: string,
  history: Iterable<HistoryEntry>,
  now: number,
): string | null {
  const q = text.toLowerCase();
  if (!q || /[\s/?#]/.test(q)) return null;
  let best: { host: string; score: number } | null = null;
  for (const h of history) {
    let host: string;
    try {
      const u = new URL(h.url);
      if (!/^https?:$/.test(u.protocol)) continue;
      host = u.host.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!host.startsWith(q) || host === q) continue;
    const score = frecency(h, now);
    if (!best || score > best.score) best = { host, score };
  }
  return best ? best.host.slice(q.length) : null;
}
