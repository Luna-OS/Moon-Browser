/**
 * Axo, the pixel axolotl from Moon Code, on Perplexity: sits on the search
 * box, blinks while it waits, types on its moon laptop while you type,
 * cheers when you ask, and on the first visit introduces itself and shows
 * how the search works. Click it for the tour again or a tip.
 *
 * On a thread, Axo "says" the answers: it sits beside the answer in view,
 * which theme.ts draws as a speech bubble (the `data-moon-axo` attribute)
 * with a little tail to Axo, talks while the answer is written, hops when
 * it is done, and travels along as you scroll or ask on.
 *
 * `axoPage` runs in an isolated world of the page (src/main/tab.ts), so it
 * is serialised with Function.prototype.toString: it must not use anything
 * from outside its own body but its argument. Everything it draws lives in
 * a closed shadow root, untouched by the page's styles and scripts.
 */
import { AXOLOTL_COLORS, AXOLOTL_FRAMES, type AxoMood } from "./axo-sprite";

interface Sprite {
  frames: Record<AxoMood, readonly (readonly string[])[]>;
  colors: Record<string, string>;
}

/** The script injected into Perplexity's pages. */
export function axoScript(): string {
  const sprite: Sprite = { frames: AXOLOTL_FRAMES, colors: AXOLOTL_COLORS };
  return `(${axoPage.toString()})(${JSON.stringify(sprite)});`;
}

