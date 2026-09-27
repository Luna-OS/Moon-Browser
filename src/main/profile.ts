/**
 * Everything Moon Browser remembers between starts, as small JSON files in
 * the profile folder. Private windows never write here.
 */
import { cleanGroupTitle, isGroupColor, type GroupColor } from "@shared/tab-groups";
import { randomUUID } from "node:crypto";
import {
  childrenOf,
  linksOf,
  mergeImported,
  moveNode,
  removeNode,
  repairTree,
} from "@shared/bookmarks";
import type { ImportedNode } from "@shared/import";
import { sanitizeSettings } from "@shared/settings";
import type {
  Bookmark,
  DownloadInfo,
  HistoryEntry,
  PermissionKind,
  SiteSettingsEntry,
  Settings,
} from "@shared/types";
import { profilePath } from "./paths";
import { JsonStore } from "./store";

export interface ExtensionPrefs {
  disabled: string[];
  unpinned: string[];
  /** The extensions page shows developer tools and runs unpacked extensions. */
  developerMode: boolean;
  /** Extensions loaded from a folder in developer mode, with the ID they got. */
  unpacked: UnpackedExtension[];
  /** The version of each extension Moon Browser last loaded (for runtime.onInstalled). */
  versions: Record<string, string>;
  /** The proxy an extension set through chrome.proxy (checked again before use). */
  proxy?: { id: string; value: unknown };
}

export interface UnpackedExtension {
  path: string;
  id: string;
}

function parseVersions(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(raw)) return out;
  for (const [id, version] of Object.entries(raw).slice(0, 1000))
    if (/^[a-p]{32}$/.test(id) && typeof version === "string" && version.length <= 64)
      out[id] = version;
  return out;
}

function parseUnpacked(raw: unknown): UnpackedExtension[] {
  if (!Array.isArray(raw)) return [];
  const out: UnpackedExtension[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!isObj(item)) continue;
    const { path, id } = item;
    if (typeof path !== "string" || !path || path.length > 1024) continue;
    if (typeof id !== "string" || !/^[a-p]{32}$/.test(id)) continue;
    if (!out.some((u) => u.id === id)) out.push({ path, id });
  }
  return out;
}

const HISTORY_LIMIT = 20_000;
const HISTORY_DAYS = 180;
const DOWNLOADS_LIMIT = 300;
const DAY = 86_400_000;

export interface SavedTab {
  url: string;
  title: string;
  pinned: boolean;
  entries?: { url: string; title: string }[];
  index?: number;
  /** Index into the window's `groups`. */
  group?: number;
}

export interface SavedWindow {
  tabs: SavedTab[];
  active: number;
  groups?: { title: string; color: GroupColor; collapsed: boolean }[];
  bounds?: { x: number; y: number; width: number; height: number };
  maximized?: boolean;
}

export interface SavedSession {
  windows: SavedWindow[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const str = (v: unknown, max = 8192) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const httpish = (url: string) => /^(https?|file):/i.test(url);
const faviconOf = (v: unknown) => {
  const s = str(v, 2048);
  return /^(https?:|data:image\/)/i.test(s) ? s : null;
};

function parseHistory(raw: unknown): Map<string, HistoryEntry> {
  const map = new Map<string, HistoryEntry>();
  if (!Array.isArray(raw)) return map;
  const cutoff = Date.now() - HISTORY_DAYS * DAY;
  for (const e of raw) {
    if (!isObj(e)) continue;
    const url = str(e.url);
    if (!httpish(url) || num(e.lastVisit) < cutoff) continue;
    map.set(url, {
      url,
      title: str(e.title, 512),
      favicon: faviconOf(e.favicon),
      visits: Math.max(1, num(e.visits)),
      typed: num(e.typed),
      lastVisit: num(e.lastVisit),
    });
  }
  return map;
}

function parseBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  const list = raw.filter(isObj).flatMap((b): Bookmark[] => {
    // Bookmarks from before folders (0.1.12 and older) are on the bar.
    const isFolder = b.isFolder === true;
    const url = isFolder ? "" : str(b.url);
    if (!isFolder && !/^(https?|file|moon):/i.test(url)) return [];
    return [
      {
        id: str(b.id, 64) || randomUUID(),
        url,
        title: str(b.title, 512),
        favicon: isFolder ? null : faviconOf(b.favicon),
        created: num(b.created) || Date.now(),
        parent: str(b.parent, 64) || null,
        isFolder,
      },
    ];
  });
  return repairTree(list);
}

function parseDownloads(raw: unknown): DownloadInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((d) => ({
      id: str(d.id, 64) || randomUUID(),
      filename: str(d.filename, 1024),
      path: str(d.path, 4096),
      url: str(d.url),
      state: (["completed", "cancelled", "interrupted"] as const).includes(d.state as "completed")
        ? (d.state as DownloadInfo["state"])
        : "interrupted",
      received: num(d.received),
      total: num(d.total),
      paused: false,
      startTime: num(d.startTime),
    }))
    .slice(0, DOWNLOADS_LIMIT);
}

