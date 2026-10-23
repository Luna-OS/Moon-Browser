// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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

  it("draws the bubble of the answer Axo says", () => {
    expect(PERPLEXITY_CSS).toContain('[data-moon-axo="right"]');
    expect(PERPLEXITY_CSS).toContain("[data-moon-axo][data-moon-axo-talking]");
  });

  it("sits Axo beside the answer on a thread", () => {
    // A thread: a narrow answer column, the follow-up box at the bottom.
    document.body.innerHTML = `
      <main>
        <div id="markdown-content-0"><div class="prose"><p>An earlier answer.</p></div></div>
        <div id="markdown-content-1"><div class="prose"><p>The latest answer.</p></div></div>
        <div class="box"><textarea></textarea><button>Suche</button></div>
      </main>`;
    const rects = new Map<Element | null, [number, number, number, number]>([
      [document.querySelectorAll(".prose")[0], [300, -400, 1000, -100]],
      [document.querySelectorAll(".prose")[1], [300, 100, 1000, 500]],
      [document.querySelector("textarea"), [300, 700, 1000, 740]],
      [document.querySelector(".box"), [290, 690, 1010, 780]],
    ]);
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const [left, top, right, bottom] = rects.get(this) ?? [0, 0, 0, 0];
      return { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
    });
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    delete (window as Window & { __moonAxo?: boolean }).__moonAxo;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- what the page does with it
      const run = new Function(axoScript()) as () => void;
      expect(run).not.toThrow();
      expect(run).not.toThrow();
      const hosts = Array.from(document.body.children).filter(
        (el) => el instanceof HTMLElement && el.style.zIndex === "2147483646",
      );
      expect(hosts).toHaveLength(1);
      // The answer in view is the one Axo says; the earlier one is scrolled away.
      const [earlier, latest] = Array.from(document.querySelectorAll(".prose"));
      expect(latest.getAttribute("data-moon-axo")).toBe("right");
      expect(earlier.hasAttribute("data-moon-axo")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
