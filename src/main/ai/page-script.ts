/**
 * The part of the assistant's tools that runs inside a web page — in an
 * isolated world, so the page's own scripts can neither see nor change it.
 * `pageAgent` is sent to the page as source text: everything it needs is
 * inside it, or handed in.
 */

export type PageRequest =
  | { op: "read"; offset: number; maxText: number; maxElements: number }
  | { op: "describe"; ref: string }
  | { op: "click"; ref: string }
  | { op: "type"; ref: string; text: string; submit: boolean }
  | { op: "scroll"; direction: "down" | "up" | "top" | "bottom" }
  | { op: "selection"; max: number };

export interface PageElement {
  ref: string;
  /** "link", "button", "field", "select", "checkbox", … */
  role: string;
  label: string;
  /** A link's address, a field's kind and value, a select's options. */
  detail: string;
  /** A password or payment field: its value is never read. */
  sensitive: boolean;
}

export type PageReply =
  | { ok: false; error: string }
  | {
      ok: true;
      title?: string;
      url?: string;
      text?: string;
      /** Length of the whole text. */
      total?: number;
      elements?: PageElement[];
      moreElements?: boolean;
      element?: PageElement;
      /** How far down the page is scrolled, 0–100. */
      scrolled?: number;
    };

type SensitiveTest = (field: { type?: string; autocomplete?: string; name?: string }) => boolean;

