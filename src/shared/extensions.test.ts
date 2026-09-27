import { describe, expect, it } from "vitest";
import {
  compareVersions,
  describePermissions,
  EXTENSION_ID,
  extensionPageUrl,
  hasSiteAccess,
  isMessagingNoise,
  matchesPattern,
  sidePanelPage,
  localize,
  optionsPage,
  pickIcon,
  siteAccess,
  unsupportedFeatures,
} from "./extensions";
import { timeAgo } from "./format";
import {
  cleanGroupTitle,
  GROUP_COLORS,
  groupAfterMove,
  groupDropIndex,
  groupMoveIndex,
  isGroupColor,
  nextGroupColor,
} from "./tab-groups";
import { clampPanelWidth, SIDE_PANEL_HEADER, sidePanelRects, SPLIT_GAP } from "./layout";
import { internalPageOf, INTERNAL_ALIASES } from "./internal";
import { PAGE_METHODS } from "./ipc";
import { defaultSettings, sanitizeSettings } from "./settings";

describe("extension errors", () => {
  it("leaves out unanswered messages, which Chrome doesn't list either", () => {
    expect(
      isMessagingNoise(
        "Uncaught (in promise) Error: Could not establish connection. Receiving end does not exist. (js/background.js:0)",
      ),
    ).toBe(true);
    expect(
      isMessagingNoise(
        "Unchecked runtime.lastError: The message port closed before a response was received.",
      ),
    ).toBe(true);
    expect(
      isMessagingNoise("Uncaught SyntaxError: Unexpected end of input (js/background.js:64)"),
    ).toBe(false);
    expect(
      isMessagingNoise("The service worker didn't start: Failed to start service worker."),
    ).toBe(false);
  });
});

describe("extension manifests", () => {
  it("recognizes Chrome Web Store IDs", () => {
    expect(EXTENSION_ID.test("eiaeiblijfjekdanodkjadfinkhbfgcd")).toBe(true);
    expect(EXTENSION_ID.test("eiaeiblijfjekdanodkjadfinkhbfgc")).toBe(false);
    expect(EXTENSION_ID.test("../../../../etc/passwd/aaaaaaaaaa")).toBe(false);
    expect(EXTENSION_ID.test("EIAEIBLIJFJEKDANODKJADFINKHBFGCD")).toBe(false);
  });

  it("compares versions number by number", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("3.1.2", "3.1.10")).toBe(-1);
  });

  it("fills in translated texts", () => {
    const messages = { appName: { message: "NordPass" }, appDesc: { message: "Passwords" } };
    expect(localize("__MSG_appName__", messages)).toBe("NordPass");
    expect(localize("__MSG_APPNAME__ – __MSG_appDesc__", messages)).toBe("NordPass – Passwords");
    expect(localize("__MSG_missing__", messages)).toBe("__MSG_missing__");
    expect(localize("Plain name", messages)).toBe("Plain name");
  });

  it("tells all-sites access apart from a few hosts", () => {
    expect(siteAccess({ host_permissions: ["<all_urls>"] })).toBe("all");
    expect(siteAccess({ content_scripts: [{ matches: ["https://*/*"] }] })).toBe("all");
    expect(siteAccess({ permissions: ["tabs", "*://*/*"] })).toBe("all");
    expect(
      siteAccess({ host_permissions: ["https://*.nordpass.com/*", "https://example.org/a/*"] }),
    ).toEqual(["example.org", "nordpass.com"]);
    expect(siteAccess({ permissions: ["storage"] })).toEqual([]);
  });

  it("describes permissions like Chrome's install question", () => {
    expect(
      describePermissions({
        permissions: ["storage", "tabs", "webNavigation", "clipboardWrite", "nativeMessaging"],
        host_permissions: ["<all_urls>"],
      }),
    ).toEqual([
      "Read and change all your data on all websites",
      "Read your browsing history",
      "Change what you copy and paste",
      "Talk to other apps on your computer",
    ]);
    expect(describePermissions({ host_permissions: ["https://a.com/*"] })).toEqual([
      "Read and change your data on a.com",
    ]);
    expect(
      describePermissions({
        host_permissions: [
          "https://a.com/*",
          "https://b.com/*",
          "https://c.com/*",
          "https://d.com/*",
        ],
      }),
    ).toEqual(["Read and change your data on 4 websites"]);
    expect(describePermissions({ permissions: ["storage", "alarms"] })).toEqual([]);
  });

  it("notes what Moon Browser can't offer", () => {
    // Native messaging works (through desktop apps' registrations for Chrome).
    expect(unsupportedFeatures({ permissions: ["nativeMessaging"] })).toEqual([]);
    expect(unsupportedFeatures({ permissions: ["tabGroups"] })).toEqual([]);
    expect(unsupportedFeatures({ permissions: ["declarativeNetRequest"] })).toEqual([]);
    expect(unsupportedFeatures({ permissions: ["proxy"] })).toEqual([]);
    expect(unsupportedFeatures({ permissions: ["storage"] })).toEqual([]);
  });

  it("finds the options page and a fitting icon", () => {
    expect(optionsPage({ options_ui: { page: "options.html" } })).toBe("options.html");
    expect(optionsPage({ options_page: "settings.html" })).toBe("settings.html");
    expect(optionsPage({})).toBeNull();
    const icons = { icons: { "16": "i16.png", "48": "i48.png", "128": "i128.png" } };
    expect(pickIcon(icons, 32)).toBe("i48.png");
    expect(pickIcon(icons, 256)).toBe("i128.png");
    expect(pickIcon({}, 32)).toBeNull();
  });
});

