/**
 * Windows' own WebAuthn API (webauthn.dll, Windows 10 1903 and later): the
 * system dialog for Windows Hello, security keys and phones, as Chrome uses
 * it. Called through koffi on a worker thread; every structure is built in
 * memory allocated here and freed when the call is over. The layouts follow
 * Microsoft's webauthn.h (tested against it in webauthn-win.test.ts).
 */
import koffi, { type LibraryHandle } from "koffi";
import { errorFromWindows, type CredentialDescriptor, type WebAuthnError } from "@shared/webauthn";

type TypeSpec = Parameters<typeof koffi.alloc>[0];
type KoffiFunction = ReturnType<LibraryHandle["func"]>;

const DWORD = "uint32_t";
const BOOL = "int32_t";
const LONG = "int32_t";
const PTR = "void *";
const WSTR = "const char16_t *";

const GUID = koffi.struct("MOON_GUID", {
  Data1: "uint32_t",
  Data2: "uint16_t",
  Data3: "uint16_t",
  Data4: koffi.array("uint8_t", 8),
});
const RP = koffi.struct("MOON_WEBAUTHN_RP_ENTITY_INFORMATION", {
  dwVersion: DWORD,
  pwszId: WSTR,
  pwszName: WSTR,
  pwszIcon: WSTR,
});
const USER = koffi.struct("MOON_WEBAUTHN_USER_ENTITY_INFORMATION", {
  dwVersion: DWORD,
  cbId: DWORD,
  pbId: PTR,
  pwszName: WSTR,
  pwszIcon: WSTR,
  pwszDisplayName: WSTR,
});
const COSE_PARAMETER = koffi.struct("MOON_WEBAUTHN_COSE_CREDENTIAL_PARAMETER", {
  dwVersion: DWORD,
  pwszCredentialType: WSTR,
  lAlg: LONG,
});
const COSE_PARAMETERS = koffi.struct("MOON_WEBAUTHN_COSE_CREDENTIAL_PARAMETERS", {
  cCredentialParameters: DWORD,
  pCredentialParameters: PTR,
});
const CLIENT_DATA = koffi.struct("MOON_WEBAUTHN_CLIENT_DATA", {
  dwVersion: DWORD,
  cbClientDataJSON: DWORD,
  pbClientDataJSON: PTR,
  pwszHashAlgId: WSTR,
});
const CREDENTIAL = koffi.struct("MOON_WEBAUTHN_CREDENTIAL", {
  dwVersion: DWORD,
  cbId: DWORD,
  pbId: PTR,
  pwszCredentialType: WSTR,
});
const CREDENTIALS = koffi.struct("MOON_WEBAUTHN_CREDENTIALS", {
  cCredentials: DWORD,
  pCredentials: PTR,
});
const CREDENTIAL_EX = koffi.struct("MOON_WEBAUTHN_CREDENTIAL_EX", {
  dwVersion: DWORD,
  cbId: DWORD,
  pbId: PTR,
  pwszCredentialType: WSTR,
  dwTransports: DWORD,
});
const CREDENTIAL_LIST = koffi.struct("MOON_WEBAUTHN_CREDENTIAL_LIST", {
  cCredentials: DWORD,
  ppCredentials: PTR,
});
const EXTENSIONS = koffi.struct("MOON_WEBAUTHN_EXTENSIONS", {
  cExtensions: DWORD,
  pExtensions: PTR,
});
// Version 3: what every Windows with the API knows (API version 1).
const MAKE_OPTIONS_3 = {
  dwVersion: DWORD,
  dwTimeoutMilliseconds: DWORD,
  CredentialList: CREDENTIALS,
  Extensions: EXTENSIONS,
  dwAuthenticatorAttachment: DWORD,
  bRequireResidentKey: BOOL,
  dwUserVerificationRequirement: DWORD,
  dwAttestationConveyancePreference: DWORD,
  dwFlags: DWORD,
  pCancellationId: PTR,
  pExcludeCredentialList: PTR,
};
const MAKE_OPTIONS_V3 = koffi.struct("MOON_WEBAUTHN_MAKE_CREDENTIAL_OPTIONS_3", MAKE_OPTIONS_3);
// Version 4 (API version 3, Windows 11): adds "resident key preferred".
const MAKE_OPTIONS_V4 = koffi.struct("MOON_WEBAUTHN_MAKE_CREDENTIAL_OPTIONS_4", {
  ...MAKE_OPTIONS_3,
  dwEnterpriseAttestation: DWORD,
  dwLargeBlobSupport: DWORD,
  bPreferResidentKey: BOOL,
});
const GET_OPTIONS_V4 = koffi.struct("MOON_WEBAUTHN_GET_ASSERTION_OPTIONS_4", {
  dwVersion: DWORD,
  dwTimeoutMilliseconds: DWORD,
  CredentialList: CREDENTIALS,
  Extensions: EXTENSIONS,
  dwAuthenticatorAttachment: DWORD,
  dwUserVerificationRequirement: DWORD,
  dwFlags: DWORD,
  pwszU2fAppId: WSTR,
  pbU2fAppId: PTR,
  pCancellationId: PTR,
  pAllowCredentialList: PTR,
});
// The results, as far as version 3 (attestation) and 1 (assertion) go:
// every Windows returns at least those fields.
const ATTESTATION_V3 = koffi.struct("MOON_WEBAUTHN_CREDENTIAL_ATTESTATION_3", {
  dwVersion: DWORD,
  pwszFormatType: PTR,
  cbAuthenticatorData: DWORD,
  pbAuthenticatorData: PTR,
  cbAttestation: DWORD,
  pbAttestation: PTR,
  dwAttestationDecodeType: DWORD,
  pvAttestationDecode: PTR,
  cbAttestationObject: DWORD,
  pbAttestationObject: PTR,
  cbCredentialId: DWORD,
  pbCredentialId: PTR,
  Extensions: EXTENSIONS,
  dwUsedTransport: DWORD,
});
const ASSERTION_V1 = koffi.struct("MOON_WEBAUTHN_ASSERTION_1", {
  dwVersion: DWORD,
  cbAuthenticatorData: DWORD,
  pbAuthenticatorData: PTR,
  cbSignature: DWORD,
  pbSignature: PTR,
  Credential: CREDENTIAL,
  cbUserId: DWORD,
  pbUserId: PTR,
});

