import { describe, expect, it } from "vitest";
import {
  compareVersions,
  describePermissions,
  EXTENSION_ID,
  localize,
  optionsPage,
  pickIcon,
  siteAccess,
  unsupportedFeatures,
} from "./extensions";
import { timeAgo } from "./format";
import { internalPageOf, INTERNAL_ALIASES } from "./internal";
import { PAGE_METHODS } from "./ipc";
import { defaultSettings, sanitizeSettings } from "./settings";

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

  it("warns about native messaging", () => {
    expect(unsupportedFeatures({ optional_permissions: ["nativeMessaging"] })).toHaveLength(1);
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