type PermissionMap = Record<string, Partial<Record<PermissionKind, "allow" | "deny">>>;

function parsePermissions(raw: unknown): PermissionMap {
  const out: PermissionMap = {};
  if (!isObj(raw)) return out;
  for (const [origin, perms] of Object.entries(raw)) {
    if (!/^https?:\/\//.test(origin) || !isObj(perms)) continue;
    const entry: PermissionMap[string] = {};
    for (const [kind, decision] of Object.entries(perms)) {
      if (decision === "allow" || decision === "deny") entry[kind as PermissionKind] = decision;
    }
    out[origin] = entry;
  }
  return out;
}

function parseZoom(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const [host, level] of Object.entries(raw)) {
    if (typeof level === "number" && Number.isFinite(level) && level !== 0) out[host] = level;
  }
  return out;
}

function parseSession(raw: unknown): SavedSession {
  if (!isObj(raw) || !Array.isArray(raw.windows)) return { windows: [] };
  const windows = raw.windows.filter(isObj).flatMap((w): SavedWindow[] => {
    if (!Array.isArray(w.tabs)) return [];
    const tabs = w.tabs.filter(isObj).flatMap((t): SavedTab[] => {
      const url = str(t.url);
      if (!/^(https?|file|moon):/i.test(url)) return [];
      const entries = Array.isArray(t.entries)
        ? t.entries
            .filter(isObj)
            .map((e) => ({ url: str(e.url), title: str(e.title, 512) }))
            .filter((e) => /^(https?|file|moon):/i.test(e.url))
            .slice(-50)
        : undefined;
      return [
        {
          url,
          title: str(t.title, 512),
          pinned: t.pinned === true,
          entries,
          index: entries ? Math.min(entries.length - 1, Math.max(0, num(t.index))) : undefined,
          group:
            typeof t.group === "number" && Number.isInteger(t.group) && t.group >= 0
              ? t.group
              : undefined,
        },
      ];
    });
    const groups = Array.isArray(w.groups)
      ? w.groups
          .filter(isObj)
          .slice(0, 100)
          .map((g) => ({
            title: cleanGroupTitle(g.title),
            color: isGroupColor(g.color) ? g.color : "grey",
            collapsed: g.collapsed === true,
          }))
      : [];
    if (!tabs.length) return [];
    const b = isObj(w.bounds) ? w.bounds : null;
    return [
      {
        tabs,
        active: Math.min(tabs.length - 1, Math.max(0, num(w.active))),
        bounds:
          b && num(b.width) >= 400 && num(b.height) >= 300
            ? { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) }
            : undefined,
        maximized: w.maximized === true,
        groups,
      },
    ];
  });
  return { windows };
}

interface Stats {
  totalBlocked: number;
  hiddenTopSites: string[];
  importHintDismissed: boolean;
  defaultBrowserHintDismissed: boolean;
  /** Moon Browser quit to install an update: restore the session on the next start. */
  restoreAfterUpdate: boolean;
  /** Profiles from before 0.1.8 were switched to restoring their tabs once. */
  restoreByDefault: boolean;
}

