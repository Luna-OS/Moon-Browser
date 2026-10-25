import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appBundleOf,
  BUNDLE_ID,
  canReplace,
  parseFeed,
  pickZip,
  sha512Of,
  SWAP_SCRIPT,
  unpackAndCheck,
} from "./mac-update";

// latest-mac.yml of release v0.1.34, as electron-builder wrote it.
const FEED = `version: 0.1.34
files:
  - url: moon-browser-0.1.34-mac-x64.zip
    sha512: o7m8QhQLwlqp4k3WXm1acmkfXA4WYRdRvUsshaSyRGt2jhddlARAU/n+ajRpSFeG6TWKLNs3uNgOYj/UOATMEQ==
    size: 136073871
  - url: moon-browser-0.1.34-mac-arm64.zip
    sha512: gBXyCA237XeDl0B2fMO90cGN7UjYr5YEzo+xY+d/HoTe9q20E/8+LnNuKDyj1kp4wFzBbYl7I5zwxCtj/FQGIg==
    size: 129412845
  - url: moon-browser-0.1.34-mac-x64.dmg
    sha512: dxMsDddRquagARru398E6cK3VUcbWC3a3DI/0cAvWn9mczv+sB4AzHCZoaVPi10xrb9WoLGjiFOJFLGmXaZTrQ==
    size: 137401690
path: moon-browser-0.1.34-mac-x64.zip
sha512: o7m8QhQLwlqp4k3WXm1acmkfXA4WYRdRvUsshaSyRGt2jhddlARAU/n+ajRpSFeG6TWKLNs3uNgOYj/UOATMEQ==
releaseDate: '2026-10-24T00:48:04.590Z'
`;

describe("Mac updates without a Developer ID", () => {
  it("reads latest-mac.yml and picks this Mac's zip", () => {
    const feed = parseFeed(FEED);
    expect(feed.version).toBe("0.1.34");
    expect(feed.files).toHaveLength(3);
    expect(pickZip(feed, "arm64")).toEqual({
      url: "moon-browser-0.1.34-mac-arm64.zip",
      sha512:
        "gBXyCA237XeDl0B2fMO90cGN7UjYr5YEzo+xY+d/HoTe9q20E/8+LnNuKDyj1kp4wFzBbYl7I5zwxCtj/FQGIg==",
      size: 129412845,
    });
    expect(pickZip(feed, "x64")?.url).toBe("moon-browser-0.1.34-mac-x64.zip");
    expect(() => parseFeed("files:\n")).toThrow();
    // A file name that would leave the release's folder is never picked.
    expect(
      pickZip(parseFeed(FEED.replace("moon-browser-0.1.34-mac-arm64", "../x-mac-arm64")), "arm64"),
    ).toBeNull();
  });

  it("knows where it runs from and whether it may replace itself", () => {
    expect(appBundleOf("/Applications/Luma.app/Contents/MacOS/Luma")).toBe(
      "/Applications/Luma.app",
    );
    expect(appBundleOf("/usr/bin/node")).toBeNull();
    expect(canReplace("/Volumes/Luma/Luma.app")).toBe(false);
    expect(canReplace("/private/var/folders/x/AppTranslocation/ABC/d/Luma.app")).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "moon-mac-"));
    mkdirSync(join(dir, "Luma.app"));
    expect(canReplace(join(dir, "Luma.app"))).toBe(true);
  });

  it("checks downloads with the SHA-512 latest-mac.yml gives", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "moon-mac-")), "f");
    writeFileSync(file, "moon");
    expect(await sha512Of(file)).toBe(
      "arEK+LqImmV5bVj85Z3F8C6nh0QlXM7nDlVf8YkyqHb6HwK9gUeCJK+FQOdSzF3rg9XURcGY0EBl1tBb6LT05w==",
    );
  });

  it.skipIf(process.platform === "win32")(
    "puts the new app in place once the old one has quit, or keeps the old one",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "moon-mac-"));
      const gone = spawnSync("true").pid ?? 999999;
      const swap = (old: string, from: string) =>
        execFileSync("/bin/sh", ["-c", SWAP_SCRIPT, "t", String(gone), old, from, "0"]);
      const make = (path: string, text: string) => {
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, "v"), text);
      };
      // Same name: replaced in place.
      const luma = join(dir, "Luma.app");
      make(luma, "old");
      make(join(dir, "a", "Luma.app"), "new");
      swap(luma, join(dir, "a", "Luma.app"));
      expect(readFileSync(join(luma, "v"), "utf8")).toBe("new");
      expect(existsSync(`${luma}.moon-previous`)).toBe(false);
      // A new app that isn't there: the old one stays.
      swap(luma, join(dir, "missing.app"));
      expect(readFileSync(join(luma, "v"), "utf8")).toBe("new");
      // The renamed browser: "Moon Browser.app" becomes "Luma.app".
      const renamed = mkdtempSync(join(tmpdir(), "moon-mac-"));
      const moon = join(renamed, "Moon Browser.app");
      make(moon, "old");
      make(join(renamed, "b", "Luma.app"), "new");
      swap(moon, join(renamed, "b", "Luma.app"));
      expect(existsSync(moon)).toBe(false);
      expect(readFileSync(join(renamed, "Luma.app", "v"), "utf8")).toBe("new");
    },
  );

  it.runIf(process.platform === "darwin")(
    "unpacks the update and checks its signature, bundle ID and version",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "moon-mac-"));
      const app = join(dir, "src", "Luma.app");
      mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
      execFileSync("cp", ["/usr/bin/true", join(app, "Contents", "MacOS", "Luma")]);
      const plist = (id: string) =>
        writeFileSync(
          join(app, "Contents", "Info.plist"),
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>9.9.9</string>
<key>CFBundleExecutable</key><string>Luma</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
        );
      const zipUp = (name: string) => {
        execFileSync("codesign", ["--force", "--deep", "-s", "-", app]);
        const zip = join(dir, name);
        execFileSync("ditto", ["-c", "-k", "--keepParent", app, zip]);
        return zip;
      };
      plist(BUNDLE_ID);
      const good = zipUp("good.zip");
      expect(await unpackAndCheck(good, join(dir, "out"), "9.9.9")).toBe(
        join(dir, "out", "Luma.app"),
      );
      await expect(unpackAndCheck(good, join(dir, "out"), "1.0.0")).rejects.toThrow(/version/);
      plist("com.example.other");
      const other = zipUp("other.zip");
      await expect(unpackAndCheck(other, join(dir, "out"), "9.9.9")).rejects.toThrow(/not Luma/);
    },
  );
});
