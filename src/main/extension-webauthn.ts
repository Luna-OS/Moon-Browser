/**
 * navigator.credentials for extension pages (see @shared/webauthn): the
 * request comes from the extension's own page, Moon Browser checks it as
 * Chrome would, fills in the client data with the extension's origin (never
 * taken from the page), and Windows asks for Windows Hello, a security key
 * or a phone in its own dialog.
 */
import { app, BrowserWindow, type WebContents } from "electron";
import { matchesPattern } from "@shared/extensions";
import {
  clientDataJSON,
  coseAlgorithm,
  extensionRpId,
  parseCreationOptions,
  parseRequestOptions,
  toBase64Url,
  transportNames,
  WebAuthnError,
} from "@shared/webauthn";
import type { Browser } from "./browser";
// Loaded when first needed, and only where it's used: koffi's native part
// ships with the Windows build only.
import type { Cancelable, WindowsWebAuthn } from "./webauthn-win";

/** What the page's world gets back: the credential's bytes, or the error to throw. */
export type WebAuthnReply =
  { ok: true; credential: Record<string, unknown> } | { ok: false; name: string; message: string };

/**
 * A stand-in for webauthn.dll (scripts/fixtures/webauthn/mock.c) for the
 * end-to-end test on Linux. Never in the packaged app: a library chosen by
 * the environment must not load into it.
 */
export const TEST_LIBRARY = "MOON_WEBAUTHN_LIBRARY";

export class ExtensionWebAuthn {
  private system: Promise<WindowsWebAuthn | null> | null = null;
  /** Why the system's API couldn't be loaded, for the extension's errors. */
  private loadError = "";
  /** Requests in flight, by extension ID and the page's request ID. */
  private readonly inFlight = new Map<string, Cancelable>();

  constructor(private readonly browser: Browser) {}

