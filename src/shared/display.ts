import { internalPageOf } from "./internal";

/**
 * What the address bar shows for a URL when it isn't focused: no scheme for
 * the web, nothing for the new tab page.
 */
export function displayUrl(url: string): string {
  if (!url || internalPageOf(url) === "newtab") return "";
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") {
      const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
      return `${u.host}${rest}`;
    }
  } catch {
    // fall through
  }
  return url;
}

/** Hostname without "www." for compact labels. */
export function shortHost(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "moon:") return `moon://${u.hostname}`;
    if (u.protocol === "file:") return "file";
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
