/**
 * The Windows WebAuthn binding against a stand-in for webauthn.dll built
 * from Microsoft's own webauthn.h (scripts/fixtures/webauthn/mock.c), so the
 * structure layouts are checked on any machine with a C compiler. The
 * stand-in describes every field it received as text.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import koffi from "koffi";
import { beforeAll, describe, expect, it } from "vitest";
import { WindowsWebAuthn } from "./webauthn-win";

const fixtures = resolve(__dirname, "../../scripts/fixtures/webauthn");

function buildMock(): string | null {
  if (process.platform === "win32") return null;
  try {
    const lib = join(mkdtempSync(join(tmpdir(), "moon-webauthn-")), "libwebauthn-mock.so");
    execFileSync("cc", ["-shared", "-fPIC", "-I", fixtures, "-o", lib, join(fixtures, "mock.c")]);
    return lib;
  } catch {
    return null;
  }
}

const mock = buildMock();
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe.skipIf(!mock)("Windows WebAuthn binding (stand-in DLL)", () => {
  let setVersion: (v: number) => void;
  beforeAll(() => {
    const fn = koffi.load(mock).func("mock_set_api_version", "void", ["uint32_t"]);
    setVersion = (v) => void fn(v);
  });

  const call = {
    hwnd: 0x1234n,
    rpId: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    rpName: "Moon",
    user: { id: new Uint8Array([7, 8, 9]), name: "luna@example.com", displayName: "Luna" },
    algorithms: [-7, -257],
    clientData: new TextEncoder().encode('{"type":"webauthn.create"}'),
    timeout: 60_000,
    exclude: [
      { id: new Uint8Array([0xaa, 0xbb]), transports: 0x10 },
      { id: new Uint8Array([0xcc]), transports: 0x03 },
    ],
    attachment: 1,
    requireResidentKey: false,
    preferResidentKey: true,
    userVerification: 1,
    attestation: 1,
  };

  const made = (result: { attestationObject: Uint8Array }) => text(result.attestationObject);

  it("hands Windows every field of a new credential, as Chrome lays it out", async () => {
    setVersion(7);
    const api = WindowsWebAuthn.load(mock!)!;
    expect(api.apiVersion).toBe(7);
    expect(api.isPlatformAuthenticatorAvailable()).toBe(true);
    const result = await api.makeCredential(call);
    expect(made(result)).toBe(
      "hwnd=1234;rp=v1:chrome-extension://abcdefghijklmnopabcdefghijklmnop|Moon|(null)" +
        ";user=v1:070809|luna@example.com|(null)|Luna" +
        ";algs=v1:public-key/-7,v1:public-key/-257" +
        ';cd=v1:{"type":"webauthn.create"}|SHA-256' +
        // Chrome's version and time limit (the page's is kept by Moon Browser).
        ";opt=v8,t=300000,cl=0,ext=0,att=1,rrk=0,uv=1,ac=1,flags=0,cancel=yes" +
        ",ex=v1:aabb/public-key/16,v1:cc/public-key/3,ea=0,lb=0,prk=1" +
        ",pm=0,prf=0,ld=none,json=0,eval=none,hints=0,tpp=0",
    );
    expect(hex(result.credentialId)).toBe("01020304");
    expect(hex(result.authenticatorData)).toBe("a1a2a3");
    expect(result.transport).toBe(0x10);
  });

  it("hands every Windows Chrome's options, like Chrome", async () => {
    setVersion(1);
    const api = WindowsWebAuthn.load(mock!)!;
    expect(made(await api.makeCredential(call))).toContain(";opt=v8,t=300000,");
  });

  it("can still lay the options out as before", async () => {
    setVersion(4);
    let api = WindowsWebAuthn.load(mock!)!;
    const legacy = made(await api.makeCredential({ ...call, layout: "legacy" }));
    expect(legacy).toContain(";opt=v4,t=60000,");
    expect(legacy).toMatch(/,ea=0,lb=0,prk=1$/);
    setVersion(1);
    api = WindowsWebAuthn.load(mock!)!;
    const oldest = made(await api.makeCredential({ ...call, exclude: [], layout: "legacy" }));
    expect(oldest).toContain(";opt=v3,");
    expect(oldest).toContain(",cancel=yes,ex=none");
    expect(oldest).not.toContain("prk=");
  });

  it("turns Windows' errors into the page's DOMException names", async () => {
    setVersion(7);
    const api = WindowsWebAuthn.load(mock!)!;
    await expect(
      api.makeCredential({ ...call, user: { ...call.user, name: "!cancel" } }),
    ).rejects.toMatchObject({ domName: "NotAllowedError", hresult: 0x800704c7 });
    // Refused at once as invalid: what the older options are tried for.
    await expect(
      api.makeCredential({ ...call, user: { ...call.user, name: "?refuse" } }),
    ).rejects.toMatchObject({ domName: "NotSupportedError", hresult: 0x80090027 });
    await expect(
      api.makeCredential({ ...call, user: { ...call.user, name: "?refuse" }, layout: "legacy" }),
    ).resolves.toBeTruthy();
  });

  const assertion = {
    hwnd: 0xbeefn,
    rpId: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    clientData: new TextEncoder().encode('{"type":"webauthn.get"}'),
    timeout: 30_000,
    allow: [{ id: new Uint8Array([1, 2]), transports: 0x10 }],
    userVerification: 1,
  };

  it("asks Windows for an assertion with the allowed credentials, as Chrome does", async () => {
    const api = WindowsWebAuthn.load(mock!)!;
    const result = await api.getAssertion(assertion);
    expect(text(result.signature)).toBe(
      "hwnd=beef;rp=chrome-extension://abcdefghijklmnopabcdefghijklmnop" +
        ';cd=v1:{"type":"webauthn.get"}|SHA-256' +
        // The credentials twice (the older list too) and "the AppID wasn't used".
        ";opt=v8,t=300000,cl=v1:0102/public-key,ext=0,att=0,uv=1,flags=0" +
        ",appid=none,usedappid=false,cancel=yes,allow=v1:0102/public-key/16" +
        ",lbo=0,lb=0,salts=none,pm=0,ld=none,af=0,json=0,hints=0",
    );
    expect(hex(result.credentialId)).toBe("0908");
    expect(hex(result.authenticatorData)).toBe("b1b2");
    expect(hex(result.userHandle!)).toBe("55");
    const legacy = await api.getAssertion({ ...assertion, layout: "legacy" });
    expect(text(legacy.signature)).toContain(
      ";opt=v4,t=30000,cl=,ext=0,att=0,uv=1,flags=0,appid=none,usedappid=none,cancel=yes" +
        ",allow=v1:0102/public-key/16",
    );
  });

  it("is missing, not broken, where there is no API", () => {
    expect(WindowsWebAuthn.load(join(fixtures, "no-such-library.so"))).toBeNull();
  });
});
