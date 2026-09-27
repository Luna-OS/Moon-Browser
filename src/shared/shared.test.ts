import { describe, expect, it } from "vitest";
import { bangUrl, BANGS, matchBang } from "./bangs";
import { DEFAULT_ENGINE, resolveEngine, SEARCH_ENGINES, searchUrl } from "./engines";
import { dayLabel, formatBytes, groupByDay } from "./format";
import { httpsUpgrade, isLocalHost, shouldFallBackToHttp } from "./https";
import { internalPageOf } from "./internal";
import { clampRatio, contentArea, splitRects, SPLIT_GAP } from "./layout";
import { moonPhase } from "./moon";
import { displayUrl, shortHost } from "./display";
import { resolveInput } from "./omnibox";
import { defaultSettings, mergeSettings, normalizeSite, sanitizeSettings } from "./settings";
import { shortcutFor, type KeyInput } from "./shortcuts";
import {
  blocksWholePage,
  hostResolverConfig,
  isDangerousFile,
  stripTrackingParams,
  zoneIdentifier,
} from "./security";
import { isThirdParty, protectionSiteOf, siteOf } from "./sites";
import { inlineCompletion, matchScore, suggest } from "./suggest";
import type { HistoryEntry } from "./types";
import {
  acceptLanguages,
  addClientHints,
  cleanUserAgent,
  clientHints,
  getsClientHints,
} from "./useragent";

const opts = { engine: DEFAULT_ENGINE, bangs: true };
const go = (text: string) => resolveInput(text, opts);

describe("address bar input", () => {
  it("opens full URLs as they are", () => {
    expect(go("https://example.com/a?b=1")).toEqual({
      kind: "url",
      url: "https://example.com/a?b=1",
    });
    expect(go("http://localhost:3000")).toEqual({ kind: "url", url: "http://localhost:3000/" });
    expect(go("file:///home/luna/notes.txt")?.url).toBe("file:///home/luna/notes.txt");
    expect(go("about:blank")?.url).toBe("about:blank");
  });

  it("recognizes domains, local hosts and IPs without a scheme", () => {
    expect(go("example.com")).toEqual({ kind: "url", url: "http://example.com/" });
    expect(go("github.com/Luna-OS")?.url).toBe("http://github.com/Luna-OS");
    expect(go("localhost:5173")?.url).toBe("http://localhost:5173/");
    expect(go("192.168.1.1")?.url).toBe("http://192.168.1.1/");
    expect(go("[::1]:8080")?.url).toBe("http://[::1]:8080/");
    expect(go("nas.local")?.url).toBe("http://nas.local/");
    expect(go("router/")?.url).toBe("http://router/");
    expect(go("nas:5000")?.url).toBe("http://nas:5000/");
    expect(go("bücher.de")?.kind).toBe("url");
  });

  it("searches for everything else", () => {
    for (const text of [
      "moon",
      "what is the moon",
      "3.14",
      "file.txt",
      "c++",
      "user@example.com",
      "what?",
    ]) {
      expect(go(text)?.kind, text).toBe("search");
    }
    expect(go("full moon")?.url).toBe("https://www.perplexity.ai/search?q=full+moon");
  });

  it("never runs typed javascript: or data: URLs", () => {
    expect(go("javascript:alert(1)")?.kind).toBe("search");
    expect(go("data:text/html,<h1>hi</h1>")?.kind).toBe("search");
  });

  it("only opens known internal pages", () => {
    expect(go("moon://settings")?.kind).toBe("url");
    expect(go("moon://ui")?.kind).toBe("search");
    expect(go("about:settings")?.url).toBe("moon://settings/");
    expect(go("chrome://history")?.url).toBe("moon://history/");
  });

  it("supports view-source for web pages only", () => {
    expect(go("view-source:https://example.com")?.url).toBe("view-source:https://example.com/");
    expect(go("view-source:moon://settings")?.kind).toBe("search");
  });

  it("handles bangs at the start and the end", () => {
    expect(go("!w full moon")).toMatchObject({
      kind: "bang",
      url: "https://en.wikipedia.org/w/index.php?search=full+moon",
    });
    expect(go("full moon !w")?.url).toBe("https://en.wikipedia.org/w/index.php?search=full+moon");
    expect(go("!gh")?.url).toBe("https://github.com/");
    expect(go("!nope moon")?.kind).toBe("search");
    expect(resolveInput("!w moon", { ...opts, bangs: false })?.kind).toBe("search");
  });
});

