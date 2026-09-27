/**
 * Bookmarks and their folders, kept as one list: every entry names the
 * folder it's in (`parent`, null for the bookmarks bar itself), and the
 * order of the list is the order within each folder. Pure, so it's tested.
 */
import type { Bookmark } from "./types";
import type { ImportedNode } from "./import";

/** A folder's contents (the bookmarks bar's for null), in order. */
export function childrenOf(list: readonly Bookmark[], parent: string | null): Bookmark[] {
  return list.filter((b) => b.parent === parent);
}

/** Bookmarks with an address — no folders. */
export function linksOf(list: readonly Bookmark[]): Bookmark[] {
  return list.filter((b) => !b.isFolder);
}

/** The IDs of everything inside a folder, however deep. */
export function descendantsOf(list: readonly Bookmark[], id: string): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const b of list)
      if (b.parent !== null && frontier.includes(b.parent) && !out.has(b.id)) {
        out.add(b.id);
        if (b.isFolder) next.push(b.id);
      }
    frontier = next;
  }
  return out;
}

/**
 * The list as it may be kept: entries in a folder that doesn't exist (or
 * isn't a folder) go to the bookmarks bar, and so do folders caught in a
 * loop.
 */
export function repairTree(list: readonly Bookmark[]): Bookmark[] {
  const folders = new Set(list.filter((b) => b.isFolder).map((b) => b.id));
  const byId = new Map(list.map((b) => [b.id, b]));
  const out = list.map((b) =>
    b.parent !== null && !folders.has(b.parent) ? { ...b, parent: null } : b,
  );
  const fixed = new Map(out.map((b) => [b.id, b]));
  for (const b of out) {
    const seen = new Set<string>([b.id]);
    let parent = b.parent;
    while (parent !== null) {
      if (seen.has(parent)) {
        fixed.set(b.id, { ...b, parent: null });
        break;
      }
      seen.add(parent);
      parent = (fixed.get(parent) ?? byId.get(parent))?.parent ?? null;
    }
  }
  return out.map((b) => fixed.get(b.id) ?? b);
}

/**
 * Moves an entry into `parent` (null: the bookmarks bar), to position
 * `index` among what's there (the end if past it). Null if it can't go
 * there: a folder can't go into itself.
 */
export function moveNode(
  list: readonly Bookmark[],
  id: string,
  parent: string | null,
  index: number,
): Bookmark[] | null {
  const node = list.find((b) => b.id === id);
  if (!node) return null;
  if (parent !== null) {
    const target = list.find((b) => b.id === parent);
    if (!target?.isFolder || parent === id || descendantsOf(list, id).has(parent)) return null;
  }
  const rest = list.filter((b) => b.id !== id);
  const siblings = childrenOf(rest, parent);
  const moved = { ...node, parent };
  const at = Math.max(0, Math.floor(index));
  if (at < siblings.length) {
    rest.splice(rest.indexOf(siblings[at]), 0, moved);
  } else if (siblings.length) {
    rest.splice(rest.indexOf(siblings[siblings.length - 1]) + 1, 0, moved);
  } else {
    rest.push(moved);
  }
  return rest;
}

/** Removes an entry, and for a folder everything in it. */
export function removeNode(list: readonly Bookmark[], id: string): Bookmark[] {
  const gone = descendantsOf(list, id);
  gone.add(id);
  return list.filter((b) => !gone.has(b.id));
}

/** Every folder with its path ("Anime / New"), for choosing one; the bar first. */
export function folderChoices(list: readonly Bookmark[]): { id: string | null; path: string }[] {
  const out: { id: string | null; path: string }[] = [{ id: null, path: "Bookmarks bar" }];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    if (depth > 32) return;
    for (const f of childrenOf(list, parent).filter((b) => b.isFolder)) {
      const path = prefix ? `${prefix} / ${f.title}` : f.title;
      out.push({ id: f.id, path });
      walk(f.id, path, depth + 1);
    }
  };
  walk(null, "", 0);
  return out;
}

/** A bookmark's folder path ("Anime / New"), "" on the bar. */
export function pathOf(list: readonly Bookmark[], id: string): string {
  const byId = new Map(list.map((b) => [b.id, b]));
  const names: string[] = [];
  let parent = byId.get(id)?.parent ?? null;
  for (let i = 0; parent !== null && i < 32; i++) {
    const folder = byId.get(parent);
    if (!folder) break;
    names.unshift(folder.title);
    parent = folder.parent;
  }
  return names.join(" / ");
}

/**
 * Adds bookmarks from another browser, folders and all: a folder that's
 * already there (same name, same place) is filled rather than doubled, and
 * a bookmark already in its folder isn't added again. How many bookmarks
 * were added, too.
 */
export function mergeImported(
  list: readonly Bookmark[],
  nodes: readonly ImportedNode[],
  make: (fields: Pick<Bookmark, "url" | "title" | "parent" | "isFolder">) => Bookmark,
): { list: Bookmark[]; added: number } {
  const out = [...list];
  let added = 0;
  const merge = (items: readonly ImportedNode[], parent: string | null, depth: number) => {
    if (depth > 32) return;
    for (const item of items) {
      if (item.kind === "folder") {
        const existing = out.find(
          (b) => b.isFolder && b.parent === parent && b.title === item.title,
        );
        const folder = existing ?? make({ url: "", title: item.title, parent, isFolder: true });
        if (!existing) out.push(folder);
        merge(item.children, folder.id, depth + 1);
      } else if (!out.some((b) => !b.isFolder && b.parent === parent && b.url === item.url)) {
        out.push(make({ url: item.url, title: item.title || item.url, parent, isFolder: false }));
        added++;
      }
    }
  };
  merge(nodes, null, 0);
  return { list: out, added };
}
