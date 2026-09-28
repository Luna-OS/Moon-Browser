import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { connect, createServer } from "node:tls";
import { describe, expect, it } from "vitest";
import { makeLocalCertificate, pemFingerprint } from "./local-certificate";

describe("the DNS bridge's certificate", () => {
  it("is a valid self-signed certificate for 127.0.0.1 only", () => {
    const now = Date.UTC(2026, 8, 27, 12);
    const { cert, fingerprint } = makeLocalCertificate(now);
    const x509 = new X509Certificate(cert);
    expect(x509.subject).toBe("CN=Moon Browser DNS bridge");
    expect(x509.issuer).toBe(x509.subject);
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(x509.checkIP("10.0.0.1")).toBeUndefined();
    expect(x509.checkHost("localhost")).toBeUndefined();
    expect(new Date(x509.validFrom).getTime()).toBe(now - 3_600_000);
    expect(new Date(x509.validTo).getTime()).toBe(now + 30 * 86_400_000);
    // The fingerprint Moon Browser trusts it by.
    expect(pemFingerprint(cert)).toBe(fingerprint);
    expect(Buffer.from(x509.fingerprint256.replace(/:/g, ""), "hex").toString("base64")).toBe(
      fingerprint,
    );
    // A new one each time.
    expect(makeLocalCertificate().fingerprint).not.toBe(fingerprint);
  });

  it("works for TLS to 127.0.0.1", async () => {
    const { cert, key } = makeLocalCertificate();
    const server = createServer({ cert, key }, (socket) => socket.end("moon"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const socket = connect({ host: "127.0.0.1", port, ca: cert });
    await once(socket, "secureConnect");
    expect(socket.authorized).toBe(true);
    const [data] = (await once(socket, "data")) as [Buffer];
    expect(data.toString()).toBe("moon");
    socket.destroy();
    server.close();
  });
});