export interface MakeCredentialCall {
  /** The window the system dialog belongs to (HWND). */
  hwnd: bigint;
  rpId: string;
  rpName: string;
  user: { id: Uint8Array; name: string; displayName: string };
  algorithms: number[];
  clientData: Uint8Array;
  timeout: number;
  exclude: CredentialDescriptor[];
  attachment: number;
  requireResidentKey: boolean;
  preferResidentKey: boolean;
  userVerification: number;
  attestation: number;
}

export interface MakeCredentialResult {
  credentialId: Uint8Array;
  attestationObject: Uint8Array;
  authenticatorData: Uint8Array;
  /** The transport used (a WEBAUTHN_CTAP_TRANSPORT_* bit), 0 if unknown. */
  transport: number;
}

export interface GetAssertionCall {
  hwnd: bigint;
  rpId: string;
  clientData: Uint8Array;
  timeout: number;
  allow: CredentialDescriptor[];
  userVerification: number;
}

export interface GetAssertionResult {
  credentialId: Uint8Array;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  userHandle: Uint8Array | null;
}

type Pointer = unknown;

/** Memory for one call, all freed together. */
class Arena {
  private readonly blocks: Pointer[] = [];

  alloc(type: TypeSpec, count = 1): Pointer {
    const ptr: Pointer = koffi.alloc(type, count);
    this.blocks.push(ptr);
    return ptr;
  }

  /** A struct filled with `value`. */
  struct(type: TypeSpec, value: object): Pointer {
    const ptr = this.alloc(type);
    koffi.encode(ptr, type, value);
    return ptr;
  }

  bytes(data: Uint8Array): Pointer {
    if (!data.length) return null;
    const ptr = this.alloc("uint8_t", data.length);
    koffi.encode(ptr, "uint8_t", Array.from(data), data.length);
    return ptr;
  }

  /** A WEBAUTHN_CREDENTIAL_LIST of the descriptors, or null for none. */
  credentialList(list: CredentialDescriptor[]): Pointer {
    if (!list.length) return null;
    const pointers = this.alloc(PTR, list.length);
    const each = list.map((c) =>
      this.struct(CREDENTIAL_EX, {
        dwVersion: 1,
        cbId: c.id.length,
        pbId: this.bytes(c.id),
        pwszCredentialType: "public-key",
        dwTransports: c.transports,
      }),
    );
    koffi.encode(pointers, PTR, each, each.length);
    return this.struct(CREDENTIAL_LIST, { cCredentials: list.length, ppCredentials: pointers });
  }

  free(): void {
    for (const ptr of this.blocks.splice(0)) koffi.free(ptr);
  }
}

