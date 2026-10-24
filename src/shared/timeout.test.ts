import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("passes a timely answer through", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 0)).resolves.toBe(7);
  });

  it("gives the fallback when the answer never comes or fails", async () => {
    vi.useFakeTimers();
    const never = withTimeout(new Promise<number>(() => undefined), 300, -1);
    vi.advanceTimersByTime(300);
    await expect(never).resolves.toBe(-1);
    vi.useRealTimers();
    await expect(withTimeout(Promise.reject(new Error("x")), 50, -2)).resolves.toBe(-2);
  });
});