describe("extensions page", () => {
  it("is an internal page with its own methods", () => {
    expect(internalPageOf("moon://extensions/")).toBe("extensions");
    expect(INTERNAL_ALIASES["chrome://extensions"]).toBe("moon://extensions/");
    expect(PAGE_METHODS.extensions).toContain("extensions.remove");
    // Only the extensions page may remove extensions.
    for (const [page, methods] of Object.entries(PAGE_METHODS)) {
      if (page !== "extensions") expect(methods).not.toContain("extensions.remove");
    }
  });
});

describe("updates", () => {
  it("look for updates by default, and the choice is kept", () => {
    expect(defaultSettings("win32").autoUpdate).toBe(true);
    expect(sanitizeSettings({ autoUpdate: false }, "linux").autoUpdate).toBe(false);
    expect(sanitizeSettings({ autoUpdate: "no" }, "linux").autoUpdate).toBe(true);
  });

  it("only the settings and about pages can install updates", () => {
    const pages = Object.entries(PAGE_METHODS)
      .filter(([, methods]) => methods.includes("update.install"))
      .map(([page]) => page)
      .sort();
    expect(pages).toEqual(["about", "settings"]);
  });

  it("says how long ago something happened", () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 20_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 4 * 86_400_000, now)).toBe("4 days ago");
  });
});

describe("extension site access", () => {
  it("matches Chrome's match patterns", () => {
    expect(matchesPattern("<all_urls>", "https://example.com/")).toBe(true);
    expect(matchesPattern("<all_urls>", "moon://settings/")).toBe(false);
    expect(matchesPattern("*://*.nordpass.com/*", "https://app.nordpass.com/login")).toBe(true);
    expect(matchesPattern("*://*.nordpass.com/*", "https://nordpass.com/")).toBe(true);
    expect(matchesPattern("*://*.nordpass.com/*", "https://evilnordpass.com/")).toBe(false);
    expect(matchesPattern("*://*/*", "ftp://example.com/")).toBe(false);
    expect(matchesPattern("https://example.com/docs/*", "https://example.com/docs/a?b=1")).toBe(
      true,
    );
    expect(matchesPattern("https://example.com/docs/*", "https://example.com/blog/")).toBe(false);
    expect(matchesPattern("http://127.0.0.1/*", "http://127.0.0.1:8080/page")).toBe(true);
  });

  it("puts extensions into Full access or No access needed", () => {
    const manifest = {
      host_permissions: ["https://*.example.com/*"],
      content_scripts: [{ matches: ["https://moon.test/*"] }],
    };
    expect(hasSiteAccess(manifest, "https://www.example.com/")).toBe(true);
    expect(hasSiteAccess(manifest, "https://moon.test/x")).toBe(true);
    expect(hasSiteAccess(manifest, "https://other.org/")).toBe(false);
    expect(hasSiteAccess({ permissions: ["activeTab"] }, "https://other.org/")).toBe(false);
  });
});

