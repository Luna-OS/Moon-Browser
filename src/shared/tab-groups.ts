/**
 * Tab groups, like Chrome's: tabs side by side under a coloured label that
 * can be named and collapsed. Kept as plain rules here so the main process
 * and the tests agree on them.
 */

/** Chrome's group colours (the names extensions use in chrome.tabGroups). */
export const GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export interface TabGroupInfo {
  id: number;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

export function isGroupColor(v: unknown): v is GroupColor {
  return typeof v === "string" && (GROUP_COLORS as readonly string[]).includes(v);
}

/** The colour for a new group: the first one no group in the window uses yet. */
export function nextGroupColor(used: readonly GroupColor[]): GroupColor {
  // Grey last: it reads as "no colour".
  const order: GroupColor[] = [...GROUP_COLORS.slice(1), "grey"];
  return order.find((c) => !used.includes(c)) ?? order[used.length % order.length];
}

/**
 * The group a tab belongs to after it was moved to `index` among `groups`
 * (the group IDs of all tabs, in order, with the moved tab already in its
 * new place): dropped between two tabs of one group it joins that group;
 * dropped away from its own group it leaves it. Groups stay in one piece.
 */
export function groupAfterMove(groups: readonly (number | null)[], index: number): number | null {
  const own = groups[index] ?? null;
  const left = index > 0 ? groups[index - 1] : null;
  const right = index < groups.length - 1 ? groups[index + 1] : null;
  if (left !== null && left === right) return left;
  if (own !== null && (left === own || right === own)) return own;
  return null;
}

/** Group titles are short labels: one line, at most 60 characters. */
export function cleanGroupTitle(title: unknown): string {
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 60) : "";
}
