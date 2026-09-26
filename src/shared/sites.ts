/**
 * Sites and parties: which requests are "third-party" is decided by the
 * registrable domain (eTLD+1) from the Public Suffix List, the same way
 * Chromium draws the line for cookies.
 */
import { getDomain, getHostname } from "tldts";

/** The site of an URL: its registrable domain, or the host for IPs/localhost. */
export function siteOf(url: string): string | null {
  const host = getHostname(url);
  if (!host) return null;
  return (getDomain(url, { allowPrivateDomains: true }) ?? host).toLowerCase();
}

/** The site for protection toggles: like siteOf, without "www.". */
export function protectionSiteOf(url: string): string | null {
  if (!/^https?:/i.test(url)) return null;
  return siteOf(url)?.replace(/^www\./, "") ?? null;
}

/** True when `requestUrl` belongs to another site than the page `topUrl`. */
export function isThirdParty(requestUrl: string, topUrl: string): boolean {
  const a = siteOf(requestUrl);
  const b = siteOf(topUrl);
  if (!a || !b) return false;
  return a !== b;
}

export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === "null" ? url : u.origin;
  } catch {
    return url;
  }
}
