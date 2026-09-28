/**
 * The way to a plain DNS server of the user's (an IP address and port: a
 * Pi-hole or Unbound at home, a DNS server inside Netbird or Tailscale).
 * Chromium only looks names up itself from the system's DNS or over DNS
 * over HTTPS, so Moon Browser runs a small DNS-over-HTTPS server on
 * 127.0.0.1 that hands each query on to that server as it is — over UDP,
 * and over TCP for answers too long for UDP — and hands back the answer.
 *
 * Its certificate is made at start (local-certificate.ts) and every
 * session trusts it for 127.0.0.1 only, by its fingerprint; every other
 * certificate is checked by Chromium as always.
 */
import type { Session } from "electron";
import { createSocket } from "node:dgram";
import { createServer, type Server } from "node:https";
import { connect } from "node:net";
import { makeLocalCertificate, pemFingerprint, type LocalCertificate } from "./local-certificate";

export interface DnsTarget {
  host: string;
  port: number;
  /** The name the user gave it, for the error page. */
  name: string;
}

const MAX_MESSAGE = 65_535;
const UDP_TIMEOUT = 2_000;
const TCP_TIMEOUT = 4_000;

/** Where a message's first question ends (its name, type and class); null if it's garbled. */
function questionEnd(message: Buffer): number | null {
  let i = 12;
  while (i < message.length) {
    const label = message[i];
    if (label === 0) return i + 5 <= message.length ? i + 5 : null;
    if (label & 0xc0) return null; // no pointers in a query's question
    i += label + 1;
  }
  return null;
}

/** "Server failure" for a query: its ID and question, nothing else. */
export function servfail(query: Buffer): Buffer {
  const end = query.readUInt16BE(4) === 1 ? questionEnd(query) : null;
  const out = Buffer.from(query.subarray(0, end ?? 12));
  out[2] = 0x80 | (query[2] & 0x79); // a response; same opcode and RD
  out[3] = 0x80 | 0x02; // RA; RCODE 2, server failure
  out.writeUInt16BE(end ? 1 : 0, 4);
  out.writeUInt16BE(0, 6);
  out.writeUInt16BE(0, 8);
  out.writeUInt16BE(0, 10);
  return out;
}

/** Asks over UDP; null if no answer came in time. */
function askUdp(query: Buffer, target: DnsTarget, timeout: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = createSocket(target.host.includes(":") ? "udp6" : "udp4");
    const done = (answer: Buffer | null) => {
      clearTimeout(timer);
      socket.close();
      resolve(answer);
    };
    const timer = setTimeout(() => done(null), timeout);
    socket.on("error", () => done(null));
    socket.on("message", (answer, from) => {
      // Only the server's answer to this query: a response with its ID.
      if (
        from.port === target.port &&
        answer.length >= 12 &&
        answer[2] & 0x80 &&
        answer.readUInt16BE(0) === query.readUInt16BE(0)
      )
        done(answer);
    });
    socket.send(query, target.port, target.host, (err) => {
      if (err) done(null);
    });
  });
}

/** Asks over TCP (two bytes of length, then the message); null if that fails. */
function askTcp(query: Buffer, target: DnsTarget): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const socket = connect({ host: target.host, port: target.port });
    let received = Buffer.alloc(0);
    const done = (answer: Buffer | null) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(TCP_TIMEOUT, () => done(null));
    socket.on("error", () => done(null));
    socket.on("connect", () => {
      const size = Buffer.alloc(2);
      size.writeUInt16BE(query.length);
      socket.write(Buffer.concat([size, query]));
    });
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 2 && received.length >= 2 + received.readUInt16BE(0))
        done(received.subarray(2, 2 + received.readUInt16BE(0)));
    });
    socket.on("end", () => done(null));
  });
}