const bytesAt = (ptr: Pointer, length: number): Uint8Array =>
  length && ptr
    ? Uint8Array.from(koffi.decode(ptr, "uint8_t", length) as ArrayLike<number>)
    : new Uint8Array();

/** A call in flight, which cancel() ends (the dialog closes). */
export interface Cancelable {
  cancel(): void;
}

export class WindowsWebAuthn {
  private readonly lib: LibraryHandle;
  private readonly fns: Record<string, KoffiFunction>;
  readonly apiVersion: number;

  private constructor(path: string) {
    this.lib = koffi.load(path);
    const fn = (name: string, ret: string, args: string[]) =>
      this.lib.func("__stdcall", name, ret, args);
    this.fns = {
      version: fn("WebAuthNGetApiVersionNumber", DWORD, []),
      available: fn("WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable", "int32_t", [PTR]),
      make: fn("WebAuthNAuthenticatorMakeCredential", "int32_t", [
        "intptr_t",
        PTR,
        PTR,
        PTR,
        PTR,
        PTR,
        PTR,
      ]),
      get: fn("WebAuthNAuthenticatorGetAssertion", "int32_t", ["intptr_t", WSTR, PTR, PTR, PTR]),
      freeAttestation: fn("WebAuthNFreeCredentialAttestation", "void", [PTR]),
      freeAssertion: fn("WebAuthNFreeAssertion", "void", [PTR]),
      cancellationId: fn("WebAuthNGetCancellationId", "int32_t", [PTR]),
      cancel: fn("WebAuthNCancelCurrentOperation", "int32_t", [PTR]),
      errorName: fn("WebAuthNGetErrorName", WSTR, ["int32_t"]),
    };
    this.apiVersion = this.fns.version() as number;
  }

  /** The system's WebAuthn API, or null where there is none (before Windows 10 1903). */
  static load(path = "webauthn.dll"): WindowsWebAuthn | null {
    try {
      const api = new WindowsWebAuthn(path);
      return api.apiVersion >= 1 ? api : null;
    } catch (err) {
      console.warn("[moon] no system WebAuthn API:", err);
      return null;
    }
  }

  /** Whether Windows Hello (or another built-in authenticator) is set up. */
  isPlatformAuthenticatorAvailable(): boolean {
    const out: Pointer = koffi.alloc(BOOL, 1);
    try {
      const hr = this.fns.available(out) as number;
      return hr === 0 && (koffi.decode(out, BOOL) as number) !== 0;
    } finally {
      koffi.free(out);
    }
  }

  private error(hr: number): WebAuthnError {
    const name = (this.fns.errorName(hr) as string | null) ?? "UnknownError";
    return errorFromWindows(name, hr);
  }