export class Profile {
  readonly settings: JsonStore<Settings>;
  readonly history: JsonStore<Map<string, HistoryEntry>>;
  readonly bookmarks: JsonStore<Bookmark[]>;
  readonly downloads: JsonStore<DownloadInfo[]>;
  readonly permissions: JsonStore<PermissionMap>;
  readonly zoom: JsonStore<Record<string, number>>;
  /** Extensions the user switched off, and the ones not shown in the toolbar. */
  readonly extensions: JsonStore<ExtensionPrefs>;
  readonly session: JsonStore<SavedSession>;
  readonly stats: JsonStore<Stats>;

  constructor(readonly platform: string) {
    this.settings = JsonStore.load(profilePath("settings.json"), (raw) =>
      sanitizeSettings(raw, platform),
    );
    this.history = JsonStore.load(profilePath("history.json"), parseHistory, {
      serialize: (m) => [...m.values()],
      delay: 3000,
    });
    this.bookmarks = JsonStore.load(profilePath("bookmarks.json"), parseBookmarks);
    this.downloads = JsonStore.load(profilePath("downloads.json"), parseDownloads);
    this.permissions = JsonStore.load(profilePath("permissions.json"), parsePermissions);
    this.zoom = JsonStore.load(profilePath("zoom.json"), parseZoom);
    const ids = (v: unknown) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 1000) : [];
    this.extensions = JsonStore.load(profilePath("extensions.json"), (raw): ExtensionPrefs => ({
      disabled: ids(isObj(raw) ? raw.disabled : null),
      unpinned: ids(isObj(raw) ? raw.unpinned : null),
      developerMode: isObj(raw) && raw.developerMode === true,
      unpacked: parseUnpacked(isObj(raw) ? raw.unpacked : null),
      versions: parseVersions(isObj(raw) ? raw.versions : null),
      ...(isObj(raw) &&
      isObj(raw.proxy) &&
      typeof raw.proxy.id === "string" &&
      /^[a-p]{32}$/.test(raw.proxy.id) &&
      isObj(raw.proxy.value)
        ? { proxy: { id: raw.proxy.id, value: raw.proxy.value } }
        : {}),
    }));
    this.session = JsonStore.load(profilePath("session.json"), parseSession, { delay: 2000 });
    this.stats = JsonStore.load(profilePath("stats.json"), (raw): Stats => ({
      totalBlocked: isObj(raw) ? num(raw.totalBlocked) : 0,
      hiddenTopSites:
        isObj(raw) && Array.isArray(raw.hiddenTopSites)
          ? raw.hiddenTopSites.filter((s): s is string => typeof s === "string").slice(0, 500)
          : [],
      importHintDismissed: isObj(raw) && raw.importHintDismissed === true,
      defaultBrowserHintDismissed: isObj(raw) && raw.defaultBrowserHintDismissed === true,
      restoreAfterUpdate: isObj(raw) && raw.restoreAfterUpdate === true,
      restoreByDefault: isObj(raw) && raw.restoreByDefault === true,
    }));
  }

  flush(): void {
    for (const store of [
      this.settings,
      this.history,
      this.bookmarks,
      this.downloads,
      this.permissions,
      this.zoom,
      this.extensions,
      this.session,
      this.stats,
    ] as JsonStore<unknown>[]) {
      store.flush();
    }
  }

  // ---- History ----

  recordVisit(url: string, title: string, typed: boolean): void {
    if (!/^https?:/i.test(url)) return;
    const map = this.history.get();
    const now = Date.now();
    const prev = map.get(url);
    // Re-inserting keeps the Map ordered by last visit (oldest first).
    map.delete(url);
    map.set(url, {
      url,
      title: title || prev?.title || "",
      favicon: prev?.favicon ?? null,
      visits: (prev?.visits ?? 0) + 1,
      typed: (prev?.typed ?? 0) + (typed ? 1 : 0),
      lastVisit: now,
    });
    if (map.size > HISTORY_LIMIT) {
      const excess = map.size - HISTORY_LIMIT;
      let i = 0;
      for (const key of map.keys()) {
        if (i++ >= excess) break;
        map.delete(key);
      }
    }
    this.history.changed();
  }

  updateHistory(url: string, patch: { title?: string; favicon?: string | null }): void {
    const entry = this.history.get().get(url);
    if (!entry) return;
    if (patch.title !== undefined && patch.title) entry.title = patch.title.slice(0, 512);
    if (patch.favicon !== undefined) entry.favicon = patch.favicon;
    this.history.changed();
    for (const b of this.bookmarks.get()) {
      if (b.url === url && patch.favicon && b.favicon !== patch.favicon) {
        b.favicon = patch.favicon;
        this.bookmarks.changed();
      }
    }
  }

  queryHistory(text: string, limit: number, before: number): HistoryEntry[] {
    const q = text.trim().toLowerCase();
    const out: HistoryEntry[] = [];
    const all = [...this.history.get().values()].reverse();
    for (const e of all) {
      if (e.lastVisit >= before) continue;
      if (q && !e.url.toLowerCase().includes(q) && !e.title.toLowerCase().includes(q)) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  removeHistory(urls: string[]): void {
    const map = this.history.get();
    for (const url of urls) map.delete(url);
    this.history.changed();
  }

  clearHistory(sinceMs: number): void {
    const map = this.history.get();
    for (const [url, e] of map) if (e.lastVisit >= sinceMs) map.delete(url);
    this.history.changed();
  }

  topSites(limit: number): HistoryEntry[] {
    const hidden = new Set(this.stats.get().hiddenTopSites);
    const now = Date.now();
    const byHost = new Map<string, { entry: HistoryEntry; score: number }>();
    for (const e of this.history.get().values()) {
      let host: string;
      try {
        host = new URL(e.url).host;
      } catch {
        continue;
      }
      if (hidden.has(host)) continue;
      const age = (now - e.lastVisit) / DAY;
      const score = (e.visits + e.typed * 2) / (1 + age / 7);
      const prev = byHost.get(host);
      if (!prev) {
        byHost.set(host, { entry: e, score });
      } else {
        // Prefer the site's root page as the tile, and add up the host's visits.
        const better = new URL(e.url).pathname.length < new URL(prev.entry.url).pathname.length;
        byHost.set(host, { entry: better ? e : prev.entry, score: prev.score + score });
      }
    }
    return [...byHost.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.entry);
  }

  hideTopSite(url: string): void {
    try {
      const host = new URL(url).host;
      const stats = this.stats.get();
      if (!stats.hiddenTopSites.includes(host)) stats.hiddenTopSites.push(host);
      this.stats.changed();
    } catch {
      // not an URL: nothing to hide
    }
  }

  addBlocked(count: number): void {
    this.stats.get().totalBlocked += count;
    this.stats.changed();
  }

  /** Merges history from another browser; returns how many entries are new. */
  importHistory(
    entries: { url: string; title: string; visits: number; typed: number; lastVisit: number }[],
  ): number {
    const map = this.history.get();
    const cutoff = Date.now() - HISTORY_DAYS * DAY;
    let added = 0;
    for (const e of entries) {
      if (!/^https?:/i.test(e.url) || e.lastVisit < cutoff) continue;
      const prev = map.get(e.url);
      if (!prev) added++;
      map.set(e.url, {
        url: e.url,
        title: prev?.title || e.title,
        favicon: prev?.favicon ?? null,
        visits: Math.max(prev?.visits ?? 0, e.visits),
        typed: Math.max(prev?.typed ?? 0, e.typed),
        lastVisit: Math.max(prev?.lastVisit ?? 0, e.lastVisit),
      });
    }
    // Keep the map ordered by last visit (oldest first) and within the limit.
    const sorted = [...map.values()]
      .sort((a, b) => a.lastVisit - b.lastVisit)
      .slice(-HISTORY_LIMIT);
    map.clear();
    for (const e of sorted) map.set(e.url, e);
    this.history.changed();
    return added;
  }

  // ---- Bookmarks ----

  /** Bookmarks with an address, in every folder. */
  bookmarkLinks(): Bookmark[] {
    return linksOf(this.bookmarks.get());
  }

  bookmarkFor(url: string): Bookmark | undefined {
    return this.bookmarks.get().find((b) => !b.isFolder && b.url === url);
  }

  bookmarkChildren(parent: string | null): Bookmark[] {
    return childrenOf(this.bookmarks.get(), parent);
  }

  private newBookmark(fields: Pick<Bookmark, "url" | "title" | "parent" | "isFolder">): Bookmark {
    return {
      id: randomUUID(),
      favicon: null,
      created: Date.now(),
      ...fields,
      title: fields.title.slice(0, 512),
    };
  }

  /** A folder, or null for the bookmarks bar, if it exists. */
  private folderOrBar(parent: string | null): string | null {
    return parent !== null && this.bookmarks.get().some((b) => b.id === parent && b.isFolder)
      ? parent
      : null;
  }

  addBookmark(
    url: string,
    title: string,
    favicon: string | null,
    parent: string | null = null,
  ): Bookmark {
    const existing = this.bookmarkFor(url);
    if (existing) return existing;
    const b = {
      ...this.newBookmark({
        url,
        title: title || url,
        parent: this.folderOrBar(parent),
        isFolder: false,
      }),
      favicon,
    };
    this.bookmarks.set([...this.bookmarks.get(), b]);
    return b;
  }

  addBookmarkFolder(title: string, parent: string | null = null): Bookmark {
    const folder = this.newBookmark({
      url: "",
      title: title.trim() || "New folder",
      parent: this.folderOrBar(parent),
      isFolder: true,
    });
    this.bookmarks.set([...this.bookmarks.get(), folder]);
    return folder;
  }

  /** Adds bookmarks from another browser, folders and all (see mergeImported). */
  importBookmarks(nodes: ImportedNode[]): number {
    const { list, added } = mergeImported(this.bookmarks.get(), nodes, (fields) =>
      this.newBookmark(fields),
    );
    if (list.length !== this.bookmarks.get().length) this.bookmarks.set(list);
    return added;
  }

  /**
   * Renames, readdresses or moves a bookmark or folder; `parent` and `index`
   * move it (into that folder, to that place among what's there).
   */
  updateBookmark(
    id: string,
    patch: { title?: string; url?: string; parent?: string | null; index?: number },
  ): void {
    let list = [...this.bookmarks.get()];
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) return;
    const b = { ...list[i] };
    if (typeof patch.title === "string") b.title = patch.title.slice(0, 512);
    if (!b.isFolder && typeof patch.url === "string" && /^(https?|file|moon):/i.test(patch.url))
      b.url = patch.url;
    list[i] = b;
    if (patch.parent !== undefined || patch.index !== undefined) {
      const parent = patch.parent === undefined ? b.parent : patch.parent;
      const index =
        typeof patch.index === "number" && Number.isFinite(patch.index)
          ? patch.index
          : Number.MAX_SAFE_INTEGER;
      list = moveNode(list, id, parent, index) ?? list;
    }
    this.bookmarks.set(list);
  }

  /** Removes a bookmark, or a folder with everything in it. */
  removeBookmark(id: string): void {
    this.bookmarks.set(removeNode(this.bookmarks.get(), id));
  }

  // ---- Downloads ----

  saveDownload(info: DownloadInfo): void {
    const list = this.downloads.get().filter((d) => d.id !== info.id);
    this.downloads.set([{ ...info, paused: false }, ...list].slice(0, DOWNLOADS_LIMIT));
  }

  removeDownload(id: string): void {
    this.downloads.set(this.downloads.get().filter((d) => d.id !== id));
  }

  // ---- Site permissions ----

  permission(origin: string, kind: PermissionKind): "allow" | "deny" | undefined {
    return this.permissions.get()[origin]?.[kind];
  }

  setPermission(origin: string, kind: PermissionKind, decision: "allow" | "deny"): void {
    const map = this.permissions.get();
    map[origin] = { ...map[origin], [kind]: decision };
    this.permissions.changed();
  }

  listPermissions(): SiteSettingsEntry[] {
    return Object.entries(this.permissions.get()).flatMap(([origin, perms]) =>
      Object.entries(perms).map(([kind, decision]) => ({
        origin,
        kind: kind as PermissionKind,
        decision: decision,
      })),
    );
  }

  resetPermission(origin: string, kind?: PermissionKind): void {
    const map = this.permissions.get();
    if (!map[origin]) return;
    if (kind) delete map[origin][kind];
    if (!kind || Object.keys(map[origin]).length === 0) delete map[origin];
    this.permissions.changed();
  }
}
