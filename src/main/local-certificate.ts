/**
 * A certificate for 127.0.0.1, made at start: for Moon Browser's own
 * DNS-over-HTTPS bridge (dns-bridge.ts), which Chromium only talks to over
 * HTTPS. Node can make keys but not certificates, so this writes the few
 * DER structures of a self-signed X.509 certificate itself. Nobody else
 * trusts it; Moon Browser trusts it for 127.0.0.1 only, by its fingerprint.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export interface LocalCertificate {
  cert: string;
  key: string;
  /** SHA-256 of the certificate (DER), base64. */
  fingerprint: string;
}

const length = (n: number): Buffer =>
  n < 0x80
    ? Buffer.from([n])
    : n < 0x100
      ? Buffer.from([0x81, n])
      : Buffer.from([0x82, n >> 8, n & 0xff]);
const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const sequence = (...parts: Buffer[]) => tlv(0x30, ...parts);
const integer = (bytes: Buffer) =>
  // Positive: a leading zero if the top bit is set.
  tlv(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const value of rest) {
    const bytes = [];
    let v = value;
    do {
      bytes.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v);
    for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
};
const utcTime = (date: Date) =>
  tlv(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
const commonName = (name: string) =>
  sequence(tlv(0x31, sequence(oid("2.5.4.3"), tlv(0x0c, Buffer.from(name)))));

/** A new key and a certificate for 127.0.0.1, valid from an hour ago for 30 days. */
export function makeLocalCertificate(now = Date.now()): LocalCertificate {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdsaWithSha256 = sequence(oid("1.2.840.10045.4.3.2"));
  const name = commonName("Moon Browser DNS bridge");
  // subjectAltName: IP address 127.0.0.1, the only name it is for.
  const altName = sequence(
    oid("2.5.29.17"),
    tlv(0x04, sequence(tlv(0x87, Buffer.from([127, 0, 0, 1])))),
  );
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))), // version 3
    integer(randomBytes(16)),
    ecdsaWithSha256,
    name,
    sequence(utcTime(new Date(now - 3_600_000)), utcTime(new Date(now + 30 * 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, sequence(altName)),
  );
  const signature = sign("sha256", tbs, privateKey);
  const der = sequence(
    tbs,
    ecdsaWithSha256,
    tlv(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    fingerprint: createHash("sha256").update(der).digest("base64"),
  };
}

/** The fingerprint of a PEM certificate, as makeLocalCertificate gives it. */
export function pemFingerprint(pem: string): string {
  const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64");
  return createHash("sha256").update(der).digest("base64");
}
