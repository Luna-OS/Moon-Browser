import { describe, expect, it } from "vitest";
import { toElectronProxy } from "./proxy";

describe("toElectronProxy", () => {
  it("passes the simple modes through", () => {
    expect(toElectronProxy({ mode: "direct" })).toEqual({ mode: "direct" });
    expect(toElectronProxy({ mode: "system" })).toEqual({ mode: "system" });
  });
  it("turns fixed servers into proxy rules", () => {
    expect(
      toElectronProxy({
        mode: "fixed_servers",
        rules: {
          singleProxy: { scheme: "socks5", host: "127.0.0.1", port: 9050 },
          bypassList: ["<local>", "*.lan"],
        },
      }),
    ).toEqual({
      mode: "fixed_servers",
      proxyRules: "socks5://127.0.0.1:9050",
      proxyBypassRules: "<local>,*.lan",
    });
    expect(
      toElectronProxy({
        mode: "fixed_servers",
        rules: {
          proxyForHttps: { host: "proxy.example" },
          fallbackProxy: { scheme: "socks4", host: "s.example" },
        },
      }),
    ).toEqual({
      mode: "fixed_servers",
      proxyRules: "https=http://proxy.example:80;socks=socks4://s.example:1080",
    });
  });
  it("takes a PAC script by URL or as text", () => {
    expect(
      toElectronProxy({ mode: "pac_script", pacScript: { url: "https://pac.example/p.pac" } }),
    ).toEqual({
      mode: "pac_script",
      pacScript: "https://pac.example/p.pac",
    });
    const pac = toElectronProxy({
      mode: "pac_script",
      pacScript: { data: "function FindProxyForURL(){return 'DIRECT'}" },
    });
    expect(pac.pacScript?.startsWith("data:application/x-ns-proxy-autoconfig;base64,")).toBe(true);
  });
  it("rejects what Chrome rejects", () => {
    expect(() => toElectronProxy({ mode: "teleport" })).toThrow();
    expect(() => toElectronProxy({ mode: "fixed_servers", rules: {} })).toThrow();
    expect(() =>
      toElectronProxy({ mode: "fixed_servers", rules: { singleProxy: { host: "a b" } } }),
    ).toThrow();
    expect(() =>
      toElectronProxy({
        mode: "fixed_servers",
        rules: { singleProxy: { host: "a", port: 70000 } },
      }),
    ).toThrow();
  });
});
