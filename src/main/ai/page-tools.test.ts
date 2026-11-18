import { describe, expect, it } from "vitest";
import type { AiToolCall } from "@shared/ai-tools";
import type { TabGroupInfo } from "@shared/tab-groups";
import type { MoonWindow } from "../window";
import { PageTools } from "./page-tools";

interface FakeTab {
  id: number;
  title: string;
  url: string;
  pinned: boolean;
  groupId: number | null;
  closed: boolean;
  close(): void;
}

/** A window as the tab tools see it: its tabs, its groups, and what was asked of it. */
function fakeWindow() {
  const tab = (id: number, title: string, url: string, more: Partial<FakeTab> = {}): FakeTab => ({
    id,
    title,
    url,
    pinned: false,
    groupId: null,
    closed: false,
    close() {
      this.closed = true;
      win.tabs = win.tabs.filter((t) => t !== this);
    },
    ...more,
  });
  const groups: TabGroupInfo[] = [
    { id: 7, title: "Reading", color: "blue", collapsed: false },
    { id: 8, title: "", color: "red", collapsed: true },
  ];
  const win = {
    closed: false,
    activeId: 2,
    groups,
    tabs: [
      tab(1, "Mail", "https://mail.example/inbox", { pinned: true }),
      tab(2, "Moon phases", "https://moon.example/phases", { groupId: 7 }),
      tab(3, "Settings", "moon://settings/", { groupId: 7 }),
      tab(4, "", "https://tides.example/", { groupId: 8 }),
    ],
    tab: (id: number) => win.tabs.find((t) => t.id === id),
    group: (id: number | null) => groups.find((g) => g.id === id),
  };
  return win;
}

const toolsOf = (win: ReturnType<typeof fakeWindow>) => new PageTools(win as unknown as MoonWindow);
const run = (win: ReturnType<typeof fakeWindow>, call: AiToolCall) =>
  toolsOf(win).run(call, new AbortController().signal);

describe("the assistant's view of the tab strip", () => {
  it("lists the tabs with their groups and pins, then the groups", async () => {
    const outcome = await run(fakeWindow(), { name: "list_tabs" });
    expect(outcome.isError).toBe(false);
    expect(outcome.text.split("\n")).toEqual([
      "Tabs, in the order of the tab strip:",
      "[1] (pinned) “Mail” — https://mail.example/inbox",
      "[2] (shown, group 7) “Moon phases” — https://moon.example/phases",
      "[3] (group 7) a page of the browser itself (you can't read it, but you can group, move or close its tab)",
      "[4] (group 8) “untitled” — https://tides.example/",
      "Tab groups:",
      "group 7 “Reading” (blue): 2 tabs",
      "group 8 (unnamed) (red): 1 tab, collapsed",
    ]);
    // What Luma's own pages are called or show stays out of it.
    expect(outcome.text).not.toContain("Settings");
    expect(outcome.text).not.toContain("moon://");
  });

  it("says so when nothing is grouped", async () => {
    const win = fakeWindow();
    win.groups.length = 0;
    for (const tab of win.tabs) tab.groupId = null;
    expect((await run(win, { name: "list_tabs" })).text).toContain("There are no tab groups.");
  });

  it("tells the approval card the tabs' titles, Luma's own pages included", async () => {
    const tools = toolsOf(fakeWindow());
    expect(await tools.target({ name: "close_tabs", tabIds: [4, 3, 2] })).toMatchObject({
      site: "",
      titles: ["Moon phases", "Settings", ""],
    });
    expect(await tools.target({ name: "group_tabs", tabIds: [1], groupId: 8 })).toMatchObject({
      titles: ["Mail"],
      group: "the unnamed red group",
    });
    expect(await tools.target({ name: "rename_group", groupId: 7, color: "pink" })).toMatchObject({
      group: "the group “Reading”",
    });
    expect(await tools.target({ name: "close_tabs", tabIds: [2, 99] })).toBeNull();
  });
});

describe("closing tabs", () => {
  it("never closes the window's last tab", async () => {
    const win = fakeWindow();
    const all: AiToolCall = { name: "close_tabs", tabIds: [1, 2, 3, 4] };
    // Known before anyone is asked, and checked again when it runs.
    expect(toolsOf(win).objection(all)).toMatch(/would close the window/);
    const outcome = await run(win, all);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/Nothing was closed/);
    expect(win.tabs).toHaveLength(4);

    win.tabs = win.tabs.slice(0, 1);
    expect((await run(win, { name: "close_tabs", tabIds: [1] })).isError).toBe(true);
    expect(win.tabs).toHaveLength(1);
  });

  it("closes the tabs it was given, Luma's own pages too, and leaves the rest", async () => {
    const win = fakeWindow();
    expect(toolsOf(win).objection({ name: "close_tabs", tabIds: [3, 4] })).toBeNull();
    const outcome = await run(win, { name: "close_tabs", tabIds: [3, 4] });
    expect(outcome).toEqual({ text: "Closed 2 tabs.", isError: false });
    expect(win.tabs.map((t) => t.id)).toEqual([1, 2]);
  });

  it("does nothing at all when one of the tabs doesn't exist", async () => {
    const win = fakeWindow();
    const outcome = await run(win, { name: "close_tabs", tabIds: [3, 99] });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("There is no tab 99");
    expect(win.tabs).toHaveLength(4);
  });
});

describe("what can't be done in the tab strip", () => {
  it("is known before the person is asked", () => {
    const tools = toolsOf(fakeWindow());
    expect(tools.objection({ name: "group_tabs", tabIds: [2, 5], title: "New" })).toContain(
      "There is no tab 5",
    );
    expect(tools.objection({ name: "group_tabs", tabIds: [2], groupId: 9 })).toContain(
      "There is no group 9",
    );
    expect(tools.objection({ name: "ungroup_tabs", tabIds: [6] })).toContain("There is no tab 6");
    expect(tools.objection({ name: "move_tab", tabId: 6, position: 1 })).toContain("no tab 6");
    expect(tools.objection({ name: "rename_group", groupId: 9, title: "x" })).toContain(
      "There is no group 9",
    );
    expect(tools.objection({ name: "group_tabs", tabIds: [3, 1], title: "New" })).toBeNull();
    expect(tools.objection({ name: "rename_group", groupId: 8, title: "x" })).toBeNull();
    // The tools that work in a page fail by themselves.
    expect(tools.objection({ name: "click", ref: "e1", tabId: 99 })).toBeNull();
  });
});