describe("bangs", () => {
  it("has unique triggers and valid URLs", () => {
    const triggers = BANGS.map((b) => b.trigger);
    expect(new Set(triggers).size).toBe(triggers.length);
    for (const b of BANGS) {
      expect(b.url).toContain("%s");
      expect(() => new URL(b.home)).not.toThrow();
      expect(b.url.startsWith("https://"), b.trigger).toBe(true);
    }
  });

  it("encodes the query", () => {
    const m = matchBang("!yt a&b=c")!;
    expect(bangUrl(m)).toBe("https://www.youtube.com/results?search_query=a%26b%3Dc");
  });

  it("ignores exclamation marks that are not bangs", () => {
    expect(matchBang("hello! world")).toBeNull();
    expect(matchBang("!!w moon")).toBeNull();
  });
});

describe("search engines", () => {
  it("searches with Perplexity by default", () => {
    expect(defaultSettings("win32").searchEngine).toBe("perplexity");
    // Tabs and groups come back after a restart.
    expect(defaultSettings("win32").startup).toBe("restore");
    expect(DEFAULT_ENGINE.name).toBe("Perplexity");
    expect(go("!p why is the moon white")?.url).toBe(
      "https://www.perplexity.ai/search?q=why+is+the+moon+white",
    );
  });

  it("builds search URLs", () => {
    for (const e of SEARCH_ENGINES) {
      expect(searchUrl(e, "moon phase")).toContain("moon+phase");
      expect(searchUrl(e, "  ")).toBe(e.home);
    }
  });

  it("accepts a valid custom engine and falls back otherwise", () => {
    expect(resolveEngine("custom", "https://search.example.org/?q=%s").name).toBe(
      "search.example.org",
    );
    expect(resolveEngine("custom", "https://search.example.org/")).toBe(DEFAULT_ENGINE);
    expect(resolveEngine("custom", "javascript:%s")).toBe(DEFAULT_ENGINE);
  });
});

describe("display", () => {
  it("shows addresses without the scheme", () => {
    expect(displayUrl("https://example.com/")).toBe("example.com");
    expect(displayUrl("https://example.com/a/b?c#d")).toBe("example.com/a/b?c#d");
    expect(displayUrl("moon://newtab/")).toBe("");
    expect(displayUrl("moon://settings/")).toBe("moon://settings/");
    expect(shortHost("https://www.example.com/x")).toBe("example.com");
  });

  it("knows its internal pages", () => {
    expect(internalPageOf("moon://settings/#privacy")).toBe("settings");
    expect(internalPageOf("moon://ui/")).toBeNull();
    expect(internalPageOf("https://settings.example/")).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });

  it("groups by day", () => {
    const now = new Date(2026, 8, 26, 12).getTime();
    expect(dayLabel(now - 3600_000, now)).toBe("Today");
    expect(dayLabel(now - 24 * 3600_000, now)).toBe("Yesterday");
    const groups = groupByDay([now, now - 1000, now - 48 * 3600_000], (t) => t, now);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
  });
});

