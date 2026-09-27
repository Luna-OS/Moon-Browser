/**
 * chrome.proxy settings (Chrome's ProxyConfig) in Electron's terms
 * (session.setProxy). Anything invalid throws, with the reason, as Chrome
 * rejects it.
 */

export interface ElectronProxy {
  mode: "direct" | "auto_detect" | "pac_script" | "fixed_servers" | "system";
  proxyRules?: string;
  proxyBypassRules?: string;
  pacScript?: string;
}

const SCHEMES = ["http", "https", "quic", "socks4", "socks5"] as const;
const DEFAULT_PORT: Record<string, number> = {
  http: 80,
  https: 443,
  quic: 443,
  socks4: 1080,
  socks5: 1080,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function server(v: unknown, what: string): string {
  if (!isObj(v) || typeof v.host !== "string" || !/^(\[[0-9a-f:.]+\]|[\w.-]+)$/i.test(v.host))
    throw new Error(`${what} needs a valid host`);
  const scheme = v.scheme === undefined ? "http" : v.scheme;
  if (typeof scheme !== "string" || !(SCHEMES as readonly string[]).includes(scheme))
    throw new Error(`${what}: unknown scheme`);
  const port = v.port === undefined ? DEFAULT_PORT[scheme] : v.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${what}: invalid port`);
  return `${scheme}://${v.host}:${port}`;
}

export function toElectronProxy(config: unknown): ElectronProxy {
  if (!isObj(config)) throw new Error("The proxy value must be an object");
  const { mode } = config;
  switch (mode) {
    case "direct":
    case "auto_detect":
    case "system":
      return { mode };
    case "pac_script": {
      const pac = config.pacScript;
      if (!isObj(pac)) throw new Error("pac_script needs pacScript");
      if (typeof pac.url === "string" && /^(https?|data|file):/i.test(pac.url))
        return { mode, pacScript: pac.url };
      if (typeof pac.data === "string")
        return {
          mode,
          pacScript: `data:application/x-ns-proxy-autoconfig;base64,${btoa(
            String.fromCharCode(...new TextEncoder().encode(pac.data)),
          )}`,
        };
      throw new Error("pacScript needs a url or data");
    }
    case "fixed_servers": {
      const rules = config.rules;
      if (!isObj(rules)) throw new Error("fixed_servers needs rules");
      const parts: string[] = [];
      if (rules.singleProxy !== undefined) parts.push(server(rules.singleProxy, "singleProxy"));
      else {
        for (const [key, scheme] of [
          ["proxyForHttp", "http"],
          ["proxyForHttps", "https"],
          ["proxyForFtp", "ftp"],
          ["fallbackProxy", "socks"],
        ] as const)
          if (rules[key] !== undefined) parts.push(`${scheme}=${server(rules[key], key)}`);
      }
      if (!parts.length) throw new Error("fixed_servers needs at least one proxy server");
      const bypass = rules.bypassList;
      if (
        bypass !== undefined &&
        (!Array.isArray(bypass) || !bypass.every((b) => typeof b === "string"))
      )
        throw new Error("bypassList must be a list of strings");
      return {
        mode,
        proxyRules: parts.join(";"),
        ...(bypass?.length ? { proxyBypassRules: bypass.join(",") } : {}),
      };
    }
    default:
      throw new Error(`Unknown proxy mode: ${String(mode)}`);
  }
}
