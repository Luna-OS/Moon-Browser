import { createSocket, type Socket } from "node:dgram";
import { once } from "node:events";
import { request } from "node:https";
import { createServer, type AddressInfo, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DnsBridge, relay, servfail } from "./dns-bridge";

/** A query for `name` (type A), with an EDNS record as Chromium sends it. */
function query(name: string, id = 0x1234): Buffer {
  const header = Buffer.from([id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1]);
  const labels = name
    .split(".")
    .map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const question = Buffer.concat([...labels, Buffer.from([0, 0, 1, 0, 1])]);
  const edns = Buffer.from([0, 0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, question, edns]);
}

/** An answer: the query as a response, with one A record for 127.0.0.1 unless it's cut short. */
function answer(q: Buffer, truncated = false): Buffer {
  const out = Buffer.from(q);
  out[2] = 0x81 | (truncated ? 0x02 : 0);
  out[3] = 0x80;
  if (truncated) return out;
  out.writeUInt16BE(1, 6);
  return Buffer.concat([out, Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1])]);
}

let udp: Socket | null = null;
let tcp: Server | null = null;
let bridge: DnsBridge | null = null;
afterEach(() => {
  udp?.close();
  tcp?.close();
  bridge?.stop();
  udp = tcp = bridge = null;
});

/** A plain DNS server on 127.0.0.1: UDP (optionally cutting answers short) and TCP, same port. */
async function dnsServer(truncate: boolean): Promise<number> {
  tcp = createServer((socket) => {
    socket.on("data", (data: Buffer) => {
      const full = answer(data.subarray(2));
      const size = Buffer.alloc(2);
      size.writeUInt16BE(full.length);
      socket.end(Buffer.concat([size, full]));
    });
  });
  tcp.listen(0, "127.0.0.1");
  await once(tcp, "listening");
  const { port } = tcp.address() as AddressInfo;
  udp = createSocket("udp4");
  udp.on("message", (msg, from) => udp?.send(answer(msg, truncate), from.port, from.address));
  udp.bind(port, "127.0.0.1");
  await once(udp, "listening");
  return port;
}

/** A DNS-over-HTTPS request to the bridge, as Chromium makes it. */
function doh(template: string, body: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = request(
      template,
      {
        method: "POST",
        headers: { "content-type": "application/dns-message" },
        // The certificate itself is tested in local-certificate.test.ts.
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("the DNS bridge", () => {
  it("fails a query cleanly: its ID and question, nothing else", () => {
    const q = query("nowhere.example");
    const failed = servfail(q);
    expect(failed.readUInt16BE(0)).toBe(0x1234);
    expect(failed[2] & 0x80).toBe(0x80); // a response
    expect(failed[2] & 0x01).toBe(0x01); // recursion desired, as asked
    expect(failed[3] & 0x0f).toBe(2); // server failure
    expect(failed.readUInt16BE(4)).toBe(1);
    expect(failed.readUInt16BE(10)).toBe(0); // no EDNS record left behind
    expect(failed.length).toBe(q.length - 11);
  });

  it("hands queries on over UDP, and over TCP when the answer is cut short", async () => {
    let port = await dnsServer(false);
    const q = query("pihole.home");
    expect(await relay(q, { host: "127.0.0.1", port, name: "Home" })).toEqual(answer(q));
    udp?.close();
    tcp?.close();
    port = await dnsServer(true);
    expect(await relay(q, { host: "127.0.0.1", port, name: "Home" })).toEqual(answer(q));
  });

  it("answers DNS over HTTPS for Chromium, and notices when the server doesn't answer", async () => {
    const port = await dnsServer(false);
    bridge = new DnsBridge(200);
    const template = await bridge.start({ host: "127.0.0.1", port, name: "NRZ DNS (Netbird)" });
    expect(template).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/dns-query$/);
    const q = query("nas.home");
    expect(await doh(template, q)).toEqual(answer(q));
    expect(bridge.unreachable).toBeNull();

    // Switched to a server that doesn't answer: server failure, and its name for the error page.
    expect(await bridge.start({ host: "127.0.0.1", port: 9, name: "Gone" })).toBe(template);
    const failed = await doh(template, q);
    expect(failed[3] & 0x0f).toBe(2);
    expect(bridge.unreachable).toBe("Gone");

    bridge.stop();
    expect(bridge.unreachable).toBeNull();
  });
});