export function pageAgent(request: PageRequest, isSensitive: SensitiveTest): PageReply {
  // References live in this world, with the document: a navigation starts over.
  const g = globalThis as unknown as {
    __lumaAi?: {
      next: number;
      byRef: Map<string, Element>;
      refs: WeakMap<Element, string>;
    };
  };
  const store = (g.__lumaAi ??= {
    next: 1,
    byRef: new Map<string, Element>(),
    refs: new WeakMap<Element, string>(),
  });

  const clean = (text: string | null | undefined, max = 80): string => {
    const t = (text ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const visible = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const sensitiveOf = (el: Element): boolean =>
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    isSensitive({
      type: el.getAttribute("type") ?? "",
      autocomplete: el.getAttribute("autocomplete") ?? "",
      name: `${el.getAttribute("name") ?? ""} ${el.id}`,
    });
  const editable = (el: Element): boolean =>
    el instanceof HTMLElement && el.isContentEditable && !(el instanceof HTMLInputElement);

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (el instanceof HTMLAnchorElement) return "link";
    if (el instanceof HTMLSelectElement) return "select";
    if (el instanceof HTMLTextAreaElement) return "field";
    if (el instanceof HTMLInputElement) {
      const type = el.type;
      if (type === "checkbox" || type === "radio") return type;
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      return type === "password" ? "password field" : "field";
    }
    if (el instanceof HTMLButtonElement || el.tagName === "SUMMARY") return "button";
    if (editable(el)) return "field";
    return explicit || "button";
  };

  const labelOf = (el: Element): string => {
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (text.trim()) return clean(text);
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      const label = el.labels?.[0]?.textContent;
      if (label?.trim()) return clean(label);
      if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type))
        return clean(el.value || el.type);
      const hint = el.getAttribute("placeholder") || el.getAttribute("title") || el.name;
      return clean(hint);
    }
    const text = el instanceof HTMLElement ? el.innerText : el.textContent;
    if (text?.trim()) return clean(text);
    const img = el.querySelector("img[alt]");
    return clean(el.getAttribute("title") || img?.getAttribute("alt") || "");
  };

  const detailOf = (el: Element, sensitive: boolean): string => {
    const off = (el as HTMLInputElement).disabled ? " (disabled)" : "";
    if (el instanceof HTMLAnchorElement) return clean(el.href, 160);
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options)
        .slice(0, 15)
        .map((o) => clean(o.label, 40));
      const more = el.options.length > 15 ? ", …" : "";
      return `chosen: "${clean(el.selectedOptions[0]?.label, 40)}"; options: ${options.join(", ")}${more}${off}`;
    }
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))
      return `${el.checked ? "checked" : "not checked"}${off}`;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (roleOf(el) === "button") return off.trim();
      const kind = el instanceof HTMLInputElement && el.type !== "text" ? `${el.type}; ` : "";
      // What is in a password or payment field stays there.
      return sensitive ? `${kind}value hidden${off}` : `${kind}value: "${clean(el.value)}"${off}`;
    }
    if (editable(el)) return `value: "${clean((el as HTMLElement).innerText)}"`;
    return off.trim();
  };

  const describe = (el: Element): PageElement => {
    let ref = store.refs.get(el);
    if (!ref) {
      ref = `e${store.next++}`;
      store.refs.set(el, ref);
      store.byRef.set(ref, el);
    }
    const sensitive = sensitiveOf(el);
    return {
      ref,
      role: roleOf(el),
      label: labelOf(el),
      detail: detailOf(el, sensitive),
      sensitive,
    };
  };

  const find = (ref: string): Element | null => {
    const el = store.byRef.get(ref);
    return el?.isConnected ? el : null;
  };
  const gone = (ref: string): PageReply => ({
    ok: false,
    error: `There is no element ${ref} on this page (any more). Read the page again for current references.`,
  });

  switch (request.op) {
    case "read": {
      const whole = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
      const elements: PageElement[] = [];
      let more = false;
      if (request.offset === 0) {
        // Elements the page has dropped since the last read are let go of.
        for (const [ref, el] of Array.from(store.byRef))
          if (!el.isConnected) store.byRef.delete(ref);
        const found = document.querySelectorAll(
          'a[href], button, input:not([type="hidden"]), textarea, select, summary, ' +
            '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], ' +
            '[role="switch"], [role="option"], [role="textbox"], [contenteditable=""], [contenteditable="true"]',
        );
        for (const el of Array.from(found)) {
          if (!visible(el) || el.closest('[aria-hidden="true"]')) continue;
          if (elements.length >= request.maxElements) {
            more = true;
            break;
          }
          elements.push(describe(el));
        }
      }
      return {
        ok: true,
        title: document.title,
        url: location.href,
        text: whole.slice(request.offset, request.offset + request.maxText),
        total: whole.length,
        elements,
        moreElements: more,
      };
    }
    case "describe": {
      const el = find(request.ref);
      return el ? { ok: true, element: describe(el) } : gone(request.ref);
    }
    case "click": {
      const el = find(request.ref);
      if (!el) return gone(request.ref);
      if ((el as HTMLButtonElement).disabled)
        return { ok: false, error: "This element is disabled." };
      el.scrollIntoView({ block: "center", inline: "center" });
      const box = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        button: 0,
      };
      const element = describe(el);
      el.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent("mousedown", at));
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
      el.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent("mouseup", at));
      if (el instanceof HTMLElement) el.click();
      else el.dispatchEvent(new MouseEvent("click", at));
      return { ok: true, element };
    }
    case "type": {
      const el = find(request.ref);
      if (!el) return gone(request.ref);
      const element = describe(el);
      const changed = () => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      if (el instanceof HTMLSelectElement) {
        const wanted = request.text.trim().toLowerCase();
        const option = Array.from(el.options).find(
          (o) => o.label.trim().toLowerCase() === wanted || o.value.toLowerCase() === wanted,
        );
        if (!option) return { ok: false, error: `This select has no option "${request.text}".` };
        el.value = option.value;
        changed();
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.disabled || el.readOnly) return { ok: false, error: "This field can't be changed." };
        if (el instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(el.type))
          return { ok: false, error: `Text can't be typed into a ${el.type} input; click it.` };
        el.focus({ preventScroll: true });
        // Through the element's own setter, so pages that track their fields (React) notice.
        const proto =
          el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        const setter: unknown = descriptor ? Reflect.get(descriptor, "set") : undefined;
        if (typeof setter === "function") Reflect.apply(setter, el, [request.text]);
        else el.value = request.text;
        changed();
      } else if (editable(el)) {
        (el as HTMLElement).focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("insertText", false, request.text);
      } else {
        return { ok: false, error: "This element is not a field text can be typed into." };
      }
      if (request.submit) {
        const form = (el as HTMLInputElement).form;
        if (form) form.requestSubmit();
        else {
          const key = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
          for (const type of ["keydown", "keypress", "keyup"])
            el.dispatchEvent(new KeyboardEvent(type, { ...key, cancelable: true }));
        }
      }
      return { ok: true, element };
    }
    case "scroll": {
      const page = document.scrollingElement ?? document.documentElement;
      const step = Math.round(window.innerHeight * 0.85);
      const max = Math.max(0, page.scrollHeight - window.innerHeight);
      const top =
        request.direction === "top"
          ? 0
          : request.direction === "bottom"
            ? max
            : page.scrollTop + (request.direction === "down" ? step : -step);
      page.scrollTo({ top, behavior: "instant" });
      return { ok: true, scrolled: max > 0 ? Math.round((page.scrollTop / max) * 100) : 100 };
    }
    case "selection": {
      // Text selected inside a password field is not handed on.
      const active = document.activeElement;
      if (active && sensitiveOf(active)) return { ok: true, text: "" };
      return { ok: true, text: (getSelection()?.toString() ?? "").slice(0, request.max) };
    }
  }
}
