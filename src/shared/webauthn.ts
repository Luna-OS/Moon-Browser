/**
 * WebAuthn (Windows Hello, passkeys, security keys) for extension pages.
 *
 * Electron refuses navigator.credentials in chrome-extension:// pages, which
 * Chrome allows — password managers set up their biometric unlock with it
 * (NordPass). Moon Browser answers these requests itself through the
 * system's WebAuthn API, following Chrome's rules; they are kept here so the
 * tests can check them.
 */
import { parse } from "tldts";

/** An error the page receives as a DOMException with this name. */
export class WebAuthnError extends Error {
  constructor(
    readonly domName:
      | "NotAllowedError"
      | "SecurityError"
      | "NotSupportedError"
      | "InvalidStateError"
      | "ConstraintError"
      | "AbortError"
      | "TypeError",
    message: string,
  ) {
    super(message);
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: unknown, what: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1)
    throw new WebAuthnError("TypeError", `${what} must be a BufferSource`);
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
}

/**
 * The relying party ID the authenticator sees for an extension's request,
 * as Chrome decides it: the extension's own ID (also the default) becomes
 * its whole origin, "chrome-extension://<id>", so it can't collide with a
 * web site's; a web domain needs the extension's host permission for it.
 */
export function extensionRpId(
  extensionId: string,
  claimed: unknown,
  hasHostAccess: (url: string) => boolean,
): string {
  const rp = claimed === undefined ? extensionId : claimed;
  if (typeof rp !== "string") throw new WebAuthnError("TypeError", "rp.id must be a string");
  if (rp === extensionId) return `chrome-extension://${extensionId}`;
  const denied = () =>
    new WebAuthnError("SecurityError", `The extension may not use the relying party ID "${rp}".`);
  if (rp === "localhost") {
    if (hasHostAccess("http://localhost/")) return rp;
    throw denied();
  }
  // A canonical host name (lower case, no port) under a public suffix.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(rp)) throw denied();
  const info = parse(rp, { allowPrivateDomains: true });
  if (info.isIp || !info.domain) throw denied();
  if (!hasHostAccess(`https://${rp}/`)) throw denied();
  return rp;
}

/** The client data the authenticator signs, in Chrome's form. */
export function clientDataJSON(
  type: "webauthn.create" | "webauthn.get",
  challenge: Uint8Array,
  origin: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ type, challenge: toBase64Url(challenge), origin, crossOrigin: false }),
  );
}

/** Transports as the WebAuthn API names them and Windows numbers them. */
export const TRANSPORTS: Record<string, number> = {
  usb: 0x01,
  nfc: 0x02,
  ble: 0x04,
  internal: 0x10,
  hybrid: 0x20,
  "smart-card": 0x40,
};

export function transportsMask(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce<number>((mask, t) => mask | (TRANSPORTS[String(t)] ?? 0), 0);
}

export function transportNames(mask: number): string[] {
  return Object.entries(TRANSPORTS)
    .filter(([, bit]) => mask & bit)
    .map(([name]) => name);
}

/** Chrome keeps timeouts between 10 seconds and 10 minutes, 5 by default. */
export function clampTimeout(ms: unknown): number {
  const value = typeof ms === "number" && Number.isFinite(ms) ? ms : 300_000;
  return Math.round(Math.min(600_000, Math.max(10_000, value)));
}

// Windows' numbering of the options (webauthn.h).
const ATTACHMENT: Record<string, number> = { platform: 1, "cross-platform": 2 };
const USER_VERIFICATION: Record<string, number> = { required: 1, preferred: 2, discouraged: 3 };
const ATTESTATION: Record<string, number> = { none: 1, indirect: 2, direct: 3, enterprise: 3 };

export interface CredentialDescriptor {
  id: Uint8Array;
  transports: number;
}

export interface CreationRequest {
  rpId?: unknown;
  rpName: string;
  user: { id: Uint8Array; name: string; displayName: string };
  challenge: Uint8Array;
  /** COSE algorithm IDs, in the order the page prefers them. */
  algorithms: number[];
  timeout: number;
  exclude: CredentialDescriptor[];
  attachment: number;
  requireResidentKey: boolean;
  preferResidentKey: boolean;
  userVerification: number;
  attestation: number;
}

