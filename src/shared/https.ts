/**
 * HTTPS-first: plain http:// addresses are tried over HTTPS first. If the
 * secure connection fails, the host is remembered for the session and the
 * page loads over HTTP after all — like Chromium's "HTTPS-First Mode".
 */
import { isIpAddress } from "./omnibox";

const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".lan",
  ".home",
  ".internal",
  ".home.arpa",
  ".test",
];

/** Hosts that never get upgraded: they usually have no certificate at all. */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || !h.includes(".")) return true;
  if (LOCAL_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return isIpAddress(h) || h.startsWith("[") || h.includes(":");
}

/** The https:// URL to try instead of `url`, or null to leave it alone. */
export function httpsUpgrade(url: string, exceptions: ReadonlySet<string>): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:") return null;
  // An explicit port other than 80 means a specific service; leave it.
  if (u.port && u.port !== "80") return null;
  if (isLocalHost(u.hostname) || exceptions.has(u.hostname)) return null;
  u.protocol = "https:";
  return u.href;
}

/**
 * Network errors (Chromium net error codes) after which an upgraded load
 * falls back to HTTP: the server has no (valid) HTTPS, not "the network is
 * down".
 */
const FALLBACK_ERRORS = new Set([
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -107, // SSL_PROTOCOL_ERROR
  -113, // SSL_VERSION_OR_CIPHER_MISMATCH
  -118, // CONNECTION_TIMED_OUT
  -200, // CERT_COMMON_NAME_INVALID
  -201, // CERT_DATE_INVALID
  -202, // CERT_AUTHORITY_INVALID
  -203, // CERT_CONTAINS_ERRORS
  -207, // CERT_INVALID
  -213, // CERT_NAME_CONSTRAINT_VIOLATION
  -324, // EMPTY_RESPONSE
]);

export function shouldFallBackToHttp(errorCode: number): boolean {
  return FALLBACK_ERRORS.has(errorCode);
}
