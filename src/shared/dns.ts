/**
 * Which DNS Moon Browser uses: Chromium's automatic DNS over HTTPS, one of
 * a few encrypted providers, the network's own, or a DNS server of the
 * user's, named by them — a DNS-over-HTTPS address, or a plain server by
 * IP address and port (a Pi-hole or Unbound at home, one inside a VPN such
 * as Netbird or Tailscale). Chromium itself only talks DNS over HTTPS to a
 * server of its choosing; plain servers are reached through Moon Browser's
 * local bridge (main/dns-bridge.ts).
 */

export type SecureDnsChoice = "automatic" | "quad9" | "cloudflare" | "mullvad" | "off";

/** The setting: a built-in choice, or `custom:<id>` for one of the user's servers. */
export type DnsSetting = SecureDnsChoice | `custom:${string}`;

/** A DNS server the user added and named. */
export interface CustomDnsServer {
  id: string;
  name: string;
  /** As typed, cleaned up: `100.64.0.53:5335`, `[fd00::53]:53` or `https://…/dns-query`. */
  address: string;
}

export const SECURE_DNS: Record<
  Exclude<SecureDnsChoice, "automatic" | "off">,
  { name: string; template: string }
> = {
  quad9: {
    name: "Quad9 (blocks known malware domains)",
    template: "https://dns.quad9.net/dns-query",
  },
  mullvad: { name: "Mullvad", template: "https://dns.mullvad.net/dns-query" },
  cloudflare: { name: "Cloudflare", template: "https://cloudflare-dns.com/dns-query" },
};

export const MAX_CUSTOM_DNS = 20;

export type DnsAddress =
  /** DNS over HTTPS: Chromium uses it directly. */
  | { kind: "https"; template: string }
  /** A plain DNS server (UDP and TCP), by IP address. */
  | { kind: "plain"; host: string; port: number };

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIpv6(text: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(text) || !text.includes(":")) return false;
  try {
    return new URL(`http://[${text}]/`).hostname !== "";
  } catch {
    return false;
  }
}

function port(text: string | undefined): number | null {
  if (text === undefined) return 53;
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * What the user typed as a DNS server: an IP address, with a port if it
 * isn't 53 (`100.64.0.53:5335`, `[fd00::53]:5335`), or a DNS-over-HTTPS
 * address (`https://dns.example/dns-query`). Null if it's neither.
 */
export function parseDnsAddress(text: string): DnsAddress | null {
  const t = text.trim();
  if (/^https:\/\//i.test(t)) {
    try {
      const url = new URL(t.replace(/\{\?dns\}$/, ""));
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      return { kind: "https", template: t };
    } catch {
      return null;
    }
  }
  const v4 = /^([\d.]+)(?::(\d+))?$/.exec(t);
  if (v4 && IPV4.test(v4[1])) {
    const p = port(v4[2]);
    return p === null ? null : { kind: "plain", host: v4[1], port: p };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(t);
  if (bracketed && isIpv6(bracketed[1])) {
    const p = port(bracketed[2]);
    return p === null ? null : { kind: "plain", host: bracketed[1].toLowerCase(), port: p };
  }
  if (isIpv6(t)) return { kind: "plain", host: t.toLowerCase(), port: 53 };
  return null;
}

/** The address written the one way: host and port, or the DoH address. */
export function formatDnsAddress(address: DnsAddress): string {
  if (address.kind === "https") return address.template;
  const host = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `${host}:${address.port}`;
}

/** Why a typed address won't do, in words for the form; null if it will. */
export function dnsAddressProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Enter the server's address.";
  if (parseDnsAddress(t)) return null;
  if (/^http:\/\//i.test(t)) return "DNS over HTTPS needs an https:// address.";
  if (/^[\w.-]+(:\d+)?$/.test(t) && /[a-z]/i.test(t))
    return "Use the server's IP address — a name would need DNS to be found.";
  return "That's not an IP address (like 192.168.1.2:5335) or an https:// address.";
}

/** The user's servers from stored or received data: valid ones only, named, no more than 20. */
export function sanitizeCustomDns(raw: unknown): CustomDnsServer[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomDnsServer[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_DNS) break;
    if (!item || typeof item !== "object") continue;
    const { id, name, address } = item as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) continue;
    if (out.some((s) => s.id === id)) continue;
    if (typeof name !== "string" || typeof address !== "string") continue;
    const parsed = address.length <= 2048 ? parseDnsAddress(address) : null;
    const cleanName = name.trim().slice(0, 64);
    if (!parsed || !cleanName) continue;
    out.push({ id, name: cleanName, address: formatDnsAddress(parsed) });
  }
  return out;
}

/** The setting, if it names a built-in choice or one of the user's servers; else the fallback. */
export function sanitizeDnsSetting(
  raw: unknown,
  servers: readonly CustomDnsServer[],
  fallback: DnsSetting,
): DnsSetting {
  if (typeof raw !== "string") return fallback;
  if (["automatic", "quad9", "cloudflare", "mullvad", "off"].includes(raw))
    return raw as SecureDnsChoice;
  const id = /^custom:(.+)$/.exec(raw)?.[1];
  return id && servers.some((s) => s.id === id) ? (raw as DnsSetting) : fallback;
}

/** The user's server the setting points at, if it does. */
export function chosenCustomDns(
  setting: DnsSetting,
  servers: readonly CustomDnsServer[],
): (CustomDnsServer & { parsed: DnsAddress }) | null {
  const id = setting.startsWith("custom:") ? setting.slice("custom:".length) : null;
  const server = id ? servers.find((s) => s.id === id) : undefined;
  const parsed = server ? parseDnsAddress(server.address) : null;
  return server && parsed ? { ...server, parsed } : null;
}

/**
 * Arguments for Electron's app.configureHostResolver. `bridge` is the local
 * DNS-over-HTTPS address that reaches the chosen plain server (null if
 * there is none).
 */
export function hostResolverConfig(
  setting: DnsSetting,
  servers: readonly CustomDnsServer[] = [],
  bridge: string | null = null,
): {
  enableBuiltInResolver: boolean;
  secureDnsMode: "off" | "automatic" | "secure";
  secureDnsServers: string[];
} {
  const secure = (template: string) => ({
    enableBuiltInResolver: true,
    secureDnsMode: "secure" as const,
    secureDnsServers: [template],
  });
  if (setting === "off")
    return { enableBuiltInResolver: true, secureDnsMode: "off", secureDnsServers: [] };
  if (setting === "quad9" || setting === "mullvad" || setting === "cloudflare")
    return secure(SECURE_DNS[setting].template);
  const custom = chosenCustomDns(setting, servers);
  if (custom?.parsed.kind === "https") return secure(custom.parsed.template);
  if (custom?.parsed.kind === "plain" && bridge) return secure(bridge);
  return { enableBuiltInResolver: true, secureDnsMode: "automatic", secureDnsServers: [] };
}
