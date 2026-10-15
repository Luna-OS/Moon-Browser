// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { axoScript } from "./axo";
import { isPerplexity, PERPLEXITY_CSS } from "./theme";

describe("Perplexity in Moon's look", () => {
  it("is only for Perplexity, over HTTPS", () => {
    expect(isPerplexity("https://www.perplexity.ai/")).toBe(true);
    expect(isPerplexity("https://perplexity.ai/search/abc")).toBe(true);
    expect(isPerplexity("http://www.perplexity.ai/")).toBe(false);
    expect(isPerplexity("https://perplexity.ai.example.com/")).toBe(false);
    expect(isPerplexity("https://example.com/?perplexity.ai")).toBe(false);
  });

  it("recolours Perplexity's palettes", () => {
    expect(PERPLEXITY_CSS).toContain("--odin-dark-100: #110d29 !important");
    expect(PERPLEXITY_CSS).toContain("--shiva-dark-400: #b9aefb !important");
  });

  it("runs Axo on its own, once", () => {
    document.body.innerHTML = "<div><textarea></textarea><button>Suche</button></div>";
    // The script is serialised into the page: it may use nothing from outside.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- what the page does with it
    const run = new Function(axoScript()) as () => void;
    expect(run).not.toThrow();
    expect(run).not.toThrow();
    const hosts = Array.from(document.body.children).filter(
      (el) => el instanceof HTMLElement && el.style.zIndex === "2147483646",
    );
    expect(hosts).toHaveLength(1);
  });
});