  /**
   * Runs a blocking API call on a worker thread, with a cancellation ID in
   * `arena` that `onCancelable` gets to end it early.
   */
  private run<T>(
    arena: Arena,
    call: (cancellationId: Pointer, out: Pointer, done: (hr: number) => void) => void,
    read: (result: Pointer) => T,
    free: (result: Pointer) => void,
    onCancelable?: (c: Cancelable) => void,
  ): Promise<T> {
    let cancellationId: Pointer = arena.alloc(GUID);
    if ((this.fns.cancellationId(cancellationId) as number) !== 0) cancellationId = null;
    const out = arena.alloc(PTR);
    koffi.encode(out, PTR, null);
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      onCancelable?.({
        cancel: () => {
          if (!finished && cancellationId) this.fns.cancel(cancellationId);
        },
      });
      call(cancellationId, out, (hr) => {
        finished = true;
        const result: Pointer = koffi.decode(out, PTR);
        try {
          if (hr !== 0 || !result) reject(this.error(hr));
          else resolve(read(result));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          if (result) free(result);
          arena.free();
        }
      });
    });
  }

  makeCredential(
    c: MakeCredentialCall,
    onCancelable?: (c: Cancelable) => void,
  ): Promise<MakeCredentialResult> {
    const arena = new Arena();
    try {
      const rp = arena.struct(RP, {
        dwVersion: 1,
        pwszId: c.rpId,
        pwszName: c.rpName || c.rpId,
        pwszIcon: null,
      });
      const user = arena.struct(USER, {
        dwVersion: 1,
        cbId: c.user.id.length,
        pbId: arena.bytes(c.user.id),
        pwszName: c.user.name,
        pwszIcon: null,
        pwszDisplayName: c.user.displayName,
      });
      const algorithms = arena.alloc(COSE_PARAMETER, c.algorithms.length);
      koffi.encode(
        algorithms,
        COSE_PARAMETER,
        c.algorithms.map((alg) => ({ dwVersion: 1, pwszCredentialType: "public-key", lAlg: alg })),
        c.algorithms.length,
      );
      const params = arena.struct(COSE_PARAMETERS, {
        cCredentialParameters: c.algorithms.length,
        pCredentialParameters: algorithms,
      });
      const clientData = arena.struct(CLIENT_DATA, {
        dwVersion: 1,
        cbClientDataJSON: c.clientData.length,
        pbClientDataJSON: arena.bytes(c.clientData),
        pwszHashAlgId: "SHA-256",
      });
      const exclude = arena.credentialList(c.exclude);
      const v4 = this.apiVersion >= 3;
      return this.run(
        arena,
        (cancellationId, out, done) => {
          const options = arena.struct(v4 ? MAKE_OPTIONS_V4 : MAKE_OPTIONS_V3, {
            dwVersion: v4 ? 4 : 3,
            dwTimeoutMilliseconds: c.timeout,
            CredentialList: { cCredentials: 0, pCredentials: null },
            Extensions: { cExtensions: 0, pExtensions: null },
            dwAuthenticatorAttachment: c.attachment,
            bRequireResidentKey: c.requireResidentKey ? 1 : 0,
            dwUserVerificationRequirement: c.userVerification,
            dwAttestationConveyancePreference: c.attestation,
            dwFlags: 0,
            pCancellationId: cancellationId,
            pExcludeCredentialList: exclude,
            ...(v4
              ? {
                  dwEnterpriseAttestation: 0,
                  dwLargeBlobSupport: 0,
                  bPreferResidentKey: c.preferResidentKey ? 1 : 0,
                }
              : {}),
          });
          this.fns.make.async(
            c.hwnd,
            rp,
            user,
            params,
            clientData,
            options,
            out,
            (err: unknown, hr: number) => done(err ? -1 : hr),
          );
        },
        (result) => {
          const a = koffi.decode(result, ATTESTATION_V3) as Record<string, unknown>;
          return {
            credentialId: bytesAt(a.pbCredentialId, a.cbCredentialId as number),
            attestationObject: bytesAt(a.pbAttestationObject, a.cbAttestationObject as number),
            authenticatorData: bytesAt(a.pbAuthenticatorData, a.cbAuthenticatorData as number),
            transport: (a.dwVersion as number) >= 3 ? (a.dwUsedTransport as number) : 0,
          };
        },
        (result) => void this.fns.freeAttestation(result),
        onCancelable,
      );
    } catch (err) {
      arena.free();
      throw err;
    }
  }

  getAssertion(
    c: GetAssertionCall,
    onCancelable?: (c: Cancelable) => void,
  ): Promise<GetAssertionResult> {
    const arena = new Arena();
    try {
      const clientData = arena.struct(CLIENT_DATA, {
        dwVersion: 1,
        cbClientDataJSON: c.clientData.length,
        pbClientDataJSON: arena.bytes(c.clientData),
        pwszHashAlgId: "SHA-256",
      });
      const allow = arena.credentialList(c.allow);
      return this.run(
        arena,
        (cancellationId, out, done) => {
          const options = arena.struct(GET_OPTIONS_V4, {
            dwVersion: 4,
            dwTimeoutMilliseconds: c.timeout,
            CredentialList: { cCredentials: 0, pCredentials: null },
            Extensions: { cExtensions: 0, pExtensions: null },
            dwAuthenticatorAttachment: 0,
            dwUserVerificationRequirement: c.userVerification,
            dwFlags: 0,
            pwszU2fAppId: null,
            pbU2fAppId: null,
            pCancellationId: cancellationId,
            pAllowCredentialList: allow,
          });
          this.fns.get.async(c.hwnd, c.rpId, clientData, options, out, (err: unknown, hr: number) =>
            done(err ? -1 : hr),
          );
        },
        (result) => {
          const a = koffi.decode(result, ASSERTION_V1) as Record<string, unknown>;
          const credential = a.Credential as Record<string, unknown>;
          const userId = a.cbUserId as number;
          return {
            credentialId: bytesAt(credential.pbId, credential.cbId as number),
            authenticatorData: bytesAt(a.pbAuthenticatorData, a.cbAuthenticatorData as number),
            signature: bytesAt(a.pbSignature, a.cbSignature as number),
            userHandle: userId ? bytesAt(a.pbUserId, userId) : null,
          };
        },
        (result) => void this.fns.freeAssertion(result),
        onCancelable,
      );
    } catch (err) {
      arena.free();
      throw err;
    }
  }
}