/** The server's answer to a query: UDP twice, then TCP if the answer was cut short. */
export async function relay(
  query: Buffer,
  target: DnsTarget,
  udpTimeout = UDP_TIMEOUT,
): Promise<Buffer | null> {
  const answer =
    (await askUdp(query, target, udpTimeout)) ?? (await askUdp(query, target, udpTimeout));
  if (!answer) return null;
  // TC: truncated, the whole answer only comes over TCP.
  return answer[2] & 0x02 ? ((await askTcp(query, target)) ?? answer) : answer;
}

export class DnsBridge {
  private server: Server | null = null;
  private template: string | null = null;
  private target: DnsTarget | null = null;
  private identity: LocalCertificate | null = null;
  private readonly sessions = new Set<Session>();
  /** The name of the user's server if it didn't answer the last query, else null. */
  unreachable: string | null = null;

  constructor(private readonly udpTimeout = UDP_TIMEOUT) {}

  /** The certificate, made on first use. */
  private get certificate(): LocalCertificate {
    this.identity ??= makeLocalCertificate();
    return this.identity;
  }

  /** Starts handing queries on to `target` (or switches to it); the bridge's DoH address. */
  async start(target: DnsTarget): Promise<string> {
    this.target = target;
    this.unreachable = null;
    if (this.server && this.template) return this.template;
    const { cert, key } = this.certificate;
    const server = createServer({ cert, key }, (req, res) => {
      const url = new URL(req.url ?? "/", "https://127.0.0.1");
      if (url.pathname !== "/dns-query" || (req.method !== "POST" && req.method !== "GET")) {
        res.writeHead(404).end();
        return;
      }
      const reply = (query: Buffer) =>
        void this.answer(query).then((answer) =>
          res
            .writeHead(200, {
              "content-type": "application/dns-message",
              "cache-control": "no-store",
            })
            .end(answer),
        );
      if (req.method === "GET") {
        const query = Buffer.from(url.searchParams.get("dns") ?? "", "base64url");
        if (query.length < 12) res.writeHead(400).end();
        else reply(query);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_MESSAGE) req.destroy();
        else chunks.push(chunk);
      });
      req.on("end", () => {
        const query = Buffer.concat(chunks);
        if (query.length < 12) res.writeHead(400).end();
        else reply(query);
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    // Stopped while it was starting.
    if (this.server !== server) throw new Error("The DNS bridge was stopped");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The DNS bridge has no port");
    this.template = `https://127.0.0.1:${address.port}/dns-query`;
    for (const ses of this.sessions) this.trust(ses);
    return this.template;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.template = null;
    this.target = null;
    this.unreachable = null;
    for (const ses of this.sessions) this.trust(ses);
  }

  /** Lets a session reach the bridge (while it runs). Every session needs it: each looks names up. */
  watch(ses: Session): void {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    this.trust(ses);
  }

  /** Forgets what the sessions looked up before, after the DNS server changed. */
  clearCaches(): void {
    for (const ses of this.sessions) void ses.clearHostResolverCache().catch(() => undefined);
  }

  private trust(ses: Session): void {
    if (!this.server) {
      ses.setCertificateVerifyProc(null);
      return;
    }
    const fingerprint = this.certificate.fingerprint;
    ses.setCertificateVerifyProc((request, callback) => {
      const bridge =
        request.hostname === "127.0.0.1" &&
        pemFingerprint(request.certificate.data) === fingerprint;
      // 0: trusted; -3: Chromium's own verdict, as for every other certificate.
      callback(bridge ? 0 : -3);
    });
  }

  private async answer(query: Buffer): Promise<Buffer> {
    const target = this.target;
    if (!target) return servfail(query);
    // Slow already counts: Chromium may give up on a lookup before the bridge does.
    const slow = setTimeout(() => {
      if (this.target === target) this.unreachable = target.name;
    }, this.udpTimeout);
    const answer = await relay(query, target, this.udpTimeout);
    clearTimeout(slow);
    if (this.target === target) this.unreachable = answer ? null : target.name;
    return answer ?? servfail(query);
  }
}
