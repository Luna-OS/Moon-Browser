import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  chromeTimeToMs,
  flattenBookmarks,
  HISTORY_QUERY,
  historyFromRows,
  profilesFromLocalState,
  type HistoryRow,
} from "./import";

/** A Chromium time for a JS timestamp. */
const chromeTime = (ms: number) => (ms + 11_644_473_600_000) * 1000;

describe("importing from Chromium browsers (Comet, Chrome, …)", () => {
  it("converts Chromium timestamps", () => {
    const now = Date.UTC(2026, 8, 26, 12);
    expect(chromeTimeToMs(chromeTime(now))).toBe(now);
    expect(chromeTimeToMs(0)).toBe(0);
    expect(chromeTimeToMs(Number.NaN)).toBe(0);
  });

  it("flattens a Bookmarks file, bookmarks bar first", () => {
    const file = {
      roots: {
        other: {
          type: "folder",
          name: "Other",
          children: [{ type: "url", name: "Docs", url: "https://docs.example/" }],
        },
        bookmark_bar: {
          type: "folder",
          name: "Bookmarks bar",
          children: [
            { type: "url", name: "Perplexity", url: "https://www.perplexity.ai/" },
            {
              type: "folder",
              name: "Work",
              children: [
                { type: "url", name: "Repo", url: "https://github.com/Luna-OS/Moon-Browser" },
                { type: "url", name: "Evil", url: "javascript:alert(1)" },
              ],
            },
          ],
        },
      },
    };
    expect(flattenBookmarks(file)).toEqual([
      { url: "https://www.perplexity.ai/", title: "Perplexity", folder: "Bookmarks bar" },
      {
        url: "https://github.com/Luna-OS/Moon-Browser",
        title: "Repo",
        folder: "Bookmarks bar/Work",
      },
      { url: "https://docs.example/", title: "Docs", folder: "Other" },
    ]);
    expect(flattenBookmarks(null)).toEqual([]);
    expect(flattenBookmarks({ roots: "nope" })).toEqual([]);
  });

  it("reads the history database with the importer's query", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)",
    );
    const insert = db.prepare(
      "INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const t = Date.UTC(2026, 8, 20);
    insert.run(
      "https://www.perplexity.ai/search?q=moon",
      "moon - Perplexity",
      3,
      0,
      chromeTime(t),
      0,
    );
    insert.run("https://example.com/", "Example", 10, 4, chromeTime(t + 1000), 0);
    insert.run("https://hidden.example/", "Hidden", 1, 0, chromeTime(t), 1);
    insert.run("chrome://settings/", "Settings", 5, 0, chromeTime(t), 0);
    const rows = db.prepare(HISTORY_QUERY).all() as unknown as HistoryRow[];
    db.close();
    expect(historyFromRows(rows)).toEqual([
      { url: "https://example.com/", title: "Example", visits: 10, typed: 4, lastVisit: t + 1000 },
      {
        url: "https://www.perplexity.ai/search?q=moon",
        title: "moon - Perplexity",
        visits: 3,
        typed: 0,
        lastVisit: t,
      },
    ]);
  });

  it("names profiles from Local State", () => {
    const state = {
      profile: {
        info_cache: {
          Default: { name: "Luna" },
          "Profile 1": { name: "" },
          "../evil": { name: "x" },
        },
      },
    };
    expect(profilesFromLocalState(state)).toEqual([
      { dir: "Default", name: "Luna" },
      { dir: "Profile 1", name: "Profile 1" },
    ]);
    expect(profilesFromLocalState({})).toEqual([]);
  });
});