describe("side panel", () => {
  const id = "eiaeiblijfjekdanodkjadfinkhbfgcd";

  it("only shows the extension's own pages", () => {
    expect(extensionPageUrl(id, "panel.html")).toBe(`chrome-extension://${id}/panel.html`);
    expect(extensionPageUrl(id, "/ui/panel.html?x=1")).toBe(
      `chrome-extension://${id}/ui/panel.html?x=1`,
    );
    expect(extensionPageUrl(id, "https://evil.example/")).toBeNull();
    expect(extensionPageUrl(id, `chrome-extension://${"a".repeat(32)}/x.html`)).toBeNull();
    expect(extensionPageUrl("not-an-id", "panel.html")).toBeNull();
    expect(sidePanelPage({ side_panel: { default_path: "sp.html" } })).toBe("sp.html");
    expect(sidePanelPage({})).toBeNull();
  });

  it("splits the page area between the pages and the panel", () => {
    const area = { x: 0, y: 100, width: 1200, height: 700 };
    const { pages, panel, view } = sidePanelRects(area, 400);
    expect(panel.width).toBe(400);
    expect(pages.width + SPLIT_GAP + panel.width).toBe(1200);
    expect(view.y).toBe(100 + SIDE_PANEL_HEADER);
    expect(view.height).toBe(700 - SIDE_PANEL_HEADER);
    // Never so wide that the pages disappear, never too narrow to use.
    expect(clampPanelWidth(5000, 1200)).toBeLessThanOrEqual(1200 - 320 - SPLIT_GAP);
    expect(clampPanelWidth(10, 1200)).toBe(280);
  });
});

describe("tab groups", () => {
  it("keeps groups in one piece when a tab moves", () => {
    // Dropped between two tabs of group 1: joins it.
    expect(groupAfterMove([1, null, 1], 1)).toBe(1);
    // Moved to the edge of its own group: stays.
    expect(groupAfterMove([null, 2, 2], 1)).toBe(2);
    expect(groupAfterMove([2, 2, null], 1)).toBe(2);
    // Moved away from its group: leaves it.
    expect(groupAfterMove([1, 1, 3, null], 2)).toBeNull();
    // Next to a group it doesn't belong to: stays outside.
    expect(groupAfterMove([1, 1, null], 2)).toBeNull();
    expect(groupAfterMove([null], 0)).toBeNull();
  });

  it("moves whole groups only to where they stay in one piece", () => {
    // The other tabs: one pinned, then a loose tab, group 7 (3 tabs), a loose tab.
    const rest = [null, null, 7, 7, 7, null];
    expect(groupMoveIndex(rest, 1, 1)).toBe(1);
    expect(groupMoveIndex(rest, 1, 2)).toBe(2);
    expect(groupMoveIndex(rest, 1, 5)).toBe(5);
    expect(groupMoveIndex(rest, 1, -1)).toBe(6);
    // Among the pinned tabs, inside group 7, out of range: not allowed.
    expect(groupMoveIndex(rest, 1, 0)).toBeNull();
    expect(groupMoveIndex(rest, 1, 3)).toBeNull();
    expect(groupMoveIndex(rest, 1, 4)).toBeNull();
    expect(groupMoveIndex(rest, 1, 7)).toBeNull();
    expect(groupMoveIndex(rest, 1, 1.5)).toBeNull();

    // Dragging snaps instead: past the pinned tabs, to group 7's nearer end.
    expect(groupDropIndex(rest, 1, 0)).toBe(1);
    expect(groupDropIndex(rest, 1, 3)).toBe(2);
    expect(groupDropIndex(rest, 1, 4)).toBe(5);
    expect(groupDropIndex(rest, 1, 99)).toBe(6);
    expect(groupDropIndex([4, 4], 0, 1)).toBe(0);
  });

  it("picks an unused colour for a new group, grey last", () => {
    expect(nextGroupColor([])).toBe("blue");
    expect(nextGroupColor(["blue", "red"])).toBe("yellow");
    const all = GROUP_COLORS.filter((c) => c !== "grey");
    expect(nextGroupColor(all)).toBe("grey");
    expect(isGroupColor("purple")).toBe(true);
    expect(isGroupColor("magenta")).toBe(false);
  });

  it("keeps group names to one short line", () => {
    expect(cleanGroupTitle("  Work \n stuff  ")).toBe("Work stuff");
    expect(cleanGroupTitle("x".repeat(100))).toHaveLength(60);
    expect(cleanGroupTitle(42)).toBe("");
  });
});
