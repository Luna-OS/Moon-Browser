/**
 * Chrome extensions: what their manifests say, in words people understand.
 * Used for the "Add extension?" question and the extensions page.
 */

/** The name the toolbar's extension buttons use for the browsing session. */
export const EXTENSIONS_PARTITION = "moon-browsing";

/** Chrome Web Store IDs: 32 letters a–p. */
export const EXTENSION_ID = /^[a-p]{32}$/;

export const WEB_STORE_URL = "https://chromewebstore.google.com/category/extensions";

export function webStoreDetailUrl(id: string): string {
  return `https://chromewebstore.google.com/detail/${id}`;
}

/** The parts of manifest.json that matter here. */
export interface ManifestLike {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  default_locale?: unknown;
  permissions?: unknown;
  optional_permissions?: unknown;
  host_permissions?: unknown;
  content_scripts?: unknown;
  icons?: unknown;
  options_page?: unknown;
  options_ui?: unknown;
  homepage_url?: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Compares dotted version numbers ("1.10.2" > "1.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Replaces `__MSG_name__` with the extension's translated text. */
export function localize(text: string, messages: Record<string, { message?: unknown }>): string {
  return text.replace(/__MSG_(\w+)__/g, (whole, key: string) => {
    const entry = messages[key] ?? messages[key.toLowerCase()];
    if (entry && typeof entry.message === "string") return entry.message;
    const found = Object.keys(messages).find((k) => k.toLowerCase() === key.toLowerCase());
    const message = found ? messages[found]?.message : undefined;
    return typeof message === "string" ? message : whole;
  });
}

const ALL_SITES = new Set(["<all_urls>", "*://*/*", "http://*/*", "https://*/*", "*://*/"]);

/** The sites an extension can read and change: all of them, or a list of hosts. */
export function siteAccess(manifest: ManifestLike): "all" | string[] {
  const patterns = [
    ...strings(manifest.host_permissions),
    // Manifest V2 put host patterns among the permissions.
    ...strings(manifest.permissions).filter((p) => p.includes("://") || p === "<all_urls>"),
    ...(Array.isArray(manifest.content_scripts)
      ? manifest.content_scripts.flatMap((cs: unknown) =>
          cs && typeof cs === "object" ? strings((cs as { matches?: unknown }).matches) : [],
        )
      : []),
  ];
  const hosts = new Set<string>();
  for (const p of patterns) {
    if (ALL_SITES.has(p)) return "all";
    const m = /^[a-z*]+:\/\/([^/]+)\//i.exec(p);
    if (!m) continue;
    const host = m[1].replace(/^\*\./, "");
    if (host === "*") return "all";
    hosts.add(host);
  }
  return [...hosts].sort();
}

const PERMISSION_WARNINGS: Record<string, string> = {
  bookmarks: "Read and change your bookmarks",
  clipboardRead: "Read what you copy and paste",
  clipboardWrite: "Change what you copy and paste",
  contentSettings: "Change settings that control websites' access to features",
  debugger: "Access the page debugger",
  declarativeNetRequest: "Block content on any page",
  desktopCapture: "Capture the contents of your screen",
  downloads: "Manage your downloads",
  geolocation: "Detect your physical location",
  history: "Read and change your browsing history",
  management: "Manage your apps, extensions and themes",
  nativeMessaging: "Talk to other apps on your computer",
  notifications: "Display notifications",
  pageCapture: "Read and change all your data on all websites",
  privacy: "Change your privacy-related settings",
  proxy: "Route your traffic through a proxy",
  tabs: "Read your browsing history",
  topSites: "Read a list of your most frequently visited websites",
  webNavigation: "Read your browsing history",
};

/** What an extension may do, like Chrome's "It can:" list. */
export function describePermissions(manifest: ManifestLike): string[] {
  const out: string[] = [];
  const sites = siteAccess(manifest);
  if (sites === "all") out.push("Read and change all your data on all websites");
  else if (sites.length === 1) out.push(`Read and change your data on ${sites[0]}`);
  else if (sites.length > 1 && sites.length <= 3)
    out.push(`Read and change your data on ${sites.join(", ")}`);
  else if (sites.length > 3) out.push(`Read and change your data on ${sites.length} websites`);
  for (const p of strings(manifest.permissions)) {
    const text = PERMISSION_WARNINGS[p];
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** Things an extension asks for that Moon Browser can't give it. */
export function unsupportedFeatures(manifest: ManifestLike): string[] {
  const permissions = new Set([
    ...strings(manifest.permissions),
    ...strings(manifest.optional_permissions),
  ]);
  const out: string[] = [];
  if (permissions.has("nativeMessaging"))
    out.push("Connecting to a desktop app (native messaging) isn't available in Moon Browser.");
  return out;
}

/** The page an extension offers for its settings, relative to its root. */
export function optionsPage(manifest: ManifestLike): string | null {
  const ui = manifest.options_ui;
  if (ui && typeof ui === "object" && typeof (ui as { page?: unknown }).page === "string")
    return (ui as { page: string }).page;
  return typeof manifest.options_page === "string" ? manifest.options_page : null;
}

/** The icon closest to `size` pixels (but not smaller if there is a bigger one). */
export function pickIcon(manifest: ManifestLike, size: number): string | null {
  const icons = manifest.icons;
  if (!icons || typeof icons !== "object") return null;
  const entries = Object.entries(icons as Record<string, unknown>)
    .map(([k, v]) => [parseInt(k, 10), v] as const)
    .filter(
      (e): e is readonly [number, string] => Number.isFinite(e[0]) && typeof e[1] === "string",
    )
    .sort((a, b) => a[0] - b[0]);
  if (!entries.length) return null;
  return (entries.find(([s]) => s >= size) ?? entries[entries.length - 1])[1];
}
