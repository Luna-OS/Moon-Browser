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
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return filename.includes(".") && DANGEROUS_EXTENSIONS.has(ext);
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

export type SecureDnsChoice = "automatic" | "quad9" | "cloudflare" | "mullvad" | "off";

export const SECURE_DNS: Record<
  Exclude<SecureDnsChoice, "automatic" | "off">,
  { name: string; template: string }
> = {
  quad9: {
    name: "Quad9 (blocks known malware domains)",
    template: "https://dns.quad9.net/dns-query",
  },
  mullvad: { name: "Mullvad", template: "https://dns.mullvad.net/dns-query" },
  cloudflare: { name: "Cloudflare", template: "https://cloudflare-dns.com/dns-query" },
};

/** Arguments for Electron's app.configureHostResolver. */
export function hostResolverConfig(choice: SecureDnsChoice): {
  enableBuiltInResolver: boolean;
  secureDnsMode: "off" | "automatic" | "secure";
  secureDnsServers: string[];
} {
  if (choice === "off")
    return { enableBuiltInResolver: true, secureDnsMode: "off", secureDnsServers: [] };
  if (choice === "automatic")
    return { enableBuiltInResolver: true, secureDnsMode: "automatic", secureDnsServers: [] };
  return {
    enableBuiltInResolver: true,
    secureDnsMode: "secure",
    secureDnsServers: [SECURE_DNS[choice].template],
  };
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
