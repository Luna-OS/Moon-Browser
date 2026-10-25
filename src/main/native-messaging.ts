/**
 * chrome.runtime.connectNative and sendNativeMessage: extensions talking to
 * apps on the computer (Claude's extension to Claude Desktop and Claude
 * Code, password managers to their desktop apps).
 *
 * Luma finds the apps where Chrome looks for them — the hosts the
 * apps registered for Chrome — so nothing has to be set up twice. A host
 * runs only for the extensions its manifest names in "allowed_origins", and
 * only for extensions that declare "nativeMessaging". Messages are JSON,
 * each preceded by its length (4 bytes, native byte order), as in Chrome.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Host names as Chrome allows them: "com.example.app". */
export const HOST_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** The most a host may send in one message (as in Chrome). */
const MAX_FROM_HOST = 1024 * 1024;
/** The most an extension may send in one message. */
const MAX_TO_HOST = 64 * 1024 * 1024;

export const HOST_NOT_FOUND = "Specified native messaging host not found.";
export const HOST_FORBIDDEN = "Access to the specified native messaging host is forbidden.";
export const HOST_EXITED = "Native host has exited.";

interface HostManifest {
  name: string;
  path: string;
  allowedOrigins: string[];
}

/** Checks a host's manifest file; null if it isn't one Chrome would run. */
export function parseHostManifest(raw: unknown, manifestPath: string): HostManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.name !== "string" || typeof m.path !== "string" || m.type !== "stdio") return null;
  const origins = Array.isArray(m.allowed_origins)
    ? m.allowed_origins.filter((o): o is string => typeof o === "string")
    : [];
  // On Windows a relative path is relative to the manifest; elsewhere it must be absolute.
  const path = isAbsolute(m.path)
    ? m.path
    : process.platform === "win32"
      ? resolve(dirname(manifestPath), m.path)
      : null;
  if (!path) return null;
  return { name: m.name, path, allowedOrigins: origins };
}

/** Splits what a host wrote into its messages; the rest waits for more bytes. */
export function readMessages(buffer: Buffer): {
  messages: unknown[];
  rest: Buffer;
  error?: string;
} {
  const messages: unknown[] = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset);
    if (length > MAX_FROM_HOST) return { messages, rest: Buffer.alloc(0), error: "too large" };
    if (buffer.length - offset - 4 < length) break;
    const text = buffer.toString("utf8", offset + 4, offset + 4 + length);
    offset += 4 + length;
    try {
      messages.push(JSON.parse(text));
    } catch {
      return { messages, rest: Buffer.alloc(0), error: "not JSON" };
    }
  }
  return { messages, rest: buffer.subarray(offset) };
}

/** One message as a host reads it. */
export function frameMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message) ?? "null", "utf8");
  if (body.length > MAX_TO_HOST) throw new Error("Message exceeds maximum allowed size.");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

function regQuery(key: string): Promise<string | null> {
  return new Promise((done) => {
    // By its full path: a bare "reg" could be found in the current folder first.
    const reg = join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
    execFile(reg, ["query", key, "/ve"], { windowsHide: true }, (err, stdout) => {
      if (err) return done(null);
      const m = /REG_(?:EXPAND_)?SZ\s+(.+)\s*$/m.exec(stdout);
      done(m ? m[1].trim() : null);
    });
  });
}

/** Where Chrome (and Chromium) look for a host's manifest. */
async function manifestPaths(name: string): Promise<string[]> {
  if (process.platform === "win32") {
    const keys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${name}`,
      `HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\${name}`,
      `HKLM\\Software\\WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\${name}`,
      `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${name}`,
    ];
    const found = await Promise.all(keys.map(regQuery));
    return found.filter((p): p is string => !!p);
  }
  const home = homedir();
  const file = `${name}.json`;
  if (process.platform === "darwin") {
    return [
      join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts", file),
      join(home, "Library/Application Support/Chromium/NativeMessagingHosts", file),
      join("/Library/Google/Chrome/NativeMessagingHosts", file),
    ];
  }
  const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return [
    join(config, "google-chrome/NativeMessagingHosts", file),
    join(config, "chromium/NativeMessagingHosts", file),
    join("/etc/opt/chrome/native-messaging-hosts", file),
    join("/etc/chromium/native-messaging-hosts", file),
  ];
}

/** The host `name` if it exists and lets `extensionId` talk to it. */
export async function findHost(name: string, extensionId: string): Promise<HostManifest> {
  if (!HOST_NAME.test(name)) throw new Error("Invalid native messaging host name specified.");
  for (const path of await manifestPaths(name)) {
    let raw: unknown;
    try {
      raw = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    const host = parseHostManifest(raw, path);
    if (!host || host.name !== name) continue;
    if (!host.allowedOrigins.includes(`chrome-extension://${extensionId}/`))
      throw new Error(HOST_FORBIDDEN);
    return host;
  }
  throw new Error(HOST_NOT_FOUND);
}

/** A running host, as a port of chrome.runtime.connectNative sees it. */
export class NativePort {
  private child: ChildProcess | null = null;
  private pending: Buffer = Buffer.alloc(0);
  private closed = false;
  private readonly queued: unknown[] = [];

  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly onClose: (error?: string) => void,
  ) {}

  start(host: HostManifest, extensionId: string): void {
    const args = [`chrome-extension://${extensionId}/`];
    if (process.platform === "win32") args.push("--parent-window=0");
    // .bat and .cmd hosts run through cmd, as Chrome runs them.
    const script = process.platform === "win32" && /\.(bat|cmd)$/i.test(host.path);
    const child = script
      ? spawn(
          process.env.ComSpec || "cmd.exe",
          // With /s, cmd drops the outermost quotes: the whole line is
          // quoted once more so the path's own quotes (spaces!) stay.
          ["/d", "/s", "/c", `""${host.path}" ${args.join(" ")}"`],
          {
            cwd: dirname(host.path),
            windowsHide: true,
            windowsVerbatimArguments: true,
            stdio: ["pipe", "pipe", "ignore"],
          },
        )
      : spawn(host.path, args, {
          cwd: dirname(host.path),
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
        });
    this.child = child;
    for (const message of this.queued.splice(0)) child.stdin?.write(frameMessage(message));
    child.stdout?.on("data", (chunk: Buffer) => {
      const { messages, rest, error } = readMessages(Buffer.concat([this.pending, chunk]));
      this.pending = rest;
      for (const m of messages) if (!this.closed) this.onMessage(m);
      if (error) this.close("Error when communicating with the native messaging host.");
    });
    child.stdin?.on("error", () => undefined);
    child.on("error", () => this.close("Failed to start native messaging host."));
    child.on("exit", () => this.close(HOST_EXITED));
  }

  post(message: unknown): void {
    if (this.closed) return;
    // Before the host runs, messages wait for it.
    if (!this.child) this.queued.push(message);
    else this.child.stdin?.write(frameMessage(message));
  }

  /** Ends the host; `error` is what the extension's onDisconnect reports. */
  close(error?: string): void {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      child.stdin?.end();
      // Give it a moment to leave on its own, as Chrome does.
      setTimeout(() => {
        if (child.exitCode !== null) return;
        // On Windows a .bat host runs under cmd: end the whole tree.
        if (process.platform === "win32" && child.pid)
          execFile(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { windowsHide: true },
            () => undefined,
          );
        else child.kill();
      }, 2000).unref();
    }
    this.onClose(error);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
