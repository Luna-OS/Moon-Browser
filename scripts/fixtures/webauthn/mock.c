/*
 * A stand-in for Windows' webauthn.dll, built from Microsoft's own
 * webauthn.h, for src/main/webauthn-win.test.ts: it describes every field it
 * received as text, so the test can check that Moon Browser lays out the
 * structures exactly as Windows expects them.
 *
 *   cc -shared -fPIC -I. -o libwebauthn-mock.so mock.c
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uchar.h>

typedef uint16_t WORD;
typedef uint32_t DWORD;
typedef int32_t BOOL;
typedef int32_t LONG;
typedef int32_t HRESULT;
typedef uint8_t BYTE, *PBYTE;
typedef void *PVOID;
typedef void *HWND;
typedef char16_t WCHAR;
typedef const WCHAR *PCWSTR, *LPCWSTR;
typedef struct { uint32_t Data1; uint16_t Data2; uint16_t Data3; uint8_t Data4[8]; } GUID;
#define WINAPI
#define _In_
#define _In_opt_
#define _Out_
#define _Inout_
#define _Outptr_result_maybenull_
#define _Field_size_(x)
#define _Field_size_bytes_(x)
#define _Field_size_opt_(x)
#define _Field_size_bytes_opt_(x)
#define _In_reads_bytes_(x)

#include "webauthn.h"

static char text[8192];
static size_t used;
static DWORD api_version = 4;

static void put(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
#include <stdarg.h>
static void put(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  used += vsnprintf(text + used, sizeof(text) - used, fmt, ap);
  va_end(ap);
}
static void put_wstr(PCWSTR s) {
  if (!s) { put("(null)"); return; }
  for (; *s; s++) put("%c", (char)*s);
}
static void put_hex(const BYTE *p, DWORD n) {
  for (DWORD i = 0; i < n; i++) put("%02x", p[i]);
}
static PBYTE copy(const void *p, size_t n) {
  PBYTE out = malloc(n ? n : 1);
  memcpy(out, p, n);
  return out;
}
static void put_list(PWEBAUTHN_CREDENTIAL_LIST list) {
  if (!list) { put("none"); return; }
  for (DWORD i = 0; i < list->cCredentials; i++) {
    PWEBAUTHN_CREDENTIAL_EX c = list->ppCredentials[i];
    put("%sv%u:", i ? "," : "", c->dwVersion);
    put_hex(c->pbId, c->cbId);
    put("/");
    put_wstr(c->pwszCredentialType);
    put("/%u", c->dwTransports);
  }
}

void mock_set_api_version(DWORD v) { api_version = v; }
DWORD WebAuthNGetApiVersionNumber(void) { return api_version; }

HRESULT WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(BOOL *available) {
  *available = 1;
  return 0;
}

HRESULT WebAuthNGetCancellationId(GUID *id) {
  memset(id, 0, sizeof(*id));
  id->Data1 = 0x6d6f6f6e;
  return 0;
}

HRESULT WebAuthNCancelCurrentOperation(const GUID *id) { return id && id->Data1 == 0x6d6f6f6e ? 0 : -1; }

PCWSTR WebAuthNGetErrorName(HRESULT hr) {
  return hr == (HRESULT)0x800704C7 ? u"NotAllowedError" : hr == (HRESULT)0x8009000F ? u"InvalidStateError" : u"UnknownError";
}

HRESULT WebAuthNAuthenticatorMakeCredential(
    HWND hwnd, PCWEBAUTHN_RP_ENTITY_INFORMATION rp, PCWEBAUTHN_USER_ENTITY_INFORMATION user,
    PCWEBAUTHN_COSE_CREDENTIAL_PARAMETERS params, PCWEBAUTHN_CLIENT_DATA cd,
    PCWEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS o, PWEBAUTHN_CREDENTIAL_ATTESTATION *out) {
  *out = NULL;
  used = 0;
  put("hwnd=%lx;rp=v%u:", (unsigned long)(uintptr_t)hwnd, rp->dwVersion);
  put_wstr(rp->pwszId); put("|"); put_wstr(rp->pwszName); put("|"); put_wstr(rp->pwszIcon);
  put(";user=v%u:", user->dwVersion);
  put_hex(user->pbId, user->cbId); put("|"); put_wstr(user->pwszName); put("|");
  put_wstr(user->pwszIcon); put("|"); put_wstr(user->pwszDisplayName);
  put(";algs=");
  for (DWORD i = 0; i < params->cCredentialParameters; i++) {
    put("%sv%u:", i ? "," : "", params->pCredentialParameters[i].dwVersion);
    put_wstr(params->pCredentialParameters[i].pwszCredentialType);
    put("/%d", params->pCredentialParameters[i].lAlg);
  }
  put(";cd=v%u:%.*s|", cd->dwVersion, (int)cd->cbClientDataJSON, (const char *)cd->pbClientDataJSON);
  put_wstr(cd->pwszHashAlgId);
  put(";opt=v%u,t=%u,cl=%u,ext=%u,att=%u,rrk=%d,uv=%u,ac=%u,flags=%u,cancel=%s,ex=",
      o->dwVersion, o->dwTimeoutMilliseconds, o->CredentialList.cCredentials, o->Extensions.cExtensions,
      o->dwAuthenticatorAttachment, o->bRequireResidentKey, o->dwUserVerificationRequirement,
      o->dwAttestationConveyancePreference, o->dwFlags,
      o->pCancellationId && o->pCancellationId->Data1 == 0x6d6f6f6e ? "yes" : "no");
  put_list(o->pExcludeCredentialList);
  if (o->dwVersion >= 4)
    put(",ea=%u,lb=%u,prk=%d", o->dwEnterpriseAttestation, o->dwLargeBlobSupport, o->bPreferResidentKey);
  if (user->pwszName && user->pwszName[0] == u'!') return (HRESULT)0x800704C7;

  PWEBAUTHN_CREDENTIAL_ATTESTATION a = calloc(1, sizeof(*a));
  a->dwVersion = 3;
  a->pwszFormatType = u"none";
  static const BYTE auth[] = {0xa1, 0xa2, 0xa3};
  static const BYTE id[] = {0x01, 0x02, 0x03, 0x04};
  a->cbAuthenticatorData = sizeof(auth);
  a->pbAuthenticatorData = copy(auth, sizeof(auth));
  a->cbAttestationObject = used;
  a->pbAttestationObject = copy(text, used);
  a->cbCredentialId = sizeof(id);
  a->pbCredentialId = copy(id, sizeof(id));
  a->dwUsedTransport = WEBAUTHN_CTAP_TRANSPORT_INTERNAL;
  *out = a;
  return 0;
}

void WebAuthNFreeCredentialAttestation(PWEBAUTHN_CREDENTIAL_ATTESTATION a) {
  if (!a) return;
  free(a->pbAuthenticatorData);
  free(a->pbAttestationObject);
  free(a->pbCredentialId);
  free(a);
}

HRESULT WebAuthNAuthenticatorGetAssertion(HWND hwnd, LPCWSTR rp_id, PCWEBAUTHN_CLIENT_DATA cd,
                                           PCWEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS o,
                                           PWEBAUTHN_ASSERTION *out) {
  *out = NULL;
  used = 0;
  put("hwnd=%lx;rp=", (unsigned long)(uintptr_t)hwnd);
  put_wstr(rp_id);
  put(";cd=v%u:%.*s|", cd->dwVersion, (int)cd->cbClientDataJSON, (const char *)cd->pbClientDataJSON);
  put_wstr(cd->pwszHashAlgId);
  put(";opt=v%u,t=%u,cl=%u,ext=%u,att=%u,uv=%u,flags=%u,appid=%s,cancel=%s,allow=", o->dwVersion,
      o->dwTimeoutMilliseconds, o->CredentialList.cCredentials, o->Extensions.cExtensions,
      o->dwAuthenticatorAttachment, o->dwUserVerificationRequirement, o->dwFlags,
      o->pwszU2fAppId ? "set" : "none",
      o->pCancellationId && o->pCancellationId->Data1 == 0x6d6f6f6e ? "yes" : "no");
  put_list(o->pAllowCredentialList);

  PWEBAUTHN_ASSERTION a = calloc(1, sizeof(*a));
  a->dwVersion = 1;
  static const BYTE auth[] = {0xb1, 0xb2};
  static const BYTE id[] = {0x09, 0x08};
  static const BYTE uid[] = {0x55};
  a->cbAuthenticatorData = sizeof(auth);
  a->pbAuthenticatorData = copy(auth, sizeof(auth));
  a->cbSignature = used;
  a->pbSignature = copy(text, used);
  a->Credential.dwVersion = 1;
  a->Credential.cbId = sizeof(id);
  a->Credential.pbId = copy(id, sizeof(id));
  a->Credential.pwszCredentialType = u"public-key";
  a->cbUserId = sizeof(uid);
  a->pbUserId = copy(uid, sizeof(uid));
  *out = a;
  return 0;
}

void WebAuthNFreeAssertion(PWEBAUTHN_ASSERTION a) {
  if (!a) return;
  free(a->pbAuthenticatorData);
  free(a->pbSignature);
  free(a->Credential.pbId);
  free(a->pbUserId);
  free(a);
}
