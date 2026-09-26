/**
 * Bangs — shortcuts that search a site directly from the address bar, like
 * DuckDuckGo's `!w` or Helium's native bangs. They are resolved locally, so
 * `!w moon` goes straight to Wikipedia without asking a search engine first.
 *
 *   !w moon      searches Wikipedia for "moon"
 *   moon !w      the same (the bang may also come last)
 *   !gh          opens GitHub itself (a bang without a query)
 */
import { fillTemplate } from "./engines";

export interface Bang {
  trigger: string;
  name: string;
  /** Search URL with `%s` for the query. */
  url: string;
  /** Where the bang goes without a query. */
  home: string;
}

function bang(trigger: string, name: string, url: string, home?: string): Bang {
  return { trigger, name, url, home: home ?? new URL(url.replace("%s", "")).origin + "/" };
}

export const BANGS: readonly Bang[] = [
  // Search engines
  bang("p", "Perplexity", "https://www.perplexity.ai/search?q=%s"),
  bang("pplx", "Perplexity", "https://www.perplexity.ai/search?q=%s"),
  bang("ddg", "DuckDuckGo", "https://duckduckgo.com/?q=%s"),
  bang("sp", "Startpage", "https://www.startpage.com/sp/search?query=%s"),
  bang("brave", "Brave Search", "https://search.brave.com/search?q=%s"),
  bang("kagi", "Kagi", "https://kagi.com/search?q=%s"),
  bang("ec", "Ecosia", "https://www.ecosia.org/search?q=%s"),
  bang("qw", "Qwant", "https://www.qwant.com/?q=%s"),
  bang("g", "Google", "https://www.google.com/search?q=%s"),
  bang("gi", "Google Images", "https://www.google.com/search?tbm=isch&q=%s"),
  bang("gn", "Google News", "https://news.google.com/search?q=%s"),
  bang("b", "Bing", "https://www.bing.com/search?q=%s"),
  bang("yandex", "Yandex", "https://yandex.com/search/?text=%s"),

  // Knowledge
  bang("w", "Wikipedia", "https://en.wikipedia.org/w/index.php?search=%s"),
  bang("wde", "Wikipedia (Deutsch)", "https://de.wikipedia.org/w/index.php?search=%s"),
  bang("wt", "Wiktionary", "https://en.wiktionary.org/w/index.php?search=%s"),
  bang("wa", "Wolfram Alpha", "https://www.wolframalpha.com/input?i=%s"),
  bang("dict", "Merriam-Webster", "https://www.merriam-webster.com/dictionary/%s"),
  bang("leo", "LEO", "https://dict.leo.org/englisch-deutsch/%s"),
  bang("dcc", "dict.cc", "https://www.dict.cc/?s=%s"),
  bang("deepl", "DeepL", "https://www.deepl.com/translator#auto/auto/%s"),
  bang("wb", "Wayback Machine", "https://web.archive.org/web/*/%s"),
  bang("arxiv", "arXiv", "https://arxiv.org/search/?query=%s&searchtype=all"),
  bang("scholar", "Google Scholar", "https://scholar.google.com/scholar?q=%s"),

  // Maps & travel
  bang("osm", "OpenStreetMap", "https://www.openstreetmap.org/search?query=%s"),
  bang("maps", "Google Maps", "https://www.google.com/maps/search/%s"),
  bang("gm", "Google Maps", "https://www.google.com/maps/search/%s"),

  // Video, music & social
  bang("yt", "YouTube", "https://www.youtube.com/results?search_query=%s"),
  bang("twitch", "Twitch", "https://www.twitch.tv/search?term=%s"),
  bang("r", "Reddit", "https://www.reddit.com/search/?q=%s"),
  bang("x", "X", "https://x.com/search?q=%s"),
  bang("bsky", "Bluesky", "https://bsky.app/search?q=%s"),
  bang("mastodon", "Mastodon", "https://mastodon.social/search?q=%s"),
  bang("spotify", "Spotify", "https://open.spotify.com/search/%s"),
  bang("sc", "SoundCloud", "https://soundcloud.com/search?q=%s"),
  bang("genius", "Genius", "https://genius.com/search?q=%s"),
  bang("imdb", "IMDb", "https://www.imdb.com/find/?q=%s"),
  bang("lb", "Letterboxd", "https://letterboxd.com/search/%s/"),
  bang("hn", "Hacker News", "https://hn.algolia.com/?q=%s", "https://news.ycombinator.com/"),

  // Shopping
  bang("a", "Amazon", "https://www.amazon.com/s?k=%s"),
  bang("ade", "Amazon.de", "https://www.amazon.de/s?k=%s"),
  bang("e", "eBay", "https://www.ebay.com/sch/i.html?_nkw=%s"),
  bang("ede", "eBay.de", "https://www.ebay.de/sch/i.html?_nkw=%s"),
  bang(
    "idealo",
    "idealo",
    "https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=%s",
  ),

  // Developers
  bang("gh", "GitHub", "https://github.com/search?q=%s&type=repositories"),
  bang("gl", "GitLab", "https://gitlab.com/search?search=%s"),
  bang("so", "Stack Overflow", "https://stackoverflow.com/search?q=%s"),
  bang("mdn", "MDN Web Docs", "https://developer.mozilla.org/search?q=%s"),
  bang("caniuse", "Can I use", "https://caniuse.com/?search=%s"),
  bang("npm", "npm", "https://www.npmjs.com/search?q=%s"),
  bang("pypi", "PyPI", "https://pypi.org/search/?q=%s"),
  bang("crates", "crates.io", "https://crates.io/search?q=%s"),
  bang("docsrs", "Docs.rs", "https://docs.rs/releases/search?query=%s"),
  bang("py", "Python docs", "https://docs.python.org/3/search.html?q=%s"),
  bang("rust", "Rust std docs", "https://doc.rust-lang.org/std/?search=%s"),
  bang("go", "Go packages", "https://pkg.go.dev/search?q=%s"),
  bang("dh", "Docker Hub", "https://hub.docker.com/search?q=%s"),
  bang("aw", "ArchWiki", "https://wiki.archlinux.org/index.php?search=%s"),
  bang("aur", "AUR", "https://aur.archlinux.org/packages?K=%s"),
  bang("flathub", "Flathub", "https://flathub.org/apps/search?q=%s"),
];

const BY_TRIGGER = new Map(BANGS.map((b) => [b.trigger, b]));

export function findBangByTrigger(trigger: string): Bang | undefined {
  return BY_TRIGGER.get(trigger.toLowerCase());
}

export interface BangMatch {
  bang: Bang;
  query: string;
}

/** Finds a `!bang` at the start or the end of the input. */
export function matchBang(input: string): BangMatch | null {
  const text = input.trim();
  if (!text.includes("!")) return null;
  const words = text.split(/\s+/);
  const candidates: [number, string][] = [
    [0, words[0]],
    [words.length - 1, words[words.length - 1]],
  ];
  for (const [index, word] of candidates) {
    if (!/^![a-z0-9]+$/i.test(word)) continue;
    const found = findBangByTrigger(word.slice(1));
    if (!found) continue;
    const rest = words.filter((_, i) => i !== index).join(" ");
    return { bang: found, query: rest };
  }
  return null;
}

export function bangUrl(match: BangMatch): string {
  return match.query ? fillTemplate(match.bang.url, match.query) : match.bang.home;
}
