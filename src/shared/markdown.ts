/**
 * The little Markdown the chat shows: paragraphs, headings, lists, quotes,
 * code, bold, italics and links. It is parsed into plain data that the page
 * renders as elements — HTML in the text stays text, and a link only ever
 * points to an http(s) address.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "rule" };

function safeHref(href: string): string | null {
  try {
    const url = new URL(href.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Bold, italics, code and links inside one line of text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      flush();
      out.push({ type: "code", text: code[1] });
      i += code[0].length;
      continue;
    }
    const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (bold) {
      flush();
      out.push({ type: "bold", children: parseInline(bold[2]) });
      i += bold[0].length;
      continue;
    }
    // An underscore inside a word (snake_case) is just an underscore.
    const before = i > 0 ? text[i - 1] : " ";
    const italic =
      /^\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/.exec(rest) ??
      (/\w/.test(before) ? null : /^_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/.exec(rest));
    if (italic) {
      flush();
      out.push({ type: "italic", children: parseInline(italic[1]) });
      i += italic[0].length;
      continue;
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]);
      if (href) {
        flush();
        out.push({ type: "link", href, children: parseInline(link[1]) });
        i += link[0].length;
        continue;
      }
    }
    const bare = /^https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/.exec(rest);
    if (bare && !/\w/.test(before)) {
      const href = safeHref(bare[0]);
      if (href) {
        flush();
        out.push({ type: "link", href, children: [{ type: "text", text: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  return out;
}

const LIST_ITEM = /^\s{0,8}(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;

/** The blocks of a message. Text still streaming in parses too (an open code block shows as code). */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      const fence = /^\s{0,3}(```|~~~)/.exec(line)![1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence)) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: Math.min(3, heading[1].length) as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]))
        body.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ type: "quote", children: parseInline(body.join(" ")) });
      continue;
    }
    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = first[2] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i]);
        if (item && (item[2] !== undefined) === ordered) items.push(item[3]);
        // An indented line continues the item above it.
        else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
        } else break;
        i++;
      }
      blocks.push({ type: "list", ordered, items: items.map(parseInline) });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s{0,3}(```|~~~|#{1,6}\s|>)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i])
    )
      body.push(lines[i++].trim());
    blocks.push({ type: "paragraph", children: parseInline(body.join("\n")) });
  }
  return blocks;
}