describe("settings", () => {
  it("falls back to defaults for garbage", () => {
    expect(sanitizeSettings(null, "linux")).toEqual(defaultSettings("linux"));
    expect(sanitizeSettings("nope", "linux")).toEqual(defaultSettings("linux"));
    const s = sanitizeSettings(
      { theme: "neon", sleepAfterMinutes: 7, homePage: "javascript:alert(1)" },
      "linux",
    );
    expect(s.theme).toBe("dark");
    expect(s.sleepAfterMinutes).toBe(60);
    expect(s.homePage).toBe("");
  });

  it("keeps valid values", () => {
    const s = sanitizeSettings(
      {
        theme: "light",
        searchEngine: "kagi",
        sleepAfterMinutes: 30,
        protectionAllowlist: ["WWW.Example.com", "bad value", 3],
      },
      "win32",
    );
    expect(s.theme).toBe("light");
    expect(s.searchEngine).toBe("kagi");
    expect(s.sleepAfterMinutes).toBe(30);
    expect(s.protectionAllowlist).toEqual(["example.com"]);
    expect(s.spellcheck).toBe(true);
  });

  it("does not allow a custom engine without a valid URL", () => {
    expect(sanitizeSettings({ searchEngine: "custom" }, "linux").searchEngine).toBe("perplexity");
    const ok = sanitizeSettings(
      { searchEngine: "custom", customSearchUrl: "https://s.example/?q=%s" },
      "linux",
    );
    expect(ok.searchEngine).toBe("custom");
  });

  it("merges partial updates", () => {
    const base = defaultSettings("linux");
    expect(mergeSettings(base, { adblock: false }, "linux").adblock).toBe(false);
    expect(mergeSettings(base, { adblock: "no" }, "linux").adblock).toBe(true);
  });

  it("spell checking is opt-in on Linux only", () => {
    expect(defaultSettings("linux").spellcheck).toBe(false);
    expect(defaultSettings("win32").spellcheck).toBe(true);
  });

  it("normalizes allowlist sites", () => {
    expect(normalizeSite(" WWW.Example.COM ")).toBe("example.com");
    expect(normalizeSite("localhost")).toBe("localhost");
    expect(normalizeSite("not a site")).toBeNull();
  });
});

describe("sites", () => {
  it("uses the registrable domain", () => {
    expect(siteOf("https://a.b.example.co.uk/x")).toBe("example.co.uk");
    expect(siteOf("http://localhost:3000")).toBe("localhost");
    expect(siteOf("http://192.168.0.1/")).toBe("192.168.0.1");
    expect(protectionSiteOf("https://www.example.com/")).toBe("example.com");
    expect(protectionSiteOf("moon://settings/")).toBeNull();
  });

  it("tells first from third parties", () => {
    expect(isThirdParty("https://cdn.example.com/a.js", "https://www.example.com/")).toBe(false);
    expect(isThirdParty("https://tracker.example/a.js", "https://www.example.com/")).toBe(true);
    // Different users' sites on a shared host are different sites.
    expect(isThirdParty("https://alice.github.io/", "https://bob.github.io/")).toBe(true);
  });
});

describe("HTTPS-first", () => {
  const none = new Set<string>();
  it("upgrades public http addresses", () => {
    expect(httpsUpgrade("http://example.com/a?b", none)).toBe("https://example.com/a?b");
    expect(httpsUpgrade("http://example.com:80/", none)).toBe("https://example.com/");
  });

  it("leaves local hosts, custom ports, exceptions and https alone", () => {
    expect(httpsUpgrade("http://localhost:3000/", none)).toBeNull();
    expect(httpsUpgrade("http://192.168.1.1/", none)).toBeNull();
    expect(httpsUpgrade("http://printer/", none)).toBeNull();
    expect(httpsUpgrade("http://nas.local/", none)).toBeNull();
    expect(httpsUpgrade("http://example.com:8080/", none)).toBeNull();
    expect(httpsUpgrade("http://old.example/", new Set(["old.example"]))).toBeNull();
    expect(httpsUpgrade("https://example.com/", none)).toBeNull();
  });

  it("falls back only for errors that mean 'no HTTPS here'", () => {
    expect(shouldFallBackToHttp(-202)).toBe(true);
    expect(shouldFallBackToHttp(-102)).toBe(true);
    expect(shouldFallBackToHttp(-105)).toBe(false); // name not resolved
    expect(shouldFallBackToHttp(-3)).toBe(false); // aborted
    expect(isLocalHost("[::1]")).toBe(true);
  });
});

