/**
 * Moon Browser presents itself as the Chromium it is: the app name and the
 * "Electron/x" token are removed, and the Chrome version is reduced to its
 * major number like Chrome's own reduced user agent. That keeps sites
 * working and makes Moon Browser blend in instead of standing out.
 */
export function cleanUserAgent(ua: string): string {
  return ua
    .replace(/\s+Electron\/\S+/g, "")
    .replace(/\s+[a-z-]*moon[a-z-]*\/\S+/gi, "")
    .replace(/Chrome\/(\d+)\.[\d.]+/, "Chrome/$1.0.0.0")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Google's sign-in turns away Chromium-based browsers it doesn't know
 * ("This browser or app may not be secure", even with a clean Chrome user
 * agent) but lets Firefox in. Requests to the sign-in host therefore go out
 * as Firefox's; the pages themselves are untouched. qutebrowser, also built
 * on Chromium, has signed in to Google this way since 2020.
 */
const FIREFOX_UA_HOSTS = new Set(["accounts.google.com"]);

export function wantsFirefoxUserAgent(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && FIREFOX_UA_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Firefox's user agent on the same system, of the same age as this
 * Chromium: both ship every four weeks, Firefox two versions ahead (Chrome
 * 138 and Firefox 140 came out on the same day).
 */
export function firefoxUserAgent(chromeUa: string): string {
  const major = Number(/Chrome\/(\d+)/.exec(chromeUa)?.[1] ?? 0);
  const version = `${major ? major + 2 : 140}.0`;
  const system = /\(([^)]*)\)/.exec(chromeUa)?.[1] ?? "";
  const os = system.includes("Windows")
    ? "Windows NT 10.0; Win64; x64"
    : system.includes("Mac OS X")
      ? "Macintosh; Intel Mac OS X 10.15"
      : system.includes("Linux")
        ? system
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${os}; rv:${version}) Gecko/20100101 Firefox/${version}`;
}

/**
 * Makes a request's headers Firefox's: its user agent, and none of
 * Chromium's client hints (Sec-CH-UA and the rest), which Firefox never
 * sends.
 */
export function asFirefoxRequest(headers: Record<string, string>, firefoxUa: string): void {
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower === "user-agent" || lower.startsWith("sec-ch-")) delete headers[name];
  }
  headers["User-Agent"] = firefoxUa;
}

/** Only the preferred language and its base, like Helium's reduced header. */
export function acceptLanguages(preferred: readonly string[]): string {
  const first = preferred.find((l) => /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(l)) ?? "en-US";
  const base = first.split("-")[0];
  return base === first ? first : `${first},${base}`;
}
