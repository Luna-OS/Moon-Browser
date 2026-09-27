import { describe, expect, it } from "vitest";
import {
  applyHeaders,
  compileRule,
  evaluate,
  parseRule,
  redirectTarget,
  urlFilterToRegExp,
  type DnrRequest,
} from "./dnr";

const req = (url: string, extra: Partial<DnrRequest> = {}): DnrRequest => ({
  url,
  method: "GET",
  type: "script",
  initiator: "https://site.example/",
  tabId: 7,
  thirdParty: true,
  ...extra,
});

const rules = (...raw: unknown[]) => raw.map((r) => compileRule(parseRule(r), "_dynamic"));

describe("urlFilter", () => {
  it("anchors at the domain with ||", () => {
    const re = urlFilterToRegExp("||ads.example^");
    expect(re.test("https://ads.example/x.js")).toBe(true);
    expect(re.test("https://cdn.ads.example/x.js")).toBe(true);
    expect(re.test("https://notads.example/x.js")).toBe(false);
    expect(re.test("https://ads.example.org/x.js")).toBe(false);
    expect(re.test("https://ads.example")).toBe(true); // ^ matches the end
  });
  it("anchors at the start and end with |, * is anything", () => {
    expect(urlFilterToRegExp("|https://a.example/").test("https://a.example/x")).toBe(true);
    expect(urlFilterToRegExp("|https://a.example/").test("http://x/https://a.example/")).toBe(
      false,
    );
    expect(urlFilterToRegExp(".js|").test("https://a.example/x.js")).toBe(true);
    expect(urlFilterToRegExp(".js|").test("https://a.example/x.js?v=1")).toBe(false);
    expect(urlFilterToRegExp("/ads/*/banner").test("https://a.example/ads/1/2/banner.png")).toBe(
      true,
    );
  });
  it("is case-insensitive unless asked", () => {
    expect(urlFilterToRegExp("/Track").test("https://a.example/track")).toBe(true);
    expect(urlFilterToRegExp("/Track", true).test("https://a.example/track")).toBe(false);
  });
});

describe("parseRule", () => {
  it("accepts a valid rule and fills in the priority", () => {
    const rule = parseRule({ id: 3, action: { type: "block" }, condition: { urlFilter: "x" } });
    expect(rule).toEqual({
      id: 3,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: "x" },
    });
  });
  it("rejects what Chrome rejects", () => {
    expect(() => parseRule({ id: 0, action: { type: "block" } })).toThrow();
    expect(() => parseRule({ id: 1, action: { type: "explode" } })).toThrow();
    expect(() =>
      parseRule({
        id: 1,
        action: { type: "block" },
        condition: { urlFilter: "a", regexFilter: "b" },
      }),
    ).toThrow();
    expect(() => parseRule({ id: 1, action: { type: "redirect" }, condition: {} })).toThrow();
    expect(() =>
      parseRule({
        id: 1,
        action: { type: "allowAllRequests" },
        condition: { resourceTypes: ["script"] },
      }),
    ).toThrow();
    expect(() =>
      parseRule({ id: 1, action: { type: "block" }, condition: { resourceTypes: ["banana"] } }),
    ).toThrow();
  });
});