describe("keyboard shortcuts", () => {
  const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    type: "keyDown",
    key: k,
    control: false,
    meta: false,
    shift: false,
    alt: false,
    ...mods,
  });

  it("maps the usual browser keys on Windows and Linux", () => {
    expect(shortcutFor(key("t", { control: true }), "linux")).toEqual({ type: "newTab" });
    expect(shortcutFor(key("T", { control: true, shift: true }), "win32")).toEqual({
      type: "reopenClosedTab",
    });
    expect(shortcutFor(key("N", { control: true, shift: true }), "linux")).toEqual({
      type: "newPrivateWindow",
    });
    expect(shortcutFor(key("Tab", { control: true }), "linux")).toEqual({ type: "nextTab" });
    expect(shortcutFor(key("Tab", { control: true, shift: true }), "linux")).toEqual({
      type: "previousTab",
    });
    expect(shortcutFor(key("3", { control: true }), "linux")).toEqual({
      type: "selectTab",
      index: 2,
    });
    expect(shortcutFor(key("9", { control: true }), "linux")).toEqual({ type: "selectLastTab" });
    expect(shortcutFor(key("ArrowLeft", { alt: true }), "win32")).toEqual({ type: "back" });
    expect(shortcutFor(key("F5"), "win32")).toEqual({ type: "reload" });
    expect(shortcutFor(key("F5", { control: true }), "win32")).toEqual({ type: "hardReload" });
    expect(shortcutFor(key("h", { control: true }), "linux")).toEqual({
      type: "openPage",
      page: "history",
    });
  });

  it("leaves ordinary typing and key-ups to the page", () => {
    expect(shortcutFor(key("t"), "linux")).toBeNull();
    expect(shortcutFor(key("a", { control: true }), "linux")).toBeNull();
    expect(shortcutFor({ ...key("t", { control: true }), type: "keyUp" }, "linux")).toBeNull();
    expect(shortcutFor(key("Escape"), "linux")).toBeNull();
  });

  it("uses Cmd on macOS", () => {
    expect(shortcutFor(key("t", { meta: true }), "darwin")).toEqual({ type: "newTab" });
    expect(shortcutFor(key("t", { control: true }), "darwin")).toBeNull();
  });
});

describe("suggestions", () => {
  const now = Date.UTC(2026, 8, 26);
  const entry = (url: string, title: string, visits: number, daysAgo = 0): HistoryEntry => ({
    url,
    title,
    favicon: null,
    visits,
    typed: 0,
    lastVisit: now - daysAgo * 86_400_000,
  });
  const history = [
    entry("https://github.com/", "GitHub", 40),
    entry("https://gitlab.com/", "GitLab", 2, 60),
    entry("https://en.wikipedia.org/wiki/Moon", "Moon – Wikipedia", 3),
    entry("https://example.com/moon-landing", "Apollo 11", 1, 200),
  ];

  it("scores host prefixes above word and substring matches", () => {
    expect(matchScore("git", "https://github.com/", "GitHub")).toBeGreaterThan(
      matchScore("hub", "https://github.com/", "GitHub"),
    );
    expect(matchScore("xyz", "https://github.com/", "GitHub")).toBe(0);
  });

  it("ranks frequent recent matches first and dedupes", () => {
    const s = suggest("git", {
      history,
      bookmarks: [
        {
          id: "1",
          url: "https://github.com/",
          title: "GitHub",
          favicon: null,
          created: 0,
          parent: null,
          isFolder: false,
        },
        // Folders have no address and are never suggested.
        {
          id: "2",
          url: "",
          title: "GitHub things",
          favicon: null,
          created: 0,
          parent: null,
          isFolder: true,
        },
      ],
      tabs: [],
      now,
    });
    expect(s[0]).toMatchObject({ kind: "bookmark", url: "https://github.com/" });
    expect(s.filter((x) => x.url === "https://github.com/")).toHaveLength(1);
    expect(s.map((x) => x.url)).toContain("https://gitlab.com/");
  });

  it("finds open tabs", () => {
    const s = suggest("moon", {
      history: [],
      bookmarks: [],
      tabs: [{ id: 7, url: "https://en.wikipedia.org/wiki/Moon", title: "Moon", favicon: null }],
      now,
    });
    expect(s[0]).toMatchObject({ kind: "tab", tabId: 7 });
  });

  it("completes hosts inline", () => {
    expect(inlineCompletion("git", history, now)).toBe("hub.com");
    expect(inlineCompletion("en.wiki", history, now)).toBe("pedia.org");
    expect(inlineCompletion("git hub", history, now)).toBeNull();
    expect(inlineCompletion("github.com/", history, now)).toBeNull();
  });
});

