/**
 * Import from other browsers: bookmarks and history from Comet and the
 * other Chromium-based browsers, read straight from their profile folders.
 *
 * Passwords, cookies and payment data are deliberately not imported: they
 * are encrypted with the other browser's key, and Moon Browser keeps no
 * password store of its own — a dedicated password manager is the safer
 * home for them.
 */
import { dialog, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { copyFile, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  flattenBookmarks,
  HISTORY_QUERY,
  historyFromRows,
  profilesFromLocalState,
  type HistoryRow,
} from "@shared/import";
import type { ImportableProfile, ImportResult } from "@shared/types";
import type { Profile } from "./profile";

interface KnownBrowser {
  name: string;
  win32?: string[];
  linux?: string[];
  darwin?: string[];
}

const LOCAL = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const CONFIG = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const MAC = join(homedir(), "Library", "Application Support");

/** Where Chromium-based browsers keep their "User Data" folder. */
const BROWSERS: KnownBrowser[] = [
  {
    name: "Comet",
    win32: [join(LOCAL, "Perplexity", "Comet", "User Data"), join(LOCAL, "Comet", "User Data")],
    darwin: [join(MAC, "Comet"), join(MAC, "Perplexity", "Comet")],
    linux: [join(CONFIG, "Comet"), join(CONFIG, "comet"), join(CONFIG, "perplexity-comet")],
  },
  {
    name: "Google Chrome",
    win32: [join(LOCAL, "Google", "Chrome", "User Data")],
    darwin: [join(MAC, "Google", "Chrome")],
    linux: [join(CONFIG, "google-chrome")],
  },
  {
    name: "Chromium",
    win32: [join(LOCAL, "Chromium", "User Data")],
    darwin: [join(MAC, "Chromium")],
    linux: [join(CONFIG, "chromium")],
  },
  {
    name: "Brave",
    win32: [join(LOCAL, "BraveSoftware", "Brave-Browser", "User Data")],
    darwin: [join(MAC, "BraveSoftware", "Brave-Browser")],
    linux: [join(CONFIG, "BraveSoftware", "Brave-Browser")],
  },
  {
    name: "Microsoft Edge",
    win32: [join(LOCAL, "Microsoft", "Edge", "User Data")],
    darwin: [join(MAC, "Microsoft Edge")],
    linux: [join(CONFIG, "microsoft-edge")],
  },
  {
    name: "Helium",
    win32: [join(LOCAL, "imput", "Helium", "User Data")],
    darwin: [join(MAC, "net.imput.helium")],
    linux: [join(CONFIG, "net.imput.helium")],
  },
  {
    name: "Vivaldi",
    win32: [join(LOCAL, "Vivaldi", "User Data")],
    darwin: [join(MAC, "Vivaldi")],
    linux: [join(CONFIG, "vivaldi")],
  },
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A folder is a browser profile if it has a bookmarks file or a history database. */
async function isProfileDir(dir: string): Promise<boolean> {
  return (await exists(join(dir, "Bookmarks"))) || (await exists(join(dir, "History")));
}

async function profilesIn(userData: string, browser: string): Promise<ImportableProfile[]> {
  let named: { dir: string; name: string }[] = [];
  try {
    named = profilesFromLocalState(
      JSON.parse(await readFile(join(userData, "Local State"), "utf8")),
    );
  } catch {
    // No Local State: fall back to the default profile below.
  }
  if (!named.some((p) => p.dir === "Default")) named.unshift({ dir: "Default", name: "Default" });
  const out: ImportableProfile[] = [];
  for (const p of named) {
    const dir = join(userData, p.dir);
    if (await isProfileDir(dir)) {
      out.push({
        path: dir,
        browser,
        profile: p.name,
        label: named.length > 1 ? `${browser} — ${p.name}` : browser,
      });
    }
  }
  return out;
}

export class Importer {
  /** Folders the import may read: detected profiles and ones the user picked. */
  private readonly allowed = new Set<string>();

  constructor(private readonly profile: Profile) {}

  async detect(): Promise<ImportableProfile[]> {
    const platform = process.platform as "win32" | "linux" | "darwin";
    const found: ImportableProfile[] = [];
    for (const browser of BROWSERS) {
      for (const userData of browser[platform] ?? []) {
        if (!(await exists(userData))) continue;
        found.push(...(await profilesIn(userData, browser.name)));
        break;
      }
    }
    for (const p of found) this.allowed.add(resolve(p.path));
    return found;
  }

  /** Lets the user point at a profile folder of any Chromium-based browser. */
  async chooseFolder(win: BrowserWindow): Promise<ImportableProfile | null> {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose a browser profile folder",
      buttonLabel: "Import from here",
      defaultPath:
        process.platform === "win32" ? LOCAL : process.platform === "darwin" ? MAC : CONFIG,
      properties: ["openDirectory", "showHiddenFiles"],
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked) return null;
    // The "User Data" folder itself: use its default profile.
    const dir = (await isProfileDir(picked)) ? picked : join(picked, "Default");
    if (!(await isProfileDir(dir))) return null;
    this.allowed.add(resolve(dir));
    return { path: dir, browser: "Chromium browser", profile: dir, label: dir };
  }

  async run(dir: string, what: { bookmarks: boolean; history: boolean }): Promise<ImportResult> {
    const path = resolve(dir);
    if (!isAbsolute(dir) || !this.allowed.has(path)) throw new Error("Unknown profile folder");
    const result: ImportResult = { bookmarks: 0, history: 0, errors: [] };

    if (what.bookmarks) {
      try {
        const json: unknown = JSON.parse(await readFile(join(path, "Bookmarks"), "utf8"));
        result.bookmarks = this.profile.importBookmarks(flattenBookmarks(json));
      } catch (err) {
        result.errors.push(`Bookmarks: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (what.history) {
      // The other browser may be running and hold its database open: read a copy.
      const copy = join(tmpdir(), `moon-import-${randomUUID()}.sqlite`);
      try {
        await copyFile(join(path, "History"), copy);
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(copy, { readOnly: true });
        try {
          const rows = db.prepare(HISTORY_QUERY).all() as unknown as HistoryRow[];
          result.history = this.profile.importHistory(historyFromRows(rows));
        } finally {
          db.close();
        }
      } catch (err) {
        result.errors.push(`History: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await rm(copy, { force: true }).catch(() => undefined);
      }
    }
    return result;
  }
}
