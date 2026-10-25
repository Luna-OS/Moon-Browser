import { describe, expect, it } from "vitest";
import { declaresClipboard } from "./clipboard-commands";

describe("copying and pasting for extensions", () => {
  it("is put in only for extensions that declare clipboard access", () => {
    expect(declaresClipboard({ optional_permissions: ["clipboardRead", "clipboardWrite"] })).toBe(
      true,
    );
    expect(declaresClipboard({ permissions: ["clipboardWrite"] })).toBe(true);
    expect(
      declaresClipboard({ permissions: ["storage"], optional_permissions: "clipboardRead" }),
    ).toBe(false);
    expect(declaresClipboard({})).toBe(false);
  });
});