describe("split view layout", () => {
  it("splits the page area around the divider", () => {
    const [l, r] = splitRects({ x: 0, y: 80, width: 1006, height: 600 }, 0.5);
    expect(l).toEqual({ x: 0, y: 80, width: 500, height: 600 });
    expect(r).toEqual({ x: 500 + SPLIT_GAP, y: 80, width: 500, height: 600 });
  });

  it("keeps both panes usable", () => {
    expect(clampRatio(0)).toBe(0.2);
    expect(clampRatio(1)).toBe(0.8);
    expect(clampRatio(Number.NaN)).toBe(0.5);
  });

  it("computes the page area from insets", () => {
    expect(contentArea(1200, 800, { top: 84, right: 0, bottom: 0, left: 0 })).toEqual({
      x: 0,
      y: 84,
      width: 1200,
      height: 716,
    });
  });
});

describe("moon phase", () => {
  it("knows new and full moons", () => {
    // New moon on 2024-01-11 11:57 UTC, full moon on 2024-01-25 17:54 UTC.
    const newMoon = moonPhase(new Date(Date.UTC(2024, 0, 11, 12)));
    expect(newMoon.illumination).toBeLessThan(0.02);
    expect(newMoon.name).toBe("New moon");
    const full = moonPhase(new Date(Date.UTC(2024, 0, 25, 18)));
    expect(full.illumination).toBeGreaterThan(0.98);
    expect(full.name).toBe("Full moon");
    expect(moonPhase(new Date(Date.UTC(2024, 0, 15))).waxing).toBe(true);
  });
});

