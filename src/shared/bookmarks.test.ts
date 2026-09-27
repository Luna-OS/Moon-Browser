import { describe, expect, it } from "vitest";
import {
  childrenOf,
  descendantsOf,
  folderChoices,
  mergeImported,
  moveNode,
  pathOf,
  removeNode,
  repairTree,
} from "./bookmarks";
import type { Bookmark } from "./types";

const link = (id: string, parent: string | null, url = `https://${id}.example/`): Bookmark => ({
  id,
  url,
  title: id,
  favicon: null,
  created: 0,
  parent,
  isFolder: false,
});
const folder = (id: string, parent: string | null): Bookmark => ({
  id,
  url: "",
  title: id,
  favicon: null,
  created: 0,
  parent,
  isFolder: true,
});

// The bar: a, Anime (b, New (c)), d
const tree = [
  link("a", null),
  folder("Anime", null),
  link("b", "Anime"),
  folder("New", "Anime"),
  link("c", "New"),
  link("d", null),
];
const ids = (list: Bookmark[]) => list.map((b) => b.id);

describe("bookmark folders", () => {
  it("lists a folder's contents in order", () => {
    expect(ids(childrenOf(tree, null))).toEqual(["a", "Anime", "d"]);
    expect(ids(childrenOf(tree, "Anime"))).toEqual(["b", "New"]);
    expect([...descendantsOf(tree, "Anime")].sort()).toEqual(["New", "b", "c"]);
  });

  it("moves into a folder, within one and back to the bar", () => {
    const into = moveNode(tree, "d", "Anime", 0)!;
    expect(ids(childrenOf(into, "Anime"))).toEqual(["d", "b", "New"]);
    expect(ids(childrenOf(into, null))).toEqual(["a", "Anime"]);
    const last = moveNode(tree, "a", "Anime", 99)!;
    expect(ids(childrenOf(last, "Anime"))).toEqual(["b", "New", "a"]);
    const back = moveNode(tree, "c", null, 1)!;
    expect(ids(childrenOf(back, null))).toEqual(["a", "c", "Anime", "d"]);
    expect(childrenOf(back, "New")).toEqual([]);
    expect(ids(childrenOf(moveNode(tree, "d", null, 0)!, null))).toEqual(["d", "a", "Anime"]);
  });

  it("never moves a folder into itself or into a bookmark", () => {
    expect(moveNode(tree, "Anime", "Anime", 0)).toBeNull();
    expect(moveNode(tree, "Anime", "New", 0)).toBeNull();
    expect(moveNode(tree, "a", "b", 0)).toBeNull();
    expect(moveNode(tree, "nope", null, 0)).toBeNull();
  });

  it("removes a folder with everything in it", () => {
    expect(ids(removeNode(tree, "Anime"))).toEqual(["a", "d"]);
    expect(ids(removeNode(tree, "c"))).toEqual(["a", "Anime", "b", "New", "d"]);
  });

  it("puts lost and looping entries back on the bar", () => {
    const broken = [
      link("lost", "gone"),
      link("in-link", "a"),
      link("a", null),
      folder("x", "y"),
      folder("y", "x"),
      link("z", "x"),
    ];
    const fixed = repairTree(broken);
    expect(fixed.find((b) => b.id === "lost")?.parent).toBeNull();
    expect(fixed.find((b) => b.id === "in-link")?.parent).toBeNull();
    // The loop is broken, and what was in it stays.
    const x = fixed.find((b) => b.id === "x")!;
    const y = fixed.find((b) => b.id === "y")!;
    expect(x.parent === null || y.parent === null).toBe(true);
    expect(fixed.find((b) => b.id === "z")?.parent).toBe("x");
    expect(repairTree(tree)).toEqual(tree);
  });

  it("offers every folder with its path, and knows a bookmark's", () => {
    expect(folderChoices(tree)).toEqual([
      { id: null, path: "Bookmarks bar" },
      { id: "Anime", path: "Anime" },
      { id: "New", path: "Anime / New" },
    ]);
    expect(pathOf(tree, "c")).toBe("Anime / New");
    expect(pathOf(tree, "a")).toBe("");
  });

  it("imports folders and all, without doubling what's there", () => {
    let n = 0;
    const make = (f: Pick<Bookmark, "url" | "title" | "parent" | "isFolder">): Bookmark => ({
      id: `new${++n}`,
      favicon: null,
      created: 0,
      ...f,
    });
    const nodes = [
      { kind: "url" as const, url: "https://a.example/", title: "a" },
      {
        kind: "folder" as const,
        title: "Anime",
        children: [
          { kind: "url" as const, url: "https://b.example/", title: "b" },
          { kind: "url" as const, url: "https://e.example/", title: "e" },
        ],
      },
      {
        kind: "folder" as const,
        title: "Project R",
        children: [{ kind: "url" as const, url: "https://r.example/", title: "" }],
      },
    ];
    const { list, added } = mergeImported(tree, nodes, make);
    // a and b are already there; e goes into the existing Anime, Project R is new.
    expect(added).toBe(2);
    expect(ids(childrenOf(list, "Anime"))).toEqual(["b", "New", "new1"]);
    const projectR = list.find((b) => b.title === "Project R")!;
    expect(projectR).toMatchObject({ isFolder: true, parent: null });
    expect(childrenOf(list, projectR.id)).toMatchObject([
      { url: "https://r.example/", title: "https://r.example/" },
    ]);
    // Importing the same again adds nothing.
    expect(mergeImported(list, nodes, make).added).toBe(0);
  });
});
