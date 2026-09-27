import { describe, expect, it } from "vitest";
import {
  clampTimeout,
  clientDataJSON,
  coseAlgorithm,
  describeRequest,
  errorFromWindows,
  extensionRpId,
  fromBase64Url,
  parseCreationOptions,
  parseRequestOptions,
  toBase64Url,
  transportNames,
  transportsMask,
  tryInTurn,
  WebAuthnError,
} from "./webauthn";

const ID = "eiaeiblijfjekdanodkjadfinkhbfgcd";

describe("WebAuthn for extensions", () => {
  it("gives an extension its own origin as RP ID, like Chrome", () => {
    const none = () => false;
    expect(extensionRpId(ID, undefined, none)).toBe(`chrome-extension://${ID}`);
    expect(extensionRpId(ID, ID, none)).toBe(`chrome-extension://${ID}`);
    // Another extension's ID, or a site without host permission: refused.
    expect(() => extensionRpId(ID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", none)).toThrow(
      expect.objectContaining({ domName: "SecurityError" }),
    );
    expect(() => extensionRpId(ID, "nordpass.com", none)).toThrow();
    // A site it may access: its domain, as is.
    const access = (url: string) => url === "https://nordpass.com/";
    expect(extensionRpId(ID, "nordpass.com", access)).toBe("nordpass.com");
    // Never IP addresses, public suffixes, ports or odd spellings.
    const all = () => true;
    for (const bad of ["127.0.0.1", "com", "co.uk", "Nordpass.com", "nordpass.com:443", "a b.com"])
      expect(() => extensionRpId(ID, bad, all)).toThrow();
    expect(() => extensionRpId(ID, 42, all)).toThrow(
      expect.objectContaining({ domName: "TypeError" }),
    );
  });

  it("builds Chrome's client data with the extension's origin", () => {
    const data = clientDataJSON(
      "webauthn.create",
      new Uint8Array([251, 255, 0]),
      `chrome-extension://${ID}`,
    );
    expect(new TextDecoder().decode(data)).toBe(
      `{"type":"webauthn.create","challenge":"-_8A","origin":"chrome-extension://${ID}","crossOrigin":false}`,
    );
  });

  it("round-trips base64url and rejects what isn't", () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes), "x")).toEqual(bytes);
    }
    expect(() => fromBase64Url("a+b/", "x")).toThrow();
    expect(() => fromBase64Url("abcde", "x")).toThrow();
    expect(() => fromBase64Url(new Uint8Array(1), "x")).toThrow();
  });

  it("reads creation options the way Chrome checks them", () => {
    const req = parseCreationOptions({
      rp: { id: ID, name: "NordPass" },
      user: { id: "AQID", name: "luna", displayName: "Luna" },
      challenge: "AAAA",
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "other", alg: 1 },
      ],
      excludeCredentials: [{ type: "public-key", id: "qg", transports: ["internal", "usb"] }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "direct",
      timeout: 1,
    });
    expect(req).toMatchObject({
      rpId: ID,
      rpName: "NordPass",
      algorithms: [-7],
      timeout: 10_000,
      attachment: 1,
      requireResidentKey: false,
      preferResidentKey: true,
      userVerification: 1,
      attestation: 3,
    });
    expect(req.user.id).toEqual(new Uint8Array([1, 2, 3]));
    expect(req.exclude).toEqual([{ id: new Uint8Array([0xaa]), transports: 0x11 }]);
    // Defaults: ES256 and RS256, any authenticator, UV preferred, no attestation.
    const plain = parseCreationOptions({ rp: {}, user: { id: "AQ" }, challenge: "" });
    expect(plain).toMatchObject({
      algorithms: [-7, -257],
      attachment: 0,
      userVerification: 2,
      attestation: 1,
      timeout: 300_000,
    });
    // user.id must be 1 to 64 bytes; only unknown algorithms: not supported.
    expect(() => parseCreationOptions({ rp: {}, user: { id: "" }, challenge: "" })).toThrow();
    expect(() =>
      parseCreationOptions({
        rp: {},
        user: { id: "AQ" },
        challenge: "",
        pubKeyCredParams: [{ type: "x", alg: -7 }],
      }),
    ).toThrow(expect.objectContaining({ domName: "NotSupportedError" }));
  });

  it("reads request options", () => {
    expect(
      parseRequestOptions({
        rpId: ID,
        challenge: "AQ",
        allowCredentials: [{ type: "public-key", id: "Ag" }],
        userVerification: "discouraged",
        timeout: 9e9,
      }),
    ).toEqual({
      rpId: ID,
      challenge: new Uint8Array([1]),
      timeout: 600_000,
      allow: [{ id: new Uint8Array([2]), transports: 0 }],
      userVerification: 3,
    });
    expect(clampTimeout(undefined)).toBe(300_000);
  });

  it("names transports and Windows' errors as the page expects", () => {
    expect(transportsMask(["hybrid", "nope", "nfc"])).toBe(0x22);
    expect(transportNames(0x10)).toEqual(["internal"]);
    expect(errorFromWindows("NotAllowedError", 0x800704c7 | 0).domName).toBe("NotAllowedError");
    expect(errorFromWindows("InvalidStateError", 0x8009000f | 0).domName).toBe("InvalidStateError");
    expect(errorFromWindows("UnknownError", -1).domName).toBe("NotAllowedError");
    expect(errorFromWindows("NotSupportedError", 0x80090027 | 0)).toMatchObject({
      domName: "NotSupportedError",
      hresult: 0x80090027,
      message: "The request isn't supported (0x80090027).",
    });
  });

  it("asks Windows for direct attestation when the page wants indirect, like Chrome", () => {
    const base = {
      rp: { name: "NordPass" },
      user: { id: "AQID", name: "luna", displayName: "Luna" },
      challenge: "AAAA",
    };
    expect(parseCreationOptions({ ...base, attestation: "indirect" }).attestation).toBe(3);
    expect(parseCreationOptions({ ...base, attestation: "none" }).attestation).toBe(1);
  });

  describe("trying again when Windows refuses at once", () => {
    const refused = () =>
      new WebAuthnError("NotSupportedError", "The request isn't supported.", 0x80090027);
    const clock = (steps: number[]) => {
      let i = 0;
      return () => steps[Math.min(i++, steps.length - 1)];
    };

    it("goes on to the next way while the refusal is immediate", async () => {
      const seen: string[] = [];
      const outcome = await tryInTurn(
        [{ label: "a" }, { label: "b" }, { label: "c" }],
        ({ label }) => {
          seen.push(label);
          return label === "c" ? Promise.resolve(label) : Promise.reject(refused());
        },
        clock([0, 5, 10, 20, 30, 40]),
      );
      expect(seen).toEqual(["a", "b", "c"]);
      expect(outcome).toMatchObject({ ok: true, value: "c" });
      expect(outcome.log.map((t) => [t.label, t.outcome, t.ms])).toEqual([
        ["a", "The request isn't supported.", 5],
        ["b", "The request isn't supported.", 10],
        ["c", "worked", 10],
      ]);
    });

    it("never asks again after a dialog was shown, or for other errors", async () => {
      // Refused only after 5 seconds: the person saw Windows' dialog.
      const late = await tryInTurn(
        [{ label: "a" }, { label: "b" }],
        () => Promise.reject(refused()),
        clock([0, 5_000]),
      );
      expect(late).toMatchObject({ ok: false, log: [{ label: "a" }] });
      const cancelled = await tryInTurn(
        [{ label: "a" }, { label: "b" }],
        () => Promise.reject(new WebAuthnError("NotAllowedError", "cancelled", 0x800704c7)),
        clock([0, 1]),
      );
      expect(cancelled.log).toHaveLength(1);
      expect(!cancelled.ok && cancelled.error).toMatchObject({ domName: "NotAllowedError" });
    });
  });

  it("describes a request's shape without its secrets", () => {
    const text = describeRequest({
      rp: { name: "NordPass" },
      user: { id: "AAECAwQFBgcICQoLDA0ODw", name: "luna@example.com", displayName: "Luna" },
      challenge: "c2VjcmV0",
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "direct",
      excludeCredentials: [{ type: "public-key", id: "AQ" }],
      extensions: { credProps: true },
      timeout: 60000,
    });
    expect(text).toBe(
      'rp.id: (none); attachment: "platform"; residentKey: "preferred"; userVerification: "required"' +
        '; attestation: "direct"; algorithms: -7,-257; user.id: 16 bytes; excludeCredentials: 1' +
        "; extensions: credProps; timeout: 60000",
    );
    expect(text).not.toContain("luna");
    expect(text).not.toContain("c2VjcmV0");
    expect(describeRequest({ rpId: "example.com", challenge: "AA", allowCredentials: [] })).toBe(
      'rp.id: "example.com"; userVerification: (none); allowCredentials: 0',
    );
  });

  it("finds the key's algorithm in the authenticator data", () => {
    const authData = (coseKey: number[]) =>
      new Uint8Array([
        ...new Array<number>(32).fill(0), // rpIdHash
        0x45, // flags: UP, UV, AT
        0,
        0,
        0,
        1, // signCount
        ...new Array<number>(16).fill(0), // aaguid
        0,
        2,
        9,
        9, // credential ID
        ...coseKey,
      ]);
    // {1: 2, 3: -7, -1: 1, -2: h'0102'}
    expect(
      coseAlgorithm(authData([0xa4, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x42, 1, 2])),
    ).toBe(-7);
    // {1: 3, 3: -257}
    expect(coseAlgorithm(authData([0xa2, 0x01, 0x03, 0x03, 0x39, 0x01, 0x00]))).toBe(-257);
    expect(coseAlgorithm(new Uint8Array(37))).toBeNull();
  });
});
