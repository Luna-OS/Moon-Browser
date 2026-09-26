/**
 * Turns what was typed into the address bar into an address: a URL to open,
 * a bang, or a search with the chosen engine. Pure, so it is unit-tested and
 * used the same way by the main process and the new tab page.
 */
import { parse as parseDomain } from "tldts";
import { bangUrl, matchBang } from "./bangs";
import { searchUrl, type SearchEngine } from "./engines";
import { INTERNAL_ALIASES, internalPageOf } from "./internal";

export type OmniboxResult =
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string }
  | { kind: "bang"; url: string; query: string; name: string };

export interface OmniboxOptions {
  engine: SearchEngine;
  bangs: boolean;
}

/** Schemes that may be typed and opened as they are. */
const OPENABLE_SCHEMES = new Set(["http:", "https:", "file:", "moon:", "view-source:"]);

/** Hostnames that are local by design and have no public suffix. */
const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".lan",
  ".home",
  ".internal",
  ".home.arpa",
  ".test",
];

export function resolveInput(input: string, options: OmniboxOptions): OmniboxResult | null {
  const text = input.trim();
  if (!text) return null;

  const alias = INTERNAL_ALIASES[text.toLowerCase().replace(/\/$/, "")];
  if (alias) return { kind: "url", url: alias };

  if (options.bangs) {
    const bang = matchBang(text);
    if (bang) return { kind: "bang", url: bangUrl(bang), query: bang.query, name: bang.bang.name };
  }

  const explicit = explicitUrl(text);
  if (explicit) return { kind: "url", url: explicit };

  const guessed = guessUrl(text);
  if (guessed) return { kind: "url", url: guessed };

  return { kind: "search", url: searchUrl(options.engine, text), query: text };
}

/** Input that already carries a scheme we open, e.g. https://… or moon://… */
function explicitUrl(text: string): string | null {
  if (/\s/.test(text)) return null;
  if (text.toLowerCase() === "about:blank") return "about:blank";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme === "view-source") {
    const inner = explicitUrl(text.slice("view-source:".length)) ?? guessUrl(text.slice(12));
    return inner && /^https?:/.test(inner) ? `view-source:${inner}` : null;
  }
  if (!OPENABLE_SCHEMES.has(`${scheme}:`)) return null;
  // "localhost:3000" parses with "localhost:" as scheme — that is a host.
  if (scheme !== "file" && !text.slice(scheme.length + 1).startsWith("//")) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "moon:" && !internalPageOf(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Input without a scheme that looks like an address: example.com, localhost:3000/x … */
function guessUrl(text: string): string | null {
  if (/\s/.test(text)) return null;
  // Things like "c++" or "user@example.com" are searches, not hosts.
  const hostLike = /^[\p{L}\p{N}_.-]+(:\d{1,5})?([/?#].*)?$/u.test(text);
  const ipv6Like = /^\[[0-9a-f:]+\](:\d{1,5})?([/?#].*)?$/i.test(text);
  if (!hostLike && !ipv6Like) return null;

  // Classify by the host as typed: the URL parser would read "3.14" as the
  // IPv4 address 3.0.0.14, but typed, it is a number to search for.
  const host = (ipv6Like ? text.slice(0, text.indexOf("]") + 1) : text.split(/[:/?#]/, 1)[0])
    .toLowerCase()
    .replace(/\.$/, "");
  const afterHost = text.slice(ipv6Like ? host.length : text.split(/[:/?#]/, 1)[0].length);
  const hasPathOrPort = /^(:\d+|[/?#])/.test(afterHost);
  if (/^[\d.]+$/.test(host) && !isIpAddress(host)) return null;

  let url: URL;
  try {
    url = new URL(`http://${text}`);
  } catch {
    return null;
  }

  if (host === "localhost" || isIpAddress(host) || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return url.href;
  }
  if (!host.includes(".")) {
    // A single word is a search unless it clearly is an intranet host
    // ("router/", "nas:5000").
    return /^(:\d+|\/)/.test(afterHost) ? url.href : null;
  }
  const info = parseDomain(host);
  if (info.isIcann || info.isPrivate) return url.href;
  // Unknown suffix: only an address if it has a port or a path (e.g. "nas.box:5000").
  return hasPathOrPort ? url.href : null;
}

export function isIpAddress(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split(".").every((n) => Number(n) <= 255);
  }
  return host.startsWith("[") && host.endsWith("]");
}
