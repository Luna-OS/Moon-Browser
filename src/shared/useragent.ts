/**
 * Moon Browser presents itself as the Chromium it is: the app name and the
 * "Electron/x" token are removed, and the Chrome version is reduced to its
 * major number like Chrome's own reduced user agent. That keeps sites
 * working and makes Moon Browser blend in instead of standing out.
 *
 * It is the same everywhere, Google's sign-in included: headers, client
 * hints and what scripts read (navigator.userAgent, userAgentData) all say
 * the same Chromium. Google compares them, and a browser that says one thing
 * in its requests and another to scripts is turned away.
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
 * The client hints Chrome sends with every request to a secure site:
 * Sec-CH-UA (the brands), Sec-CH-UA-Mobile and Sec-CH-UA-Platform. Electron
 * adds them to the requests pages make, but not to the pages themselves
 * (navigations), which Chrome never sends without them. These are the
 * renderer's values: Chromium's brand list, with the made-up "GREASE" brand
 * Chromium derives from the major version (components/embedder_support/
 * user_agent_utils.cc), so both say the same.
 */
export function clientHints(ua: string, platform: string): Record<string, string> {
  const major = Number(/Chrome\/(\d+)/.exec(ua)?.[1] ?? 0);
  const chars = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
  const grease = {
    brand: `Not${chars[major % chars.length]}A${chars[(major + 1) % chars.length]}Brand`,
    version: ["8", "99", "24"][major % 3],
  };
  const chromium = { brand: "Chromium", version: String(major) };
  const brands = major % 2 === 0 ? [grease, chromium] : [chromium, grease];
  const system = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
  return {
    "sec-ch-ua": brands.map((b) => `"${b.brand}";v="${b.version}"`).join(", "),
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${system}"`,
  };
}

/** Client hints go to secure sites only: HTTPS, and this computer. */
export function getsClientHints(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === "https:") return true;
    return (
      protocol === "http:" &&
      (hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "[::1]" ||
        /^127(\.\d{1,3}){3}$/.test(hostname))
    );
  } catch {
    return false;
  }
}

/** Adds the hints a request is missing; hints it has stay as they are. */
export function addClientHints(
  headers: Record<string, string>,
  hints: Record<string, string>,
): void {
  const present = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(hints)) if (!present.has(name)) headers[name] = value;
}

/** Only the preferred language and its base, like Helium's reduced header. */
export function acceptLanguages(preferred: readonly string[]): string {
  const first = preferred.find((l) => /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(l)) ?? "en-US";
  const base = first.split("-")[0];
  return base === first ? first : `${first},${base}`;
}
