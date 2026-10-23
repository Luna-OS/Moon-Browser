/**
 * Small, pure building blocks of Moon Browser's protections — kept apart
 * so each rule is unit-tested.
 */

/**
 * Query parameters that only exist to follow people across sites (click
 * IDs of ad networks, newsletter tracking, campaign tags). They are removed
 * before a page loads, like Brave's and Firefox's query stripping.
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "li_fat_id",
  "epik",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "__hssc",
  "__hstc",
  "__hsfp",
  "hsctatracking",
  "oly_anon_id",
  "oly_enc_id",
  "rb_clickid",
  "s_cid",
  "vero_id",
  "vero_conv",
  "wickedid",
  "ml_subscriber",
  "ml_subscriber_hash",
  "mkt_tok",
  "_openstat",
  "srsltid",
  "si",
]);

const TRACKING_PREFIXES = ["utm_", "pk_", "mtm_"];

function isTrackingParam(name: string, host: string): boolean {
  const n = name.toLowerCase();
  // "si" is a share-tracking ID on YouTube and Spotify, but may mean
  // anything elsewhere.
  if (n === "si") return /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/.test(host);
  return TRACKING_PARAMS.has(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p));
}

/** The URL without tracking parameters, or null if there were none. */
export function stripTrackingParams(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.search) return null;
  const host = u.hostname.toLowerCase();
  const names = [...new Set([...u.searchParams.keys()])];
  const drop = names.filter((n) => isTrackingParam(n, host));
  if (!drop.length) return null;
  for (const name of drop) u.searchParams.delete(name);
  return u.href.replace(/\?$/, "").replace(/\?#/, "#");
}

/**
 * Files that run code when opened. Downloading one asks first, the way
 * Chromium warns about "dangerous" downloads.
 */
const DANGEROUS_EXTENSIONS = new Set([
  // Windows programs, installers and scripts
  "exe",
  "msi",
  "msix",
  "msixbundle",
  "appx",
  "appxbundle",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "cpl",
  "ps1",
  "psm1",
  "psd1",
  "vbs",
  "vbe",
  "js",
  "jse",
  "wsf",
  "wsh",
  "hta",
  "lnk",
  "reg",
  "dll",
  "sys",
  "msc",
  "msp",
  "application",
  "appref-ms",
  "gadget",
  "inf",
  "url",
  "library-ms",
  "settingcontent-ms",
  "chm",
  "xll",
  "iso",
  "img",
  "vhd",
  "vhdx",
  // Cross-platform
  "jar",
  "jnlp",
  "py",
  "pyw",
  "pl",
  "rb",
  // Linux
  "sh",
  "bash",
  "run",
  "bin",
  "appimage",
  "deb",
  "rpm",
  "desktop",
  "flatpakref",
  // Android / macOS (for completeness)
  "apk",
  "app",
  "pkg",
  "dmg",
  "command",
]);

export function isDangerousFile(filename: string): boolean {
  // Windows drops trailing dots and spaces: "x.exe." is saved as "x.exe".
  const name = filename.replace(/[. ]+$/, "");
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return name.includes(".") && DANGEROUS_EXTENSIONS.has(ext);
}

/** Names Windows reserves for devices ("NUL", "COM1.txt", …). */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

/**
 * A file name an extension or page asked for, made safe to save: no folders,
 * no characters Windows refuses, no trailing dots or spaces, no device names.
 */
export function safeFilename(requested: string): string {
  const base = requested.split(/[\\/]/).pop() ?? "";
  const name = [...base]
    .map((c) => (c < " " || '<>:"|?*'.includes(c) ? "_" : c))
    .join("")
    .trim()
    .replace(/[. ]+$/, "");
  return RESERVED.test(name) ? `_${name}` : name;
}

/** The Windows "Mark of the Web" for a downloaded file. */
export function zoneIdentifier(options: { url?: string; referrer?: string }): string {
  const lines = ["[ZoneTransfer]", "ZoneId=3"];
  const safe = (v: string | undefined) =>
    v && /^https?:\/\//i.test(v) ? v.replace(/[\r\n]/g, "") : "";
  if (safe(options.referrer)) lines.push(`ReferrerUrl=${safe(options.referrer)}`);
  if (safe(options.url)) lines.push(`HostUrl=${safe(options.url)}`);
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Whether a filter that matched a page itself should block the whole page,
 * like uBlock Origin's "strict blocking": only rules that name a whole
 * host (||bad.example^) or explicitly target documents ($document) do.
 * A generic rule like "/ads/" must not block a page whose path contains it.
 */
export function blocksWholePage(filter: {
  hostnameAnchored: boolean;
  pattern: string;
  text: string;
}): boolean {
  if (filter.hostnameAnchored && filter.pattern === "") return true;
  return /\$(?:[^$]*,)?(?:document|doc|all)(?:,|$)/.test(filter.text);
}
