/**
 * Moon Browser's own pages live on the moon:// scheme: moon://newtab,
 * moon://settings, … They are served from the app bundle by the main
 * process and are the only pages that get the internal page API.
 */

export const INTERNAL_SCHEME = "moon";

export const INTERNAL_PAGES = [
  "newtab",
  "settings",
  "history",
  "bookmarks",
  "downloads",
  "about",
] as const;

export type InternalPage = (typeof INTERNAL_PAGES)[number];

export const NEWTAB_URL = "moon://newtab/";

export function internalUrl(page: InternalPage, hash = ""): string {
  return `moon://${page}/${hash ? `#${hash}` : ""}`;
}

/** The internal page an URL points to, or null for anything else. */
export function internalPageOf(url: string): InternalPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${INTERNAL_SCHEME}:`) return null;
  return (INTERNAL_PAGES as readonly string[]).includes(parsed.hostname)
    ? (parsed.hostname as InternalPage)
    : null;
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith(`${INTERNAL_SCHEME}:`);
}

export function isNewTabUrl(url: string): boolean {
  return internalPageOf(url) === "newtab";
}

/** Friendly aliases typed into the address bar. */
export const INTERNAL_ALIASES: Record<string, string> = {
  "about:settings": "moon://settings/",
  "about:history": "moon://history/",
  "about:bookmarks": "moon://bookmarks/",
  "about:downloads": "moon://downloads/",
  "about:newtab": NEWTAB_URL,
  "about:home": NEWTAB_URL,
  "about:moon": "moon://about/",
  "chrome://settings": "moon://settings/",
  "chrome://history": "moon://history/",
  "chrome://bookmarks": "moon://bookmarks/",
  "chrome://downloads": "moon://downloads/",
  "chrome://newtab": NEWTAB_URL,
};