describe("evaluate", () => {
  it("leaves main frames alone unless a rule names them", () => {
    const r = rules({ id: 1, action: { type: "block" }, condition: { urlFilter: "evil" } });
    expect(evaluate(r, req("https://evil.example/")).action?.rule.id).toBe(1);
    expect(evaluate(r, req("https://evil.example/", { type: "main_frame" })).action).toBeNull();
  });
  it("lets the highest priority win, and allow beat block at the same priority", () => {
    const r = rules(
      { id: 1, priority: 1, action: { type: "block" }, condition: { urlFilter: "ads" } },
      { id: 2, priority: 2, action: { type: "allow" }, condition: { urlFilter: "ads/ok" } },
      { id: 3, priority: 2, action: { type: "block" }, condition: { urlFilter: "ads/ok" } },
    );
    expect(evaluate(r, req("https://x.example/ads/bad")).action?.rule.id).toBe(1);
    expect(evaluate(r, req("https://x.example/ads/ok")).action?.rule.id).toBe(2);
  });
  it("checks domains, resource types, methods, tabs and party", () => {
    const r = rules({
      id: 1,
      action: { type: "block" },
      condition: {
        requestDomains: ["tracker.example"],
        excludedInitiatorDomains: ["friend.example"],
        resourceTypes: ["script", "image"],
        requestMethods: ["get"],
        domainType: "thirdParty",
        excludedTabIds: [9],
      },
    });
    const hit = (url: string, extra: Partial<DnrRequest> = {}) =>
      evaluate(r, req(url, extra)).action !== null;
    expect(hit("https://a.tracker.example/p")).toBe(true);
    expect(hit("https://tracker.example.org/p")).toBe(false);
    expect(hit("https://tracker.example/p", { initiator: "https://www.friend.example/" })).toBe(
      false,
    );
    expect(hit("https://tracker.example/p", { type: "font" })).toBe(false);
    expect(hit("https://tracker.example/p", { method: "POST" })).toBe(false);
    expect(hit("https://tracker.example/p", { thirdParty: false })).toBe(false);
    expect(hit("https://tracker.example/p", { tabId: 9 })).toBe(false);
  });
  it("keeps header rules below an allow rule from applying", () => {
    const r = rules(
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "x-a", operation: "set", value: "1" }],
        },
        condition: {},
      },
      {
        id: 2,
        priority: 3,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "x-b", operation: "set", value: "2" }],
        },
        condition: {},
      },
      { id: 3, priority: 2, action: { type: "allow" }, condition: {} },
    );
    const out = evaluate(r, req("https://x.example/"));
    expect(out.action?.rule.id).toBe(3);
    expect(out.headers.map((h) => h.rule.id)).toEqual([2]);
  });
  it("respects an allowAllRequests floor from the page", () => {
    const r = rules({
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: "ads" },
    });
    expect(evaluate(r, req("https://x.example/ads"), 1).action).toBeNull();
    expect(evaluate(r, req("https://x.example/ads"), null).action?.rule.id).toBe(1);
  });
});

describe("redirects", () => {
  const target = (raw: unknown, url: string) =>
    redirectTarget(rules(raw)[0], url, "abcdefghijklmnopabcdefghijklmnop");
  it("upgrades the scheme", () => {
    expect(
      target({ id: 1, action: { type: "upgradeScheme" }, condition: {} }, "http://a.example/x"),
    ).toBe("https://a.example/x");
  });
  it("goes to a URL, an extension page, a transformed URL or a substitution", () => {
    expect(
      target(
        { id: 1, action: { type: "redirect", redirect: { url: "https://b.example/" } } },
        "https://a.example/",
      ),
    ).toBe("https://b.example/");
    expect(
      target(
        { id: 1, action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } } },
        "https://a.example/",
      ),
    ).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop/blocked.html");
    expect(
      target(
        {
          id: 1,
          action: {
            type: "redirect",
            redirect: {
              transform: {
                host: "new.example",
                queryTransform: {
                  removeParams: ["utm"],
                  addOrReplaceParams: [{ key: "a", value: "2" }],
                },
              },
            },
          },
        },
        "https://old.example/p?a=1&utm=x",
      ),
    ).toBe("https://new.example/p?a=2");
    expect(
      target(
        {
          id: 1,
          action: {
            type: "redirect",
            redirect: { regexSubstitution: "https://\\1.example/v2/\\2" },
          },
          condition: { regexFilter: "^https://(\\w+)\\.example/v1/(.*)$" },
        },
        "https://api.example/v1/users",
      ),
    ).toBe("https://api.example/v2/users");
  });
  it("never redirects to the same URL", () => {
    expect(
      target(
        { id: 1, action: { type: "redirect", redirect: { url: "https://a.example/" } } },
        "https://a.example/",
      ),
    ).toBeNull();
  });
});

describe("applyHeaders", () => {
  it("sets, appends and removes, first setter wins", () => {
    const h: Record<string, string> = { "User-Agent": "UA", Cookie: "a=1", "X-Drop": "1" };
    const touched = new Set<string>();
    applyHeaders(h, [{ header: "user-agent", operation: "set", value: "Moon" }], false, touched);
    applyHeaders(h, [{ header: "user-agent", operation: "set", value: "Other" }], false, touched);
    applyHeaders(
      h,
      [
        { header: "cookie", operation: "append", value: "b=2" },
        { header: "x-drop", operation: "remove" },
      ],
      false,
      touched,
    );
    expect(h).toEqual({ "user-agent": "Moon", Cookie: "a=1; b=2" });
    const r: Record<string, string[]> = { "Set-Cookie": ["a=1"] };
    applyHeaders(r, [{ header: "set-cookie", operation: "append", value: "b=2" }], true);
    expect(r).toEqual({ "Set-Cookie": ["a=1", "b=2"] });
  });
});