export interface AssertionRequest {
  rpId?: unknown;
  challenge: Uint8Array;
  timeout: number;
  allow: CredentialDescriptor[];
  userVerification: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function descriptors(list: unknown, what: string): CredentialDescriptor[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new WebAuthnError("TypeError", `${what} must be a list`);
  return list
    .filter((d): d is Record<string, unknown> => isObj(d) && d.type === "public-key")
    .map((d) => ({
      id: fromBase64Url(d.id, `${what}[].id`),
      transports: transportsMask(d.transports),
    }))
    .slice(0, 64);
}

/**
 * PublicKeyCredentialCreationOptions, as the page's world sends them (byte
 * values in base64url), checked like Chrome checks them.
 */
export function parseCreationOptions(raw: unknown): CreationRequest {
  if (!isObj(raw) || !isObj(raw.rp) || !isObj(raw.user))
    throw new WebAuthnError("TypeError", "publicKey needs rp and user");
  const userId = fromBase64Url(raw.user.id, "user.id");
  if (userId.length < 1 || userId.length > 64)
    throw new WebAuthnError("TypeError", "user.id must be between 1 and 64 bytes long");
  const params = Array.isArray(raw.pubKeyCredParams) ? raw.pubKeyCredParams : [];
  const algorithms = params
    .filter((p): p is Record<string, unknown> => isObj(p) && p.type === "public-key")
    .map((p) => Number(p.alg))
    .filter((alg) => Number.isInteger(alg));
  if (params.length && !algorithms.length)
    throw new WebAuthnError("NotSupportedError", "No supported public key algorithm");
  const selection = isObj(raw.authenticatorSelection) ? raw.authenticatorSelection : {};
  const residentKey = str(
    selection.residentKey,
    selection.requireResidentKey === true ? "required" : "discouraged",
  );
  return {
    rpId: raw.rp.id,
    rpName: str(raw.rp.name),
    user: { id: userId, name: str(raw.user.name), displayName: str(raw.user.displayName) },
    challenge: fromBase64Url(raw.challenge, "challenge"),
    // Without a list, the spec's defaults: ES256 and RS256.
    algorithms: algorithms.length ? algorithms : [-7, -257],
    timeout: clampTimeout(raw.timeout),
    exclude: descriptors(raw.excludeCredentials, "excludeCredentials"),
    attachment: ATTACHMENT[str(selection.authenticatorAttachment)] ?? 0,
    requireResidentKey: residentKey === "required",
    preferResidentKey: residentKey === "preferred",
    userVerification: USER_VERIFICATION[str(selection.userVerification)] ?? 2,
    attestation: ATTESTATION[str(raw.attestation)] ?? 1,
  };
}

/** PublicKeyCredentialRequestOptions, as parseCreationOptions. */
export function parseRequestOptions(raw: unknown): AssertionRequest {
  if (!isObj(raw)) throw new WebAuthnError("TypeError", "publicKey is missing");
  return {
    rpId: raw.rpId,
    challenge: fromBase64Url(raw.challenge, "challenge"),
    timeout: clampTimeout(raw.timeout),
    allow: descriptors(raw.allowCredentials, "allowCredentials"),
    userVerification: USER_VERIFICATION[str(raw.userVerification)] ?? 2,
  };
}

/** Windows' error names (WebAuthNGetErrorName) as the DOMException the page gets. */
export function errorFromWindows(name: string, hr: number): WebAuthnError {
  const hex = `0x${(hr >>> 0).toString(16).padStart(8, "0")}`;
  switch (name) {
    case "InvalidStateError":
      return new WebAuthnError(
        "InvalidStateError",
        "The authenticator already has this credential.",
      );
    case "NotSupportedError":
      return new WebAuthnError("NotSupportedError", `The request isn't supported (${hex}).`);
    case "ConstraintError":
      return new WebAuthnError("ConstraintError", `The authenticator can't do this (${hex}).`);
    default:
      // Cancelled, timed out, no authenticator, anything else: Chrome's answer.
      return new WebAuthnError(
        "NotAllowedError",
        `The operation either timed out or was not allowed (${hex}).`,
      );
  }
}

/**
 * The COSE algorithm of the public key in a new credential's authenticator
 * data (for getPublicKeyAlgorithm()), or null if it can't be read.
 */
export function coseAlgorithm(authData: Uint8Array): number | null {
  // rpIdHash (32), flags (1), signCount (4), then — with the AT flag —
  // aaguid (16), credential ID length (2), credential ID, the COSE key.
  if (authData.length < 55 || !(authData[32] & 0x40)) return null;
  let at = 53 + ((authData[53] << 8) | authData[54]) + 2;
  const head = (): { major: number; value: number } | null => {
    if (at >= authData.length) return null;
    const byte = authData[at++];
    const info = byte & 0x1f;
    let value = info;
    if (info === 24) value = authData[at++];
    else if (info === 25) value = (authData[at++] << 8) | authData[at++];
    else if (info === 26) {
      value =
        ((authData[at] << 24) >>> 0) +
        (authData[at + 1] << 16) +
        (authData[at + 2] << 8) +
        authData[at + 3];
      at += 4;
    } else if (info > 26) return null;
    return { major: byte >> 5, value };
  };
  const int = (h: { major: number; value: number }) =>
    h.major === 0 ? h.value : h.major === 1 ? -1 - h.value : null;
  const map = head();
  if (!map || map.major !== 5) return null;
  for (let i = 0; i < map.value; i++) {
    const key = head();
    const value = head();
    if (!key || !value) return null;
    if (int(key) === 3) return int(value);
    // Skip byte and text strings; keys and small values are integers.
    if (value.major === 2 || value.major === 3) at += value.value;
    else if (value.major !== 0 && value.major !== 1) return null;
  }
  return null;
}