function axoPage(sprite: Sprite): void {
  const w = window as Window & { __moonAxo?: boolean };
  if (w.__moonAxo) return;
  w.__moonAxo = true;

  const de = (document.documentElement.lang || navigator.language || "").startsWith("de");
  const t = (german: string, english: string) => (de ? german : english);
  const SEEN = "moon-axo-introduced";

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
<style>
  :host { all: initial; }
  .axo {
    position: fixed; width: 104px; height: 80px; pointer-events: auto; cursor: pointer;
    transition: left .5s cubic-bezier(.3,1.4,.5,1), top .5s cubic-bezier(.3,1.4,.5,1), opacity .4s;
  }
  .axo.follow {
    transition: left .45s cubic-bezier(.3,1.2,.5,1), top .35s cubic-bezier(.2,.9,.3,1), opacity .4s;
  }
  .axo.small { width: 78px; height: 60px; }
  .axo[hidden] { display: block; opacity: 0; pointer-events: none; }
  .me {
    display: block; overflow: visible; image-rendering: pixelated;
    filter: drop-shadow(0 4px 10px rgb(185 174 251 / .4));
    animation: float 3.4s ease-in-out infinite;
  }
  .axo.small .me { width: 78px; height: 60px; }
  .axo[data-mood="work"] .me {
    animation: bob .56s steps(2, jump-none) infinite;
    filter: drop-shadow(0 4px 12px rgb(127 227 198 / .45));
  }
  .axo[data-mood="talk"] .me {
    animation: bob .9s ease-in-out infinite;
    filter: drop-shadow(0 4px 12px rgb(185 174 251 / .55));
  }
  .axo[data-mood="done"] .me { animation: hop .45s ease-out 3; }
  @keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
  @keyframes bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
  @keyframes hop { 0%,100% { transform: translateY(0) } 45% { transform: translateY(-10px) } }

  /* The tail of the answer's speech bubble (theme.ts), pointing at Axo. */
  .tail {
    position: absolute; left: -16px; width: 16px; height: 28px; display: none;
    pointer-events: none; opacity: .6; transition: opacity .3s;
  }
  .axo.small .tail { left: -12px; width: 12px; height: 21px; }
  .axo[data-side="left"] .tail { left: auto; right: -16px; transform: scaleX(-1); }
  .axo.small[data-side="left"] .tail { right: -12px; }
  .axo.follow[data-tail] .tail { display: block; }
  .axo[data-talking] .tail { opacity: .95; }
  @media (prefers-reduced-motion: reduce) {
    .me { animation: none !important; }
    .axo, .axo.follow { transition: opacity .4s; }
  }

  .bubble {
    position: fixed; max-width: 290px; padding: 12px 14px; pointer-events: auto;
    border-radius: 14px; border: 1px solid rgb(185 174 251 / .3);
    background: linear-gradient(180deg, rgb(29 23 66 / .97), rgb(20 16 48 / .97));
    box-shadow: 0 14px 40px -12px rgb(0 0 0 / .6), 0 0 40px -18px rgb(185 174 251 / .6);
    color: #f4f1ff; font: 13.5px/1.5 system-ui, "Segoe UI", sans-serif;
    opacity: 0; transform: translateY(6px) scale(.97); transition: opacity .25s, transform .25s;
  }
  .bubble.show { opacity: 1; transform: none; }
  .bubble b { color: #d6cffd; font-weight: 600; }
  .bubble .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
  .bubble .step { margin-right: auto; align-self: center; font-size: 11.5px; color: rgb(244 241 255 / .55); }
  .bubble button {
    font: 600 12.5px system-ui, "Segoe UI", sans-serif; cursor: pointer; border-radius: 8px;
    padding: 5px 11px; border: 1px solid rgb(185 174 251 / .3); background: transparent; color: #d6cffd;
  }
  .bubble button.primary { border: 0; background: linear-gradient(135deg, #d6cffd, #a597f5); color: #0b0920; }
  .bubble button:hover { filter: brightness(1.1); }
  .ring {
    position: fixed; border-radius: 12px; pointer-events: none; opacity: 0;
    box-shadow: 0 0 0 2px #d6cffd, 0 0 0 6px rgb(185 174 251 / .25), 0 0 24px 4px rgb(185 174 251 / .35);
    transition: all .35s cubic-bezier(.3,1.3,.5,1);
  }
  .ring.show { opacity: 1; }
</style>
<div class="ring"></div>
<div class="bubble" role="dialog" aria-live="polite"></div>
<div class="axo" title="Axo" role="button" aria-label="Axo" hidden>
  <svg class="tail" viewBox="0 0 4 7" width="16" height="28" shape-rendering="crispEdges" aria-hidden="true">
    <path fill="rgb(185 174 251 / .22)" d="M0 1h1v5h-1zM1 2h1v3h-1zM2 3h1v1h-1z"/>
    <path fill="#b9aefb" d="M0 0h1v1h-1zM1 1h1v1h-1zM2 2h1v1h-1zM3 3h1v1h-1zM2 4h1v1h-1zM1 5h1v1h-1zM0 6h1v1h-1z"/>
  </svg>
  <svg class="me" viewBox="0 0 26 20" width="104" height="80" shape-rendering="crispEdges" aria-hidden="true"></svg>
</div>`;
  (document.body ?? document.documentElement).appendChild(host);

  const axo = root.querySelector<HTMLElement>(".axo")!;
  const svg = root.querySelector<SVGSVGElement>(".me")!;
  const tail = root.querySelector<SVGSVGElement>(".tail")!;
  const bubble = root.querySelector<HTMLElement>(".bubble")!;
  const ring = root.querySelector<HTMLElement>(".ring")!;

  const visible = (el: Element | null): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };

  /** Perplexity's text box: the largest visible editable field. */
  const input = (): HTMLElement | null => {
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(
        '#ask-input, textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
      ),
    ).filter(visible);
    fields.sort(
      (a, b) =>
        b.getBoundingClientRect().width * b.getBoundingClientRect().height -
        a.getBoundingClientRect().width * a.getBoundingClientRect().height,
    );
    return fields[0] ?? null;
  };

  /** The rounded box around the text box and its buttons. */
  const composer = (): HTMLElement | null => {
    const field = input();
    if (!field) return null;
    let el: HTMLElement | null = field;
    let best: HTMLElement = field;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width > innerWidth * 0.9) break;
      if (r.height > 260) break;
      best = el;
      if (parseFloat(getComputedStyle(el).borderRadius) >= 12 && r.height >= 80) return el;
    }
    return best;
  };

  /** A button of the composer, by its label in either language. */
  const button = (...labels: string[]): HTMLElement | null => {
    const box = composer();
    if (!box) return null;
    const words = labels.map((l) => l.toLowerCase());
    for (const el of Array.from(box.querySelectorAll<HTMLElement>("button, [role=button]"))) {
      const text = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`.toLowerCase();
      if (words.some((w) => text.includes(w)) && visible(el)) return el;
    }
    return null;
  };

  // ---- Axo beside the answer it says ----

  /** Has it any text yet (without reading all of it, every frame)? */
  const hasText = (el: HTMLElement) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode())
      if (node.nodeValue?.trim()) return true;
    return false;
  };
  /** Perplexity's answers, top to bottom: their rendered markdown. */
  const answers = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('.prose, [id^="markdown-content"]')).filter(
      (el) => {
        if (el.isContentEditable || el.closest("textarea, [contenteditable=true]")) return false;
        if (el.querySelector("textarea, [contenteditable=true]")) return false;
        // One element per answer: a .prose stands for the markdown around it.
        if (el.parentElement?.closest(".prose")) return false;
        if (!el.classList.contains("prose") && el.querySelector(".prose")) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 200 && r.height > 0 && hasText(el);
      },
    );

  /** The part of the window the thread scrolls in (Perplexity scrolls an inner element). */
  const scrollers = new WeakMap<HTMLElement, HTMLElement>();
  const viewOf = (el: HTMLElement) => {
    let box = scrollers.get(el);
    for (let p = el.parentElement; !box && p && p !== document.body; p = p.parentElement) {
      if (/auto|scroll|overlay/.test(getComputedStyle(p).overflowY)) {
        if (p.scrollHeight > p.clientHeight + 1) scrollers.set(el, (box = p));
      }
    }
    const width = document.documentElement.clientWidth || innerWidth;
    if (!box) return { left: 0, top: 0, right: width, bottom: innerHeight };
    const r = box.getBoundingClientRect();
    return {
      left: Math.max(0, r.left + box.clientLeft),
      top: Math.max(0, r.top + box.clientTop),
      right: Math.min(width, r.left + box.clientLeft + box.clientWidth),
      bottom: Math.min(innerHeight, r.top + box.clientTop + box.clientHeight),
    };
  };

  /** theme.ts draws the bubble this far around the answer (its outline-offset). */
  const PAD = 10;
  interface Spot {
    el: HTMLElement;
    side: "left" | "right";
    size: number;
    left: number;
    top: number;
    tail: number | null;
  }
  /**
   * Where Axo sits beside the answer in view (or the one being written):
   * in the margin next to it, with its top edge sticking to the top of the
   * answer while that scrolls by. Null when the margins are too narrow.
   */
  const spotBeside = (
    list: HTMLElement[],
    writing: HTMLElement | null,
    box: HTMLElement | null,
  ): Spot | null => {
    const view = viewOf(list[list.length - 1]);
    const b = box?.getBoundingClientRect();
    const bottom = b && b.top > view.top + 120 ? Math.min(view.bottom, b.top) : view.bottom;
    let el = list[0];
    let most = -Infinity;
    for (const each of list) {
      const r = each.getBoundingClientRect();
      // How much of it shows; when none does, how far away it is.
      const seen = Math.min(r.bottom, bottom) - Math.max(r.top, view.top);
      if (seen > most || (each === writing && seen > 40)) [el, most] = [each, seen];
    }
    const r = el.getBoundingClientRect();
    for (const size of [4, 3]) {
      const w = 26 * size;
      const h = 20 * size;
      const tail = 4 * size; // the bubble's tail: 4 × 7 of Axo's pixels
      const need = PAD + tail + w + 6;
      const side =
        view.right - r.right >= need ? "right" : r.left - view.left >= need ? "left" : null;
      if (!side) continue;
      const lo = view.top + 12;
      const hi = bottom - h - 10;
      if (hi < lo) return null;
      // Next to the line being written, else level with the answer's top.
      let want = el === writing ? r.bottom - h + 8 : r.top - 4;
      want = Math.min(Math.max(want, lo, r.top - 4), Math.max(r.top - 4, r.bottom - h + 8));
      const top = Math.round(Math.max(lo, Math.min(hi, want)));
      const mouth = top + 10.5 * size;
      const shows = most > 24 && mouth > r.top + 6 && mouth < r.bottom - 6;
      return {
        el,
        side,
        size,
        left: Math.round(side === "right" ? r.right + PAD + tail : r.left - PAD - tail - w),
        top,
        tail: shows ? 7 * size : null, // level with Axo's mouth
      };
    }
    return null;
  };

  /** The answer Axo says: theme.ts draws it as Axo's speech bubble. */
  let said: HTMLElement | null = null;
  const sayAnswer = (el: HTMLElement | null, side = "", talking = false) => {
    if (said && said !== el) {
      said.setAttribute("data-moon-axo", "off");
      said.removeAttribute("data-moon-axo-talking");
    }
    said = el;
    if (!el) return;
    if (el.getAttribute("data-moon-axo") !== side) el.setAttribute("data-moon-axo", side);
    if (el.hasAttribute("data-moon-axo-talking") !== talking)
      el.toggleAttribute("data-moon-axo-talking", talking);
  };

  /** Is the latest answer still being written: its text changed just now. */
  let known = -1;
  let length = 0;
  let changes = 0;
  let changedAt = 0;
  let recheck = 0;
  /** The question just asked, until its answer appears. */
  let asked: { count: number; until: number } | null = null;
  let typingUntil = 0;
  /** Axo waits on the search box until the answer appears, then goes to it. */
  const ask = () => {
    asked = { count: answers().length, until: performance.now() + 30000 };
    window.setTimeout(schedule, 30050);
  };
  const typed = (field: HTMLElement) =>
    (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
      ? field.value
      : (field.textContent ?? "")
    ).trim() !== "";

  // ---- Placing Axo: beside the answer, or on the search box ----

  const place = () => {
    if (!host.isConnected) (document.body ?? document.documentElement).appendChild(host);
    const now = performance.now();
    const box = composer();
    const field = input();
    const list = answers();
    const latest = list[list.length - 1] ?? null;

    const size = latest?.textContent?.length ?? 0;
    if (list.length !== known) {
      changes = asked && list.length > asked.count ? 1 : 0;
      if (changes) asked = null;
      known = list.length;
      length = size;
      changedAt = now;
    } else if (size !== length) {
      length = size;
      changes++;
      changedAt = now;
    }
    const streaming = !!latest && changes >= 2 && now - changedAt < 900;
    if (streaming) {
      asked = null;
      clearTimeout(recheck);
      recheck = window.setTimeout(schedule, 950);
    }
    if (asked && now > asked.until) asked = null;

    // While you write a question, Axo comes back to the search box.
    const writing =
      !!field &&
      (now < typingUntil || !!asked || (field.contains(document.activeElement) && typed(field)));
    const spot = list.length && !writing ? spotBeside(list, streaming ? latest : null, box) : null;
    const talking = !!spot && streaming && spot.el === latest && spot.tail !== null;

    if (spot) {
      axo.hidden = false;
      axo.classList.add("follow");
      axo.classList.toggle("small", spot.size === 3);
      axo.dataset.side = spot.side;
      axo.style.left = `${spot.left}px`;
      axo.style.top = `${spot.top}px`;
      axo.toggleAttribute("data-tail", spot.tail !== null);
      axo.toggleAttribute("data-talking", talking);
      if (spot.tail !== null) tail.style.top = `${spot.tail}px`;
      sayAnswer(spot.tail !== null ? spot.el : null, spot.side, talking);
    } else {
      sayAnswer(null);
      axo.classList.remove("follow", "small");
      axo.removeAttribute("data-tail");
      axo.removeAttribute("data-talking");
      // On a thread too narrow for Axo beside the answers, it only shows
      // while you write (or talk with it), so it never covers an answer.
      if (!box || (list.length && !writing && !bubble.classList.contains("show"))) {
        axo.hidden = true;
      } else {
        const anchor = box.getBoundingClientRect();
        axo.hidden = false;
        axo.style.left = `${Math.round(anchor.right - 104 - 22)}px`;
        axo.style.top = `${Math.round(anchor.top - 80 + 14)}px`;
      }
    }

    // Talks while it says the answer, and hops once when it is done.
    if (talking && moodNow !== "talk" && moodNow !== "done") setMood("talk");
    else if (!talking && moodNow === "talk") setMood(streaming || !spot ? "idle" : "done");

    if (bubble.classList.contains("show")) placeBubble();
  };
  const placeBubble = () => {
    const l = axo.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let left = l.left + l.width / 2 - b.width + 30;
    left = Math.max(12, Math.min(left, innerWidth - b.width - 12));
    let top = l.top - b.height - 10;
    if (top < 8) top = l.bottom + 10;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  };
  const highlight = (el: HTMLElement | null) => {
    if (!el) {
      ring.classList.remove("show");
      return;
    }
    const r = el.getBoundingClientRect();
    ring.style.left = `${r.left - 4}px`;
    ring.style.top = `${r.top - 4}px`;
    ring.style.width = `${r.width + 8}px`;
    ring.style.height = `${r.height + 8}px`;
    ring.classList.add("show");
  };

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
      if (current && ring.classList.contains("show")) highlight(current.target());
    });
  };
  // Answers stream in as text changes; Perplexity scrolls an inner element.
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  addEventListener("resize", schedule);
  document.addEventListener("scroll", schedule, { capture: true, passive: true });
  document.addEventListener("focusin", schedule, true);
  document.addEventListener("focusout", schedule, true);

  // ---- Talking ----

  // ---- Axo's pixel frames: blinking, typing, cheering ----

  const SVG = "http://www.w3.org/2000/svg";
  const draw = (frame: readonly string[]) => {
    svg.textContent = "";
    frame.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        let end = x + 1;
        while (end < row.length && row[end] === ch) end++;
        const fill = sprite.colors[ch];
        if (fill) {
          const r = document.createElementNS(SVG, "rect");
          r.setAttribute("x", String(x));
          r.setAttribute("y", String(y));
          r.setAttribute("width", String(end - x));
          r.setAttribute("height", "1");
          r.setAttribute("fill", fill);
          svg.appendChild(r);
        }
        x = end;
      }
    });
  };
  let moodNow: AxoMood = "idle";
  let timer = 0;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const setMood = (next: AxoMood) => {
    moodNow = next;
    axo.dataset.mood = next;
    clearTimeout(timer);
    const frames = sprite.frames[next];
    draw(frames[0]);
    if (still) return;
    if (next === "work") {
      let i = 0;
      const type = () => {
        i = (i + 1) % frames.length;
        draw(frames[i]);
        timer = window.setTimeout(type, 280);
      };
      timer = window.setTimeout(type, 280);
    } else if (next === "idle" && frames.length > 1) {
      const blink = () => {
        draw(frames[1]);
        timer = window.setTimeout(() => {
          draw(frames[0]);
          timer = window.setTimeout(blink, 3200 + Math.random() * 2400);
        }, 160);
      };
      timer = window.setTimeout(blink, 2400);
    } else if (next === "talk") {
      // Mouth open, shut, wide – in no fixed rhythm, like speech.
      let i = 0;
      const talk = () => {
        i = (i + 1 + Math.floor(Math.random() * (frames.length - 1))) % frames.length;
        draw(frames[i]);
        timer = window.setTimeout(talk, 120 + Math.random() * 160);
      };
      timer = window.setTimeout(talk, 140);
    } else if (next === "done") {
      timer = window.setTimeout(() => setMood("idle"), 1600);
    }
  };
  setMood("idle");

  const say = (
    html: string,
    actions: { label: string; primary?: boolean; run: () => void }[],
    step?: string,
  ) => {
    bubble.innerHTML = `<div>${html}</div><div class="row">${step ? `<span class="step">${step}</span>` : ""}</div>`;
    const row = bubble.querySelector(".row")!;
    for (const a of actions) {
      const b = document.createElement("button");
      b.textContent = a.label;
      if (a.primary) b.className = "primary";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        a.run();
      });
      row.appendChild(b);
    }
    bubble.classList.add("show");
    placeBubble();
    requestAnimationFrame(placeBubble);
  };
  const quiet = () => {
    bubble.classList.remove("show");
    highlight(null);
    current = null;
  };

  // ---- The tour: what each part of the search does ----

  interface Step {
    target: () => HTMLElement | null;
    text: string;
  }
  const steps: Step[] = [
    {
      target: input,
      text: t(
        "Hier tippst du deine <b>Frage</b> – ganz normal, so wie du sie einer Person stellen würdest. Perplexity sucht im Netz und antwortet mit <b>Quellen</b>, die du anklicken kannst.",
        "Type your <b>question</b> here – just as you'd ask a person. Perplexity searches the web and answers with <b>sources</b> you can click.",
      ),
    },
    {
      target: () => button("suche", "search"),
      text: t(
        "<b>Suche</b> ist der Modus: schnelle Antworten mit Quellen. Über den kleinen Pfeil kannst du gründlichere Modi wählen, z. B. für tiefe Recherchen.",
        "<b>Search</b> is the mode: quick answers with sources. The small arrow offers more thorough modes, e.g. for deep research.",
      ),
    },
    {
      target: () => button("computer"),
      text: t(
        "<b>Computer</b> lässt Perplexity Aufgaben Schritt für Schritt für dich erledigen – etwa etwas vergleichen oder zusammentragen.",
        "<b>Computer</b> lets Perplexity carry out tasks for you step by step – comparing or gathering things.",
      ),
    },
    {
      target: () => button("modell", "model"),
      text: t(
        "Bei <b>Modell</b> wählst du, welche KI dir antwortet. Jede schreibt ein bisschen anders.",
        "<b>Model</b> picks which AI answers you. Each one writes a little differently.",
      ),
    },
    {
      target: () => button("diktier", "mikrofon", "dictat", "voice", "spracheingabe"),
      text: t(
        "Mit dem <b>Mikrofon</b> sprichst du deine Frage einfach ein, statt zu tippen.",
        "With the <b>microphone</b> you just say your question instead of typing it.",
      ),
    },
    {
      target: () => button("anhängen", "datei", "attach", "upload", "hinzufügen"),
      text: t(
        "Über das <b>+</b> hängst du Dateien oder Bilder an – Perplexity kann sie lesen und dazu antworten.",
        "The <b>+</b> attaches files or pictures – Perplexity reads them and answers about them.",
      ),
    },
  ];

  let current: Step | null = null;
  const tour = (from = 0) => {
    const available = steps.filter((s) => s.target());
    const show = (i: number) => {
      if (i >= available.length) {
        current = null;
        highlight(null);
        setMood("done");
        say(
          t(
            "Das war's! 🌙 Tipp: In Luma kannst du auch direkt in der <b>Adressleiste</b> suchen. Klick mich an, wenn du mich wieder brauchst.",
            "That's it! 🌙 Tip: in Luma you can also search right from the <b>address bar</b>. Click me whenever you need me.",
          ),
          [{ label: t("Danke, Axo!", "Thanks, Axo!"), primary: true, run: quiet }],
        );
        return;
      }
      current = available[i];
      highlight(current.target());
      say(
        current.text,
        [
          ...(i > 0 ? [{ label: t("Zurück", "Back"), run: () => show(i - 1) }] : []),
          {
            label: i === available.length - 1 ? t("Fertig", "Done") : t("Weiter", "Next"),
            primary: true,
            run: () => show(i + 1),
          },
        ],
        `${i + 1} / ${available.length}`,
      );
    };
    show(from);
  };

  const introduce = () => {
    setMood("done");
    say(
      t(
        "Hi! Ich bin <b>Axo</b>, der Axolotl aus Moon Code 🌙 Ab jetzt wohne ich auch hier, auf deinem Suchfeld. Soll ich dir kurz zeigen, wie die Suche funktioniert?",
        "Hi! I'm <b>Axo</b>, the axolotl from Moon Code 🌙 Now I live here too, on your search box. Shall I quickly show you how the search works?",
      ),
      [
        { label: t("Später", "Later"), run: quiet },
        { label: t("Zeig's mir!", "Show me!"), primary: true, run: () => tour() },
      ],
    );
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // storage blocked: Axo just introduces itself again next time
    }
  };

  const TIPS = [
    t(
      "Frag ruhig nach: Unter jeder Antwort kannst du eine <b>Folgefrage</b> stellen, Perplexity merkt sich den Zusammenhang.",
      "Ask on: under every answer you can ask a <b>follow-up</b>; Perplexity keeps the context.",
    ),
    t(
      "Die kleinen Zahlen in einer Antwort sind <b>Quellen</b> – fahr mit der Maus drüber, um zu sehen, woher etwas stammt.",
      "The little numbers in an answer are <b>sources</b> – hover them to see where something comes from.",
    ),
    t(
      "Mit <b>Projekten</b> links sammelst du Fragen zu einem Thema an einem Ort.",
      "<b>Projects</b> on the left keep questions about one topic together.",
    ),
  ];
  let tip = 0;
  axo.addEventListener("click", () => {
    if (bubble.classList.contains("show")) {
      quiet();
      return;
    }
    setMood("done");
    say(TIPS[tip++ % TIPS.length], [
      { label: t("Tour", "Tour"), run: () => tour() },
      { label: t("Danke!", "Thanks!"), primary: true, run: quiet },
    ]);
  });

  // ---- Reacting to the search ----

  let thinking = 0;
  document.addEventListener(
    "input",
    (e) => {
      const field = input();
      if (!field || !(e.target instanceof Node) || !field.contains(e.target)) return;
      if (moodNow !== "work") setMood("work");
      clearTimeout(thinking);
      thinking = window.setTimeout(() => {
        setMood("idle");
        schedule();
      }, 1500);
      typingUntil = performance.now() + 1500;
      schedule();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      const field = input();
      if (e.key !== "Enter" || e.shiftKey || !field || !(e.target instanceof Node)) return;
      if (field.contains(e.target)) {
        clearTimeout(thinking);
        setMood("done");
        if (current) quiet();
        if (typed(field)) ask();
      }
    },
    true,
  );
  // Asked with the send button instead of Enter.
  document.addEventListener(
    "click",
    (e) => {
      const field = input();
      const send = button("submit", "senden", "send");
      if (field && send && e.target instanceof Node && send.contains(e.target) && typed(field))
        ask();
    },
    true,
  );

  place();
  setTimeout(() => {
    place();
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN) === "1";
    } catch {
      seen = false;
    }
    if (!seen && !axo.hidden) introduce();
  }, 1200);
}
