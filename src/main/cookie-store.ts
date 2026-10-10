/**
 * The Windows build has no Electron fuses since 0.1.22 (build/fuses.cjs: so
 * castLabs can sign it for Netflix), and with them went cookie encryption.
 * A cookie store written encrypted can't be read without it — Electron calls
 * it "corrupt and useless": sites can't keep you signed in, and some, like
 * Netflix, don't load properly. So on the first start without encryption,
 * the old store is put aside (renamed, not deleted) and Chromium starts a
 * new one. Sites ask you to sign in again, once.
 */
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Whether this build stores cookies encrypted (see build/fuses.cjs). */
export function cookiesEncrypted(platform: string, packaged: boolean): boolean {
  return packaged && platform !== "win32";
}

/** Puts the cookie store aside; must run before the app is ready. */
export function moveCookieStore(userData: string): boolean {
  let moved = false;
  for (const dir of [join(userData, "Network"), userData]) {
    for (const name of ["Cookies", "Cookies-journal"]) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      try {
        renameSync(file, `${file}.encrypted-${Date.now()}`);
        moved = true;
      } catch (err) {
        console.warn(`[moon] could not put aside ${file}:`, err);
      }
    }
  }
  return moved;
}
