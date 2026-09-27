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

/**
 * Where a whole group can go: `index` is the place of its first tab once
 * moved, counted among the other tabs (`rest`, their group IDs in order, the
 * first `pinnedCount` pinned). A group never lands among the pinned tabs or
 * inside another group; `null` if it would.
 */
export function groupMoveIndex(
  rest: readonly (number | null)[],
  pinnedCount: number,
  index: number,
): number | null {
  const at = index === -1 ? rest.length : index;
  if (!Number.isInteger(at) || at < pinnedCount || at > rest.length) return null;
  const left = at > 0 ? rest[at - 1] : null;
  return left !== null && left === rest[at] ? null : at;
}

/**
 * Like groupMoveIndex, but for dragging: a group dropped among the pinned
 * tabs goes right after them, one dropped inside another group moves on to
 * that group's nearer end.
 */
export function groupDropIndex(
  rest: readonly (number | null)[],
  pinnedCount: number,
  index: number,
): number {
  const at = Math.max(pinnedCount, Math.min(rest.length, Math.round(index)));
  const inside = at > 0 ? rest[at - 1] : null;
  if (inside === null || inside !== rest[at]) return at;
  let start = at;
  while (start > 0 && rest[start - 1] === inside) start--;
  let end = at;
  while (end < rest.length && rest[end] === inside) end++;
  return at - start <= end - at ? start : end;
}

/** Group titles are short labels: one line, at most 60 characters. */
export function cleanGroupTitle(title: unknown): string {
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 60) : "";
}
