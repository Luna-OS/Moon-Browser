/**
 * The moon:// protocol: Moon Browser's own pages, served from the app
 * bundle. moon://ui/ is the browser UI and exists only in the UI's session;
 * web tabs can reach the internal pages (moon://newtab/, moon://settings/, …)
 * but never the UI.
 */
import { protocol, type Session } from "electron";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { INTERNAL_PAGES, INTERNAL_SCHEME } from "@shared/internal";
import { rendererDir } from "./paths";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const csp = (ui: boolean) =>
  [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Favicons of visited sites; in the UI also the extension buttons' icons.
    `img-src 'self' data: https: http:${ui ? " crx:" : ""}`,
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: INTERNAL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    // The extension buttons' icons in the browser UI, as
    // electron-chrome-extensions registers it (a later call replaces an
    // earlier one, so both are listed here).
    { scheme: "crx", privileges: { bypassCSP: true } },
  ]);
}

/** Resolves a path inside `root`, refusing anything that escapes it. */
function inside(root: string, path: string): string | null {
  const full = normalize(join(root, decodeURIComponent(path)));
  return full.startsWith(root + sep) ? full : null;
}

export function handleInternalProtocol(ses: Session, options: { ui: boolean }): void {
  ses.protocol.handle(INTERNAL_SCHEME, async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    const kind =
      host === "ui" && options.ui
        ? "ui"
        : !options.ui && (INTERNAL_PAGES as readonly string[]).includes(host)
          ? "pages"
          : null;
    if (!kind || request.method !== "GET") return new Response("Not found", { status: 404 });

    // Hashed assets and public files are shared; every other path is the page.
    const isAsset =
      url.pathname.startsWith("/assets/") || /^\/[\w.-]+\.(svg|png|ico)$/.test(url.pathname);
    const file = isAsset
      ? inside(rendererDir, url.pathname)
      : join(rendererDir, kind, "index.html");
    if (!file) return new Response("Not found", { status: 404 });

    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
          "content-security-policy": csp(kind === "ui"),
          "x-content-type-options": "nosniff",
          "cross-origin-opener-policy": "same-origin",
          "referrer-policy": "no-referrer",
          "cache-control": isAsset ? "max-age=31536000, immutable" : "no-cache",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
