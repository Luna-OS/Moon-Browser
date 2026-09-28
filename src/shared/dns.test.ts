import { describe, expect, it } from "vitest";
import {
  dnsAddressProblem,
  formatDnsAddress,
  hostResolverConfig,
  parseDnsAddress,
  sanitizeCustomDns,
  sanitizeDnsSetting,
} from "./dns";
import { defaultSettings, sanitizeSettings } from "./settings";

describe("the user's own DNS servers", () => {
  it("reads IP addresses with or without a port, and DNS-over-HTTPS addresses", () => {
    expect(parseDnsAddress(" 100.78.107.162:5335 ")).toEqual({
      kind: "plain",
      host: "100.78.107.162",
      port: 5335,
    });
    expect(parseDnsAddress("192.168.1.2")).toEqual({
      kind: "plain",
      host: "192.168.1.2",
      port: 53,
    });
    expect(parseDnsAddress("[FD00::53]:5335")).toEqual({
      kind: "plain",
      host: "fd00::53",
      port: 5335,
    });
    expect(parseDnsAddress("fd7a:115c:a1e0::53")).toEqual({
      kind: "plain",
      host: "fd7a:115c:a1e0::53",
      port: 53,
    });
    expect(parseDnsAddress("https://dns.example/dns-query")).toEqual({
      kind: "https",
      template: "https://dns.example/dns-query",
    });
    expect(parseDnsAddress("https://dns.example/dns-query{?dns}")?.kind).toBe("https");
    for (const bad of [
      "",
      "http://dns.example/dns-query",
      "https://user:pw@dns.example/",
      "pihole.local:53",
      "300.1.1.1",
      "1.2.3.4:0",
      "1.2.3.4:70000",
      "1.2.3.4:53a",
      ":5335",
      "[not-ipv6]:53",
    ])
      expect(parseDnsAddress(bad)).toBeNull();
  });

  it("writes addresses one way, and says what's wrong with a bad one", () => {
    expect(formatDnsAddress({ kind: "plain", host: "10.0.0.53", port: 53 })).toBe("10.0.0.53:53");
    expect(formatDnsAddress({ kind: "plain", host: "fd00::53", port: 5335 })).toBe(
      "[fd00::53]:5335",
    );
    expect(dnsAddressProblem("100.78.107.162:5335")).toBeNull();
    expect(dnsAddressProblem(" ")).toBe("Enter the server's address.");
    expect(dnsAddressProblem("pihole.local:53")).toContain("IP address");
    expect(dnsAddressProblem("http://dns.example/")).toContain("https://");
    expect(dnsAddressProblem("1.2.3")).toContain("not an IP address");
  });

  it("keeps only named, valid servers", () => {
    const servers = sanitizeCustomDns([
      { id: "nrz", name: "  NRZ DNS (Netbird)  ", address: " 100.78.107.162:5335" },
      { id: "nrz", name: "Twice", address: "1.1.1.1" },
      { id: "doh", name: "Mine", address: "https://dns.example/dns-query" },
      { id: "noname", name: " ", address: "1.1.1.1" },
      { id: "bad", name: "Bad", address: "pihole.local" },
      { id: "Bad ID!", name: "Bad id", address: "1.1.1.1" },
      "junk",
    ]);
    expect(servers).toEqual([
      { id: "nrz", name: "NRZ DNS (Netbird)", address: "100.78.107.162:5335" },
      { id: "doh", name: "Mine", address: "https://dns.example/dns-query" },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      address: `10.0.0.${i + 1}`,
    }));
    expect(sanitizeCustomDns(many)).toHaveLength(20);
    expect(sanitizeCustomDns("nope")).toEqual([]);
  });

  it("chooses one of them only while it exists", () => {
    const servers = sanitizeCustomDns([{ id: "nrz", name: "NRZ", address: "100.78.107.162:5335" }]);
    expect(sanitizeDnsSetting("custom:nrz", servers, "automatic")).toBe("custom:nrz");
    expect(sanitizeDnsSetting("custom:gone", servers, "automatic")).toBe("automatic");
    expect(sanitizeDnsSetting("quad9", servers, "automatic")).toBe("quad9");
    expect(sanitizeDnsSetting(42, servers, "automatic")).toBe("automatic");

    // Settings: removing the chosen server goes back to automatic.
    const d = defaultSettings("linux");
    const withServer = sanitizeSettings(
      { ...d, customDns: servers, secureDns: "custom:nrz" },
      "linux",
    );
    expect(withServer.secureDns).toBe("custom:nrz");
    expect(sanitizeSettings({ ...withServer, customDns: [] }, "linux").secureDns).toBe("automatic");
  });

  it("configures Chromium's DNS: providers, the user's DoH server, or the bridge", () => {
    expect(hostResolverConfig("quad9")).toEqual({
      enableBuiltInResolver: true,
      secureDnsMode: "secure",
      secureDnsServers: ["https://dns.quad9.net/dns-query"],
    });
    expect(hostResolverConfig("automatic").secureDnsMode).toBe("automatic");
    expect(hostResolverConfig("off").secureDnsMode).toBe("off");

    const servers = sanitizeCustomDns([
      { id: "nrz", name: "NRZ", address: "100.78.107.162:5335" },
      { id: "doh", name: "Mine", address: "https://dns.example/dns-query" },
    ]);
    expect(hostResolverConfig("custom:doh", servers).secureDnsServers).toEqual([
      "https://dns.example/dns-query",
    ]);
    // A plain server: through the bridge, and nothing else.
    expect(hostResolverConfig("custom:nrz", servers, "https://127.0.0.1:41234/dns-query")).toEqual({
      enableBuiltInResolver: true,
      secureDnsMode: "secure",
      secureDnsServers: ["https://127.0.0.1:41234/dns-query"],
    });
    // No bridge (it couldn't start) or no such server: Chromium's automatic DNS.
    expect(hostResolverConfig("custom:nrz", servers, null).secureDnsMode).toBe("automatic");
    expect(hostResolverConfig("custom:gone", servers, null).secureDnsMode).toBe("automatic");
  });
});
