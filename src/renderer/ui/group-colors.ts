import type { GroupColor } from "@shared/tab-groups";

/** Chrome's group colours, softened for the night sky (they read on light too). */
export const GROUP_HEX: Record<GroupColor, string> = {
  grey: "#a3a9c2",
  blue: "#8ab4ff",
  red: "#ff8f8f",
  yellow: "#f3d36b",
  green: "#82d9a6",
  pink: "#f7a2cf",
  purple: "#b9aefb",
  cyan: "#7fdbe6",
  orange: "#f6b073",
};

export const GROUP_COLOR_NAMES: Record<GroupColor, string> = {
  grey: "Grey",
  blue: "Blue",
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  pink: "Pink",
  purple: "Purple",
  cyan: "Cyan",
  orange: "Orange",
};
