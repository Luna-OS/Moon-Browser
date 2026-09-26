/**
 * Default settings and the one place that turns stored or received data
 * back into valid settings. A broken or old settings file must never keep
 * Moon Browser from starting — unknown or invalid fields fall back to the
 * defaults, known ones are kept.
 */
import { isValidCustomSearchUrl, SEARCH_ENGINES } from "./engines";
import type { SearchEngineId, Settings } from "./types";

export const SLEEP_CHOICES = [15, 30, 60, 120, 240] as const;

export function defaultSettings(platform: string): Settings {
  return {
    theme: "dark",
    searchEngine: "perplexity",
    customSearchUrl: "",
    bangs: true,
    startup: "newtab",
    homePage: "",
    showHomeButton: false,
    showBookmarksBar: false,
    httpsFirst: true,
    adblock: true,
    adblockAnnoyances: false,
    protectionAllowlist: [],
    blockThirdPartyCookies: true,
    globalPrivacyControl: true,
    webrtcProtection: true,
    stripTrackingParams: true,
    secureDns: "automatic",
    clearOnExit: false,
    sleepTabs: true,
    sleepAfterMinutes: 60,
    openTabsNextToActive: true,
    askDownloadLocation: false,
    downloadDir: "",
    // On Windows, spell checking uses the system's dictionaries. On Linux,
    // Chromium would download them from Google's servers, so it stays
    // opt-in there.
    spellcheck: platform === "win32",
    newTabShortcuts: true,
    autoUpdate: true,
  };
}

type Raw = Record<string, unknown>;

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;

const ENGINE_IDS: SearchEngineId[] = [...SEARCH_ENGINES.map((e) => e.id), "custom"];

/** A site entry of the allowlist: a lower-case host name, nothing else. */
export function normalizeSite(site: string): string | null {
  const s = site
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return /^[a-z0-9.-]+$/.test(s) && s.includes(".") ? s : s === "localhost" ? s : null;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function sanitizeSettings(input: unknown, platform: string): Settings {
  const d = defaultSettings(platform);
  const raw: Raw = input && typeof input === "object" ? (input as Raw) : {};

  const customSearchUrl =
    typeof raw.customSearchUrl === "string" && isValidCustomSearchUrl(raw.customSearchUrl)
      ? raw.customSearchUrl
      : "";
  let searchEngine = oneOf(raw.searchEngine, ENGINE_IDS, d.searchEngine);
  if (searchEngine === "custom" && !customSearchUrl) searchEngine = d.searchEngine;

  const allowlist = Array.isArray(raw.protectionAllowlist)
    ? [
        ...new Set(
          raw.protectionAllowlist
            .filter((s): s is string => typeof s === "string")
            .map(normalizeSite)
            .filter((s): s is string => s !== null),
        ),
      ].slice(0, 5000)
    : d.protectionAllowlist;

  const sleep = Number(raw.sleepAfterMinutes);

  return {
    theme: oneOf(raw.theme, ["dark", "light", "system"] as const, d.theme),
    searchEngine,
    customSearchUrl,
    bangs: bool(raw.bangs, d.bangs),
    startup: oneOf(raw.startup, ["newtab", "restore"] as const, d.startup),
    homePage:
      typeof raw.homePage === "string" && isHttpUrl(raw.homePage) ? raw.homePage : d.homePage,
    showHomeButton: bool(raw.showHomeButton, d.showHomeButton),
    showBookmarksBar: bool(raw.showBookmarksBar, d.showBookmarksBar),
    httpsFirst: bool(raw.httpsFirst, d.httpsFirst),
    adblock: bool(raw.adblock, d.adblock),
    adblockAnnoyances: bool(raw.adblockAnnoyances, d.adblockAnnoyances),
    protectionAllowlist: allowlist,
    blockThirdPartyCookies: bool(raw.blockThirdPartyCookies, d.blockThirdPartyCookies),
    globalPrivacyControl: bool(raw.globalPrivacyControl, d.globalPrivacyControl),
    webrtcProtection: bool(raw.webrtcProtection, d.webrtcProtection),
    stripTrackingParams: bool(raw.stripTrackingParams, d.stripTrackingParams),
    secureDns: oneOf(
      raw.secureDns,
      ["automatic", "quad9", "cloudflare", "mullvad", "off"] as const,
      d.secureDns,
    ),
    clearOnExit: bool(raw.clearOnExit, d.clearOnExit),
    sleepTabs: bool(raw.sleepTabs, d.sleepTabs),
    sleepAfterMinutes: (SLEEP_CHOICES as readonly number[]).includes(sleep)
      ? sleep
      : d.sleepAfterMinutes,
    openTabsNextToActive: bool(raw.openTabsNextToActive, d.openTabsNextToActive),
    askDownloadLocation: bool(raw.askDownloadLocation, d.askDownloadLocation),
    downloadDir:
      typeof raw.downloadDir === "string" && raw.downloadDir.length < 4096 ? raw.downloadDir : "",
    spellcheck: bool(raw.spellcheck, d.spellcheck),
    newTabShortcuts: bool(raw.newTabShortcuts, d.newTabShortcuts),
    autoUpdate: bool(raw.autoUpdate, d.autoUpdate),
  };
}

/** Applies a partial update from the settings page on top of the current settings. */
export function mergeSettings(current: Settings, patch: unknown, platform: string): Settings {
  const p = patch && typeof patch === "object" ? (patch as Raw) : {};
  return sanitizeSettings({ ...current, ...p }, platform);
}