describe("user agent", () => {
  it("looks like plain Chrome", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) moon-browser/0.1.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36";
    expect(cleanUserAgent(ua)).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  });

  it("sends pages Chrome's client hints, the same as the renderer's", () => {
    const ua = (major: number) =>
      `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
    // What Electron 44's renderer sends (and navigator.userAgentData says).
    expect(clientHints(ua(152), "linux")).toEqual({
      "sec-ch-ua": '"Not?A_Brand";v="24", "Chromium";v="152"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
    });
    // Chromium's GREASE brand for other versions, as Chrome sent it.
    expect(clientHints(ua(131), "win32")).toEqual({
      "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    });
    expect(clientHints(ua(138), "darwin")["sec-ch-ua"]).toBe(
      '"Not)A;Brand";v="8", "Chromium";v="138"',
    );

    expect(getsClientHints("https://accounts.google.com/v3/signin/identifier")).toBe(true);
    expect(getsClientHints("http://127.0.0.1:8080/")).toBe(true);
    expect(getsClientHints("http://localhost/")).toBe(true);
    expect(getsClientHints("http://example.com/")).toBe(false);
    expect(getsClientHints("moon://settings/")).toBe(false);
    expect(getsClientHints("not a url")).toBe(false);

    const headers: Record<string, string> = { "Sec-CH-UA-Mobile": "?1", Accept: "text/html" };
    addClientHints(headers, clientHints(ua(152), "linux"));
    expect(headers).toEqual({
      "Sec-CH-UA-Mobile": "?1",
      Accept: "text/html",
      "sec-ch-ua": '"Not?A_Brand";v="24", "Chromium";v="152"',
      "sec-ch-ua-platform": '"Linux"',
    });
  });

  it("sends only the preferred language", () => {
    expect(acceptLanguages(["de-DE", "en-US"])).toBe("de-DE,de");
    expect(acceptLanguages(["en"])).toBe("en");
    expect(acceptLanguages([])).toBe("en-US,en");
  });
});

describe("security helpers", () => {
  it("strips tracking parameters and keeps the rest", () => {
    expect(
      stripTrackingParams(
        "https://shop.example/item?id=7&utm_source=news&utm_medium=mail&fbclid=abc",
      ),
    ).toBe("https://shop.example/item?id=7");
    expect(stripTrackingParams("https://example.com/?gclid=1#top")).toBe(
      "https://example.com/#top",
    );
    expect(stripTrackingParams("https://www.youtube.com/watch?v=x&si=track")).toBe(
      "https://www.youtube.com/watch?v=x",
    );
    expect(stripTrackingParams("https://example.com/?si=keep")).toBeNull();
    expect(stripTrackingParams("https://example.com/?q=moon")).toBeNull();
    expect(stripTrackingParams("moon://settings/?utm_source=x")).toBeNull();
  });

  it("recognizes files that run code", () => {
    for (const f of [
      "setup.exe",
      "Install.MSI",
      "run.bat",
      "evil.ps1",
      "tool.AppImage",
      "app.deb",
      "x.jar",
      "a.js",
    ]) {
      expect(isDangerousFile(f), f).toBe(true);
    }
    for (const f of ["photo.jpg", "notes.pdf", "archive.zip", "README", "movie.mp4", "exe"]) {
      expect(isDangerousFile(f), f).toBe(false);
    }
  });

  it("writes the Windows Mark of the Web", () => {
    expect(
      zoneIdentifier({ url: "https://dl.example/setup.exe", referrer: "https://example.com/" }),
    ).toBe(
      "[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://example.com/\r\nHostUrl=https://dl.example/setup.exe\r\n",
    );
    expect(zoneIdentifier({ url: "blob:https://x/1\r\nZoneId=0" })).toBe(
      "[ZoneTransfer]\r\nZoneId=3\r\n",
    );
  });

  it("configures DNS over HTTPS", () => {
    expect(hostResolverConfig("quad9")).toEqual({
      enableBuiltInResolver: true,
      secureDnsMode: "secure",
      secureDnsServers: ["https://dns.quad9.net/dns-query"],
    });
    expect(hostResolverConfig("automatic").secureDnsMode).toBe("automatic");
    expect(hostResolverConfig("off").secureDnsMode).toBe("off");
  });

  it("blocks whole pages only for host rules and $document rules", () => {
    expect(
      blocksWholePage({ hostnameAnchored: true, pattern: "", text: "||malware.example^" }),
    ).toBe(true);
    expect(
      blocksWholePage({
        hostnameAnchored: true,
        pattern: "/dl/",
        text: "||site.example^/dl/$document",
      }),
    ).toBe(true);
    expect(
      blocksWholePage({
        hostnameAnchored: false,
        pattern: "/ads/index.",
        text: "/ads/index.$~xhr",
      }),
    ).toBe(false);
    expect(
      blocksWholePage({
        hostnameAnchored: true,
        pattern: "/ddm/clk/",
        text: "||ad.example^/ddm/clk/$domain=x",
      }),
    ).toBe(false);
  });
});
