import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cookiesEncrypted, moveCookieStore } from "./cookie-store";

describe("the cookie store", () => {
  it("is encrypted in the Linux build only", () => {
    expect(cookiesEncrypted("linux", true)).toBe(true);
    expect(cookiesEncrypted("win32", true)).toBe(false);
    // Unpackaged (development, tests): no fuses at all.
    expect(cookiesEncrypted("linux", false)).toBe(false);
  });

  it("is put aside, not deleted", () => {
    const userData = mkdtempSync(join(tmpdir(), "moon-cookies-"));
    mkdirSync(join(userData, "Network"));
    writeFileSync(join(userData, "Network", "Cookies"), "encrypted");
    writeFileSync(join(userData, "Network", "Cookies-journal"), "");
    expect(moveCookieStore(userData)).toBe(true);
    expect(existsSync(join(userData, "Network", "Cookies"))).toBe(false);
    const kept = readdirSync(join(userData, "Network"));
    expect(kept.filter((f) => f.startsWith("Cookies.encrypted-"))).toHaveLength(1);
    expect(kept.filter((f) => f.startsWith("Cookies-journal.encrypted-"))).toHaveLength(1);
    // A fresh profile has nothing to put aside.
    expect(moveCookieStore(mkdtempSync(join(tmpdir(), "moon-cookies-")))).toBe(false);
  });
});
