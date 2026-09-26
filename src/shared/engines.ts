import type { SearchEngineId } from "./types";

export interface SearchEngine {
  id: SearchEngineId;
  name: string;
  /** Results URL; `%s` is replaced by the encoded query. */
  searchUrl: string;
  /** Where an empty search goes. */
  home: string;
}

/**
 * Perplexity is the default: answers instead of a list of links. The
 * private engines follow; the big two stay available by choice.
 */
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  {
    id: "perplexity",
    name: "Perplexity",
    searchUrl: "https://www.perplexity.ai/search?q=%s",
    home: "https://www.perplexity.ai/",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    searchUrl: "https://duckduckgo.com/?q=%s",
    home: "https://duckduckgo.com/",
  },
  {
    id: "startpage",
    name: "Startpage",
    searchUrl: "https://www.startpage.com/sp/search?query=%s",
    home: "https://www.startpage.com/",
  },
  {
    id: "brave",
    name: "Brave Search",
    searchUrl: "https://search.brave.com/search?q=%s",
    home: "https://search.brave.com/",
  },
  {
    id: "kagi",
    name: "Kagi",
    searchUrl: "https://kagi.com/search?q=%s",
    home: "https://kagi.com/",
  },
  {
    id: "ecosia",
    name: "Ecosia",
    searchUrl: "https://www.ecosia.org/search?q=%s",
    home: "https://www.ecosia.org/",
  },
  {
    id: "qwant",
    name: "Qwant",
    searchUrl: "https://www.qwant.com/?q=%s",
    home: "https://www.qwant.com/",
  },
  {
    id: "google",
    name: "Google",
    searchUrl: "https://www.google.com/search?q=%s",
    home: "https://www.google.com/",
  },
  {
    id: "bing",
    name: "Bing",
    searchUrl: "https://www.bing.com/search?q=%s",
    home: "https://www.bing.com/",
  },
];

export const DEFAULT_ENGINE = SEARCH_ENGINES[0];

/** A custom search URL must be http(s) and contain the `%s` placeholder. */
export function isValidCustomSearchUrl(url: string): boolean {
  if (!url.includes("%s")) return false;
  try {
    const parsed = new URL(url.replace("%s", "test"));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function resolveEngine(id: SearchEngineId, customSearchUrl: string): SearchEngine {
  if (id === "custom") {
    if (isValidCustomSearchUrl(customSearchUrl)) {
      const home = new URL(customSearchUrl.replace("%s", "")).origin + "/";
      let name = "Custom search";
      try {
        name = new URL(home).hostname.replace(/^www\./, "");
      } catch {
        // keep the generic name
      }
      return { id: "custom", name, searchUrl: customSearchUrl, home };
    }
    return DEFAULT_ENGINE;
  }
  return SEARCH_ENGINES.find((e) => e.id === id) ?? DEFAULT_ENGINE;
}

export function fillTemplate(template: string, query: string): string {
  return template.replace("%s", encodeURIComponent(query).replace(/%20/g, "+"));
}

export function searchUrl(engine: SearchEngine, query: string): string {
  const q = query.trim();
  return q ? fillTemplate(engine.searchUrl, q) : engine.home;
}
