/**
 * Address bar suggestions from the local history, bookmarks and open tabs.
 * Nothing typed ever leaves the machine for suggestions — there are no
 * search-engine suggestions by design.
 */
import type { Bookmark, HistoryEntry, Suggestion } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function stripScheme(url: string): string {
  // The common case without regular expressions: it runs for every entry.
  const bare = url.startsWith("https://")
    ? url.slice(8)
    : url.startsWith("http://")
      ? url.slice(7)
      : url.replace(/^[a-z-]+:\/\//i, "");
  return bare.startsWith("www.") ? bare.slice(4) : bare;
}

/**
 * How well `text` matches an entry: 0 = not at all. A match at the start of
 * the host beats a match at the start of a word, which beats any substring.
 */
export function matchScore(text: string, url: string, title: string): number {
  return matcher(text)(url, title);
}

/**
 * matchScore for one typed text, prepared once: the address bar scores every
 * history entry on each keystroke, so the query is lowercased, split and
 * turned into regular expressions only once.
 */
function matcher(text: string): (url: string, title: string) => number {
  const q = text.trim().toLowerCase();
  if (!q) return () => 0;
  const terms = q.split(/\s+/).map((term) => ({
    term,
    wordStart: new RegExp(`(^|[\\s/._-])${escapeRegExp(term)}`),
  }));
  return (url, title) => {
    const bare = stripScheme(url).toLowerCase();
    if (bare.startsWith(q)) return 10;
    let t: string | null = null;
    let score = 0;
    for (const { term, wordStart } of terms) {
      // Most entries match nothing: check for the term at all first.
      const inUrl = bare.includes(term);
      t ??= title.toLowerCase();
      if (!inUrl && !t.includes(term)) return 0;
      score += wordStart.test(t) || (inUrl && wordStart.test(bare)) ? 4 : 1;
    }
    return score;
  };
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

  const score = matcher(q);

  for (const tab of sources.tabs) {
    const m = score(tab.url, tab.title);
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

  // Matching bookmarks, by address: a visited one also gets its frecency.
  const bookmarked = new Map<string, Suggestion & { score: number }>();
  for (const b of sources.bookmarks) {
    if (b.isFolder || bookmarked.has(b.url)) continue;
    const m = score(b.url, b.title);
    if (m > 0) {
      const s = {
        kind: "bookmark" as const,
        title: b.title || b.url,
        url: b.url,
        favicon: b.favicon,
        score: m * 100 + 40,
      };
      out.push(s);
      bookmarked.set(b.url, s);
    }
  }

  // One pass over the history, without copying it.
  for (const h of sources.history) {
    const b = bookmarked.get(h.url);
    if (b) {
      b.score += frecency(h, sources.now);
      continue;
    }
    const m = score(h.url, h.title);
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
    // Parsing every address is slow; most can be ruled out from the text.
    // (An address with user info ("user@host") is always parsed.)
    const start = h.url.indexOf("://") + 3;
    const at = h.url.indexOf("@", start);
    const slash = h.url.indexOf("/", start);
    const userInfo = at >= 0 && (slash < 0 || at < slash);
    const lower = h.url.slice(start, start + 4 + q.length).toLowerCase();
    if (!userInfo && !lower.startsWith(q) && !lower.startsWith(`www.${q}`)) continue;
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
