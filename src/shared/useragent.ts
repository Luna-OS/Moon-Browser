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

/** Only the preferred language and its base, like Helium's reduced header. */
export function acceptLanguages(preferred: readonly string[]): string {
  const first = preferred.find((l) => /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(l)) ?? "en-US";
  const base = first.split("-")[0];
  return base === first ? first : `${first},${base}`;
}
