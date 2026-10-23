import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonStore } from "./store";

const saved = async (file: string) => {
  await vi.waitFor(() => expect(existsSync(file)).toBe(true));
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
};

describe("a JSON store", () => {
  afterEach(() => vi.useRealTimers());

  it("writes a change once things are quiet", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const file = join(mkdtempSync(join(tmpdir(), "moon-store-")), "value.json");
    const store = JsonStore.load(file, (raw) => (typeof raw === "number" ? raw : 0));
    store.set(1);
    vi.advanceTimersByTime(900);
    store.set(2);
    vi.advanceTimersByTime(900);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();
    expect(await saved(file)).toBe(2);
  });

  it("doesn't put a write off forever while changes keep coming", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const file = join(mkdtempSync(join(tmpdir(), "moon-store-")), "value.json");
    const store = JsonStore.load(file, (raw) => (typeof raw === "number" ? raw : 0));
    // A change every half second, as from a page whose title ticks.
    for (let i = 1; i <= 20; i++) {
      store.set(i);
      vi.advanceTimersByTime(500);
    }
    vi.useRealTimers();
    expect(await saved(file)).toBeGreaterThanOrEqual(19);
  });
});