  /** The system's WebAuthn API: Windows 10 1903 and later, for now. */
  private api(): Promise<WindowsWebAuthn | null> {
    const testLibrary = app.isPackaged ? undefined : process.env[TEST_LIBRARY];
    if (process.platform !== "win32" && !testLibrary) return Promise.resolve(null);
    this.system ??= import("./webauthn-win")
      .then(({ WindowsWebAuthn }) => WindowsWebAuthn.open(testLibrary || "webauthn.dll"))
      .catch((err: unknown) => {
        console.warn("[moon] WebAuthn unavailable:", err);
        this.loadError = err instanceof Error ? err.message : String(err);
        return null;
      });
    return this.system;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return (await this.api())?.isPlatformAuthenticatorAvailable() ?? false;
    } catch {
      return false;
    }
  }

  cancel(extensionId: string, requestId: unknown): void {
    if (typeof requestId === "string") this.inFlight.get(`${extensionId} ${requestId}`)?.cancel();
  }

  /** Host permission as Chrome's HasHostPermission sees it (not content scripts). */
  private hostAccess(extensionId: string, url: string): boolean {
    const manifest = this.browser.extensions.manifest(extensionId);
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
    const patterns = [...list(manifest?.host_permissions), ...list(manifest?.permissions)].filter(
      (p): p is string => typeof p === "string",
    );
    return patterns.some(
      (p) => (p.includes("://") || p === "<all_urls>") && matchesPattern(p, url),
    );
  }

  /**
   * The window the system dialog belongs to: the pop-up's, or the tab's (0
   * if none is found; the binding then uses the window in front).
   */
  private hwnd(sender: WebContents): bigint {
    const live = (w: BrowserWindow | null | undefined) => (w && !w.isDestroyed() ? w : null);
    const win =
      live(BrowserWindow.fromWebContents(sender)) ??
      live(this.browser.tabFor(sender.id)?.window.win) ??
      live(BrowserWindow.getFocusedWindow()) ??
      live(this.browser.focusedWindow()?.win);
    if (!win) return 0n;
    const handle = win.getNativeWindowHandle();
    return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  }

  async request(
    extensionId: string,
    sender: WebContents,
    kind: "create" | "get",
    requestId: unknown,
    options: unknown,
  ): Promise<WebAuthnReply> {
    const api = await this.api();
    const gone = () => this.cancel(extensionId, requestId);
    const hwnd = this.hwnd(sender);
    try {
      if (!api)
        throw new WebAuthnError(
          "NotSupportedError",
          `Windows' WebAuthn API isn't available${this.loadError ? `: ${this.loadError}` : "."}`,
        );
      if (typeof requestId !== "string") throw new WebAuthnError("TypeError", "Bad request");
      const origin = `chrome-extension://${extensionId}`;
      const hasHostAccess = (url: string) => this.hostAccess(extensionId, url);
      const track = (c: Cancelable) => this.inFlight.set(`${extensionId} ${requestId}`, c);
      // The page going away (its pop-up closed) ends the system dialog too.
      sender.once("destroyed", gone);
      if (kind === "create") {
        const req = parseCreationOptions(options);
        const clientData = clientDataJSON("webauthn.create", req.challenge, origin);
        const result = await api.makeCredential(
          {
            hwnd,
            rpId: extensionRpId(extensionId, req.rpId, hasHostAccess),
            rpName: req.rpName,
            user: req.user,
            algorithms: req.algorithms,
            clientData,
            timeout: req.timeout,
            exclude: req.exclude,
            attachment: req.attachment,
            requireResidentKey: req.requireResidentKey,
            preferResidentKey: req.preferResidentKey,
            userVerification: req.userVerification,
            attestation: req.attestation,
          },
          track,
        );
        return {
          ok: true,
          credential: {
            id: toBase64Url(result.credentialId),
            clientDataJSON: toBase64Url(clientData),
            attestationObject: toBase64Url(result.attestationObject),
            authenticatorData: toBase64Url(result.authenticatorData),
            transports: transportNames(result.transport),
            attachment: result.transport === 0x10 ? "platform" : "cross-platform",
            publicKeyAlgorithm: coseAlgorithm(result.authenticatorData) ?? req.algorithms[0],
          },
        };
      }
      const req = parseRequestOptions(options);
      const clientData = clientDataJSON("webauthn.get", req.challenge, origin);
      const result = await api.getAssertion(
        {
          hwnd,
          rpId: extensionRpId(extensionId, req.rpId, hasHostAccess),
          clientData,
          timeout: req.timeout,
          allow: req.allow,
          userVerification: req.userVerification,
        },
        track,
      );
      return {
        ok: true,
        credential: {
          id: toBase64Url(result.credentialId),
          clientDataJSON: toBase64Url(clientData),
          authenticatorData: toBase64Url(result.authenticatorData),
          signature: toBase64Url(result.signature),
          userHandle: result.userHandle ? toBase64Url(result.userHandle) : null,
        },
      };
    } catch (err) {
      const reply: WebAuthnReply =
        err instanceof WebAuthnError
          ? { ok: false, name: err.domName, message: err.message }
          : {
              ok: false,
              name: "NotAllowedError",
              message: `The operation failed: ${err instanceof Error ? err.message : String(err)}`,
            };
      // The page only learns the DOMException's name; the extension's
      // errors on moon://extensions say what happened (as Chrome's console).
      this.browser.extensions.recordError(
        extensionId,
        `Windows Hello (navigator.credentials.${kind}) failed: ${reply.name}: ${reply.message}${describeRequest(options, hwnd)}`,
      );
      return reply;
    } finally {
      if (!sender.isDestroyed()) sender.off("destroyed", gone);
      if (typeof requestId === "string") this.inFlight.delete(`${extensionId} ${requestId}`);
    }
  }
}

/** The request's shape for an error message — never its challenge or user data. */
function describeRequest(options: unknown, hwnd: bigint): string {
  const window = hwnd ? `window 0x${hwnd.toString(16)}` : "no window of its own";
  if (!options || typeof options !== "object") return ` (${window})`;
  const o = options as Record<string, unknown>;
  const rp = o.rp as Record<string, unknown> | undefined;
  const sel = o.authenticatorSelection as Record<string, unknown> | undefined;
  const parts = [
    `rp.id: ${JSON.stringify(rp ? rp.id : o.rpId)}`,
    sel && `attachment: ${String(sel.authenticatorAttachment)}`,
    sel && `residentKey: ${String(sel.residentKey ?? sel.requireResidentKey)}`,
    `userVerification: ${String(sel ? sel.userVerification : o.userVerification)}`,
    Array.isArray(o.pubKeyCredParams) &&
      `algorithms: ${o.pubKeyCredParams.map((p: { alg?: unknown }) => String(p.alg)).join(",")}`,
    window,
  ].filter(Boolean);
  return ` (${parts.join("; ")})`;
}
