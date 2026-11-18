/**
 * The tools of the API assistant: what Claude may ask Luma to do in the
 * window's tabs. Pure — the definitions sent to the API, the check of what
 * comes back, and the rules for when the person is asked first. The main
 * process runs them (src/main/ai/page-tools.ts).
 *
 * Tool inputs stream in as they are generated and nobody validates them on
 * the way, so every input is checked here before a tool runs.
 */

export const AI_TOOL_NAMES = [
  "read_page",
  "click",
  "type",
  "scroll",
  "navigate",
  "go_back",
  "list_tabs",
  "open_tab",
  "switch_tab",
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** Tools that only look: they run without asking. */
const READING_TOOLS: readonly AiToolName[] = ["read_page", "scroll", "list_tabs"];

export interface AiToolDefinition {
  name: AiToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
    additionalProperties: false;
  };
}

const TAB_ID = {
  type: "integer",
  description: "The tab to use, from list_tabs. Leave out for the tab the user is looking at.",
};
const REF = {
  type: "string",
  description: 'The reference of an element from the last read_page of that tab, e.g. "e12".',
};

/** In a fixed order: the list is part of the cached prompt. */
export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    name: "read_page",
    description:
      "Read a tab's page: its title, address, readable text, and its interactive elements " +
      "(links, buttons, fields) with a short reference each, for click and type. Long pages " +
      "come in parts: the result says when the text was cut and which offset reads on. " +
      "Call it again after the page changed; old references stop working after a navigation.",
    input_schema: {
      type: "object",
      properties: {
        tab_id: TAB_ID,
        offset: {
          type: "integer",
          description: "Where in the page's text to start (0 by default), to read on.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "click",
    description: "Click a link, button or other element of a page, by its reference.",
    input_schema: {
      type: "object",
      properties: { ref: REF, tab_id: TAB_ID },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "type",
    description:
      "Put text into a field of a page (replacing what is in it), or choose an option of a " +
      "select by its label. With submit, the field's form is sent afterwards, like pressing Enter.",
    input_schema: {
      type: "object",
      properties: {
        ref: REF,
        text: { type: "string", description: "The text to put into the field." },
        submit: { type: "boolean", description: "Send the form afterwards (false by default)." },
        tab_id: TAB_ID,
      },
      required: ["ref", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "scroll",
    description:
      "Scroll a page, to bring more of it into view (pages that load more as you scroll).",
    input_schema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["down", "up", "top", "bottom"],
          description: "down and up move by about one screen.",
        },
        tab_id: TAB_ID,
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
  {
    name: "navigate",
    description: "Load another address in a tab (http or https only).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full address, starting with https://." },
        tab_id: TAB_ID,
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "go_back",
    description: "Go back one page in a tab's history.",
    input_schema: {
      type: "object",
      properties: { tab_id: TAB_ID },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_tabs",
    description: "List the window's tabs: their IDs, titles and addresses, and which one is shown.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "open_tab",
    description: "Open an address in a new tab and show it (http or https only).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full address, starting with https://." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "switch_tab",
    description: "Show another tab of the window.",
    input_schema: {
      type: "object",
      properties: { tab_id: { type: "integer", description: "The tab's ID, from list_tabs." } },
      required: ["tab_id"],
      additionalProperties: false,
    },
  },
];

export type AiToolCall =
  | { name: "read_page"; tabId?: number; offset: number }
  | { name: "click"; tabId?: number; ref: string }
  | { name: "type"; tabId?: number; ref: string; text: string; submit: boolean }
  | { name: "scroll"; tabId?: number; direction: "down" | "up" | "top" | "bottom" }
  | { name: "navigate"; tabId?: number; url: string }
  | { name: "go_back"; tabId?: number }
  | { name: "list_tabs" }
  | { name: "open_tab"; url: string }
  | { name: "switch_tab"; tabId: number };

export type ToolInputResult = { ok: true; call: AiToolCall } | { ok: false; error: string };

const MAX_TYPED = 20_000;
const MAX_OFFSET = 50_000_000;

/** An address the assistant may open: http or https, nothing else. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

/**
 * Checks a tool call against its schema: the right name, every required
 * field with its type, nothing unknown. An input that was cut off or
 * garbled on its way is refused here instead of half-running.
 */
export function validateToolInput(name: string, input: unknown): ToolInputResult {
  const fail = (error: string): ToolInputResult => ({ ok: false, error });
  const tool = AI_TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Unknown tool "${name}". The tools are: ${AI_TOOL_NAMES.join(", ")}.`);
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fail("The input must be a JSON object.");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw))
    if (!(key in tool.input_schema.properties)) return fail(`Unknown field "${key}".`);
  for (const key of tool.input_schema.required)
    if (raw[key] === undefined) return fail(`The field "${key}" is missing.`);

  let tabId: number | undefined;
  if (raw.tab_id !== undefined && raw.tab_id !== null) {
    if (typeof raw.tab_id !== "number" || !Number.isInteger(raw.tab_id) || raw.tab_id < 0)
      return fail('"tab_id" must be a tab ID from list_tabs.');
    tabId = raw.tab_id;
  }
  const ref = (): string | null =>
    typeof raw.ref === "string" && /^e\d{1,6}$/.test(raw.ref) ? raw.ref : null;
  const badRef = '"ref" must be an element reference from read_page, like "e12".';
  const badUrl = '"url" must be a full http:// or https:// address.';

  switch (tool.name) {
    case "read_page": {
      const offset = raw.offset ?? 0;
      if (
        typeof offset !== "number" ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > MAX_OFFSET
      )
        return fail('"offset" must be a whole number, 0 or more.');
      return { ok: true, call: { name: "read_page", tabId, offset } };
    }
    case "click": {
      const r = ref();
      return r ? { ok: true, call: { name: "click", tabId, ref: r } } : fail(badRef);
    }
    case "type": {
      const r = ref();
      if (!r) return fail(badRef);
      if (typeof raw.text !== "string") return fail('"text" must be a string.');
      if (raw.text.length > MAX_TYPED)
        return fail(`"text" is longer than ${MAX_TYPED} characters.`);
      if (raw.submit !== undefined && typeof raw.submit !== "boolean")
        return fail('"submit" must be true or false.');
      return {
        ok: true,
        call: { name: "type", tabId, ref: r, text: raw.text, submit: raw.submit === true },
      };
    }
    case "scroll": {
      const d = raw.direction;
      if (d !== "down" && d !== "up" && d !== "top" && d !== "bottom")
        return fail('"direction" must be "down", "up", "top" or "bottom".');
      return { ok: true, call: { name: "scroll", tabId, direction: d } };
    }
    case "navigate": {
      const url = webUrl(raw.url);
      return url ? { ok: true, call: { name: "navigate", tabId, url } } : fail(badUrl);
    }
    case "go_back":
      return { ok: true, call: { name: "go_back", tabId } };
    case "list_tabs":
      return { ok: true, call: { name: "list_tabs" } };
    case "open_tab": {
      const url = webUrl(raw.url);
      return url ? { ok: true, call: { name: "open_tab", url } } : fail(badUrl);
    }
    case "switch_tab":
      return tabId === undefined
        ? fail('"tab_id" must be a tab ID from list_tabs.')
        : { ok: true, call: { name: "switch_tab", tabId } };
  }
}

/** Whether a tool changes something (a click, typing, another page) rather than only looking. */
export function isActingTool(name: AiToolName): boolean {
  return !READING_TOOLS.includes(name);
}

export interface ApprovalContext {
  /** Settings → Luma AI → "Ask before the assistant acts". */
  askBeforeActing: boolean;
  /** The person chose "Allow for this chat". */
  allowedForChat: boolean;
  /** The target is a password or payment field. */
  sensitive: boolean;
}

/**
 * Whether the person is asked before a tool runs. Looking never asks.
 * Acting asks, unless they allowed it for this chat or switched the question
 * off — and typing into a password or payment field asks every time,
 * whatever was allowed before.
 */
export function needsApproval(name: AiToolName, context: ApprovalContext): boolean {
  if (!isActingTool(name)) return false;
  if (name === "type" && context.sensitive) return true;
  return context.askBeforeActing && !context.allowedForChat;
}

/** A field whose content is nobody's business: passwords, card numbers, security codes. */
export function isSensitiveField(field: {
  type?: string;
  autocomplete?: string;
  name?: string;
}): boolean {
  if ((field.type ?? "").toLowerCase() === "password") return true;
  const auto = (field.autocomplete ?? "").toLowerCase();
  if (/(^|\s)(cc-[a-z-]+|current-password|new-password|one-time-code)(\s|$)/.test(auto))
    return true;
  return /card.?(number|num|no)\b|cardnumber|cc.?(num|number|csc|cvc|cvv|exp)|\b(cvc|cvv|csc|iban)\b|security.?code/i.test(
    field.name ?? "",
  );
}

const quote = (text: string, max = 48): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
};

/** What an element is called in the chat: its label, or what kind of thing it is. */
export function elementName(element: { label: string; role: string }): string {
  return element.label.trim() ? quote(element.label) : `a ${element.role}`;
}

/**
 * The question of the approval card: what the assistant is about to do.
 * What is typed into a password or payment field is not repeated.
 */
export function approvalSummary(
  call: AiToolCall,
  target?: { label: string; role: string; sensitive: boolean; title?: string },
): string {
  switch (call.name) {
    case "click":
      return `Click ${target ? elementName(target) : "an element"}`;
    case "type": {
      const where = target ? elementName(target) : "a field";
      const what = target?.sensitive ? "text" : quote(call.text, 80);
      return `Type ${what} into ${where}${call.submit ? " and send the form" : ""}`;
    }
    case "navigate":
      return `Go to ${call.url}`;
    case "go_back":
      return "Go back one page";
    case "open_tab":
      return `Open ${call.url} in a new tab`;
    case "switch_tab":
      return `Switch to the tab ${quote(target?.title || "untitled")}`;
    default:
      return call.name;
  }
}

/** The compact row a tool call leaves in the chat, while it runs and after. */
export function toolLabel(
  call: AiToolCall,
  done: boolean,
  target?: { label: string; role: string; sensitive: boolean; title?: string },
): string {
  const name = target ? elementName(target) : "";
  switch (call.name) {
    case "read_page":
      return done
        ? call.offset > 0
          ? "Read on in the page"
          : "Read the page"
        : "Reading the page…";
    case "click":
      return done ? `Clicked ${name || "an element"}` : `Clicking ${name || "an element"}…`;
    case "type":
      return done ? `Typed into ${name || "a field"}` : `Typing into ${name || "a field"}…`;
    case "scroll":
      return done ? "Scrolled the page" : "Scrolling…";
    case "navigate":
      return done ? `Went to ${hostOf(call.url)}` : `Going to ${hostOf(call.url)}…`;
    case "go_back":
      return done ? "Went back" : "Going back…";
    case "list_tabs":
      return done ? "Looked at the open tabs" : "Looking at the open tabs…";
    case "open_tab":
      return done ? `Opened ${hostOf(call.url)}` : `Opening ${hostOf(call.url)}…`;
    case "switch_tab":
      return done ? "Switched tabs" : "Switching tabs…";
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
