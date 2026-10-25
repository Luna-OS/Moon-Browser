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
    expect(appBundleOf("/Applications/Moon Browser.app/Contents/MacOS/Moon Browser")).toBe(
      "/Applications/Moon Browser.app",
    );
    expect(appBundleOf("/usr/bin/node")).toBeNull();
    expect(canReplace("/Volumes/Moon Browser/Moon Browser.app")).toBe(false);
    expect(canReplace("/private/var/folders/x/AppTranslocation/ABC/d/Moon Browser.app")).toBe(
      false,
    );
    const dir = mkdtempSync(join(tmpdir(), "moon-mac-"));
    mkdirSync(join(dir, "Moon Browser.app"));
    expect(canReplace(join(dir, "Moon Browser.app"))).toBe(true);
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
      const old = join(dir, "Moon Browser.app");
      const fresh = join(dir, "staged", "Moon Browser.app");
      mkdirSync(old);
      writeFileSync(join(old, "v"), "old");
      mkdirSync(fresh, { recursive: true });
      writeFileSync(join(fresh, "v"), "new");
      const gone = spawnSync("true").pid ?? 999999;
      const swap = (from: string) =>
        execFileSync("/bin/sh", ["-c", SWAP_SCRIPT, "t", String(gone), old, from, "0"]);
      swap(fresh);
      expect(readFileSync(join(old, "v"), "utf8")).toBe("new");
      expect(existsSync(`${old}.moon-previous`)).toBe(false);
      // A new app that isn't there: the old one stays.
      swap(join(dir, "missing.app"));
      expect(readFileSync(join(old, "v"), "utf8")).toBe("new");
    },
  );

  it.runIf(process.platform === "darwin")(
    "unpacks the update and checks its signature, bundle ID and version",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "moon-mac-"));
      const app = join(dir, "src", "Moon Browser.app");
      mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
      execFileSync("cp", ["/usr/bin/true", join(app, "Contents", "MacOS", "Moon Browser")]);
      const plist = (id: string) =>
        writeFileSync(
          join(app, "Contents", "Info.plist"),
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>9.9.9</string>
<key>CFBundleExecutable</key><string>Moon Browser</string>
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
        join(dir, "out", "Moon Browser.app"),
      );
      await expect(unpackAndCheck(good, join(dir, "out"), "1.0.0")).rejects.toThrow(/version/);
      plist("com.example.other");
      const other = zipUp("other.zip");
      await expect(unpackAndCheck(other, join(dir, "out"), "9.9.9")).rejects.toThrow(
        /not Moon Browser/,
      );
    },
  );
});
