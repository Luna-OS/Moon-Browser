import { describe, expect, it } from "vitest";
import {
  API_ASSISTANT_ID,
  assistantList,
  assistantUrlProblem,
  BUILTIN_ASSISTANTS,
  defaultAssistant,
  findAssistant,
  isPlausibleApiKey,
  MAX_CUSTOM_ASSISTANTS,
  MAX_SELECTION,
  normalizeAssistantUrl,
  pagePrompt,
  sanitizeCustomAssistants,
} from "./ai";
import {
  AI_TOOLS,
  approvalSummary,
  isActingTool,
  isSensitiveField,
  needsApproval,
  toolLabel,
  validateToolInput,
} from "./ai-tools";
import { parseInline, parseMarkdown } from "./markdown";
import { defaultSettings, mergeSettings, sanitizeSettings } from "./settings";
import { shortcutFor, shortcutHint } from "./shortcuts";

describe("the assistants", () => {
  it("lists the built-in ones with their own addresses, then the user's", () => {
    expect(BUILTIN_ASSISTANTS.map((a) => [a.name, a.url])).toEqual([
      ["Claude", "https://claude.ai/new"],
      ["ChatGPT", "https://chatgpt.com/"],
      ["Gemini", "https://gemini.google.com/app"],
      ["Perplexity", "https://www.perplexity.ai/"],
      ["Le Chat", "https://chat.mistral.ai/chat"],
      ["Claude (API key)", "moon://ai/"],
    ]);
    const own = [{ id: "own-1", name: "Team", url: "https://chat.team.example/" }];
    const list = assistantList(own);
    expect(list.at(-1)).toEqual({ ...own[0], kind: "web", custom: true });
    expect(list.filter((a) => a.kind === "api").map((a) => a.id)).toEqual([API_ASSISTANT_ID]);
  });

  it("leaves the API assistant out of private windows", () => {
    expect(assistantList([], true).some((a) => a.kind === "api")).toBe(false);
    expect(findAssistant(API_ASSISTANT_ID, [], true)).toBeNull();
    expect(defaultAssistant(API_ASSISTANT_ID, [], true).id).toBe("claude");
  });

  it("opens Claude when the chosen assistant is gone", () => {
    expect(defaultAssistant("own-9", []).id).toBe("claude");
    expect(defaultAssistant("gemini", []).id).toBe("gemini");
  });

  it("takes https addresses, and http only for this computer", () => {
    expect(normalizeAssistantUrl(" https://chat.example.com/app ")).toBe(
      "https://chat.example.com/app",
    );
    expect(normalizeAssistantUrl("chat.example.com")).toBe("https://chat.example.com/");
    expect(normalizeAssistantUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
    expect(normalizeAssistantUrl("http://127.0.0.1:8080/chat")).toBe("http://127.0.0.1:8080/chat");
    expect(normalizeAssistantUrl("http://chat.example.com/")).toBeNull();
    expect(normalizeAssistantUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeAssistantUrl("moon://settings/")).toBeNull();
    expect(normalizeAssistantUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeAssistantUrl("https://user:secret@chat.example.com/")).toBeNull();
    expect(normalizeAssistantUrl("https://intranet")).toBeNull();
    expect(normalizeAssistantUrl("two words")).toBeNull();
    expect(normalizeAssistantUrl("")).toBeNull();
  });

  it("says what is wrong with an address", () => {
    expect(assistantUrlProblem("")).toMatch(/Enter/);
    expect(assistantUrlProblem("http://chat.example.com")).toMatch(/https/);
    expect(assistantUrlProblem("not an address")).toMatch(/not a web address/);
    expect(assistantUrlProblem("https://chat.example.com")).toBeNull();
  });

  it("keeps only valid assistants of the user's, each once", () => {
    const kept = sanitizeCustomAssistants([
      { id: "own-1", name: "  Team   chat ", url: "chat.team.example" },
      { id: "own-1", name: "Twice", url: "https://twice.example/" },
      { id: "claude", name: "Not Claude", url: "https://evil.example/" },
      { id: "own-2", name: "", url: "https://nameless.example/" },
      { id: "own-3", name: "Plain", url: "http://plain.example/" },
      { id: "Bad ID", name: "Bad", url: "https://bad.example/" },
      "nonsense",
      null,
    ]);
    expect(kept).toEqual([{ id: "own-1", name: "Team chat", url: "https://chat.team.example/" }]);
    expect(sanitizeCustomAssistants("nope")).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `own-${i}`,
      name: `A${i}`,
      url: `https://a${i}.example/`,
    }));
    expect(sanitizeCustomAssistants(many)).toHaveLength(MAX_CUSTOM_ASSISTANTS);
  });

  it("knows what an API key looks like", () => {
    expect(isPlausibleApiKey("sk-ant-api03-abcdefghijklmnop_QRST-uvwx")).toBe(true);
    expect(isPlausibleApiKey("sk-ant-short")).toBe(false);
    expect(isPlausibleApiKey("sk-proj-abcdefghijklmnopqrstuvwx")).toBe(false);
    expect(isPlausibleApiKey("sk-ant-api03-with space-abcdefghijkl")).toBe(false);
  });
});

describe("Luma AI settings", () => {
  it("start with the button shown, Claude, Opus and asking before acting", () => {
    const d = defaultSettings("linux");
    expect(d.showAiButton).toBe(true);
    expect(d.aiAssistant).toBe("claude");
    expect(d.aiAssistants).toEqual([]);
    expect(d.aiModel).toBe("claude-opus-5-5");
    expect(d.aiAskBeforeActing).toBe(true);
    // Profiles from before Luma AI get the same.
    expect(sanitizeSettings({ theme: "light" }, "linux").aiAskBeforeActing).toBe(true);
  });

  it("fall back to the defaults for unknown or invalid values", () => {
    const s = sanitizeSettings(
      {
        showAiButton: "no",
        aiAssistant: "skynet",
        aiAssistants: [{ id: "own-1", name: "Bad", url: "ftp://bad.example/" }],
        aiModel: "claude-opus-1",
        aiAskBeforeActing: 0,
      },
      "win32",
    );
    expect(s.showAiButton).toBe(true);
    expect(s.aiAssistant).toBe("claude");
    expect(s.aiAssistants).toEqual([]);
    expect(s.aiModel).toBe("claude-opus-5-5");
    expect(s.aiAskBeforeActing).toBe(true);
  });

  it("keep valid values, and one of the user's own as the default", () => {
    const own = { id: "own-1", name: "Team", url: "https://chat.team.example/" };
    const s = sanitizeSettings(
      {
        showAiButton: false,
        aiAssistant: "own-1",
        aiAssistants: [own],
        aiModel: "claude-haiku-5-5",
        aiAskBeforeActing: false,
      },
      "linux",
    );
    expect(s).toMatchObject({
      showAiButton: false,
      aiAssistant: "own-1",
      aiAssistants: [own],
      aiModel: "claude-haiku-5-5",
      aiAskBeforeActing: false,
    });
    // Removing the default assistant falls back to Claude.
    expect(mergeSettings(s, { aiAssistants: [] }, "linux").aiAssistant).toBe("claude");
  });

  it("have keys that open the panel and send the page", () => {
    const key = (k: string, mods: object) => ({
      type: "keyDown",
      key: k,
      control: false,
      meta: false,
      shift: false,
      alt: false,
      ...mods,
    });
    expect(shortcutFor(key("A", { control: true, shift: true }), "win32")).toEqual({
      type: "toggleAi",
    });
    expect(shortcutFor(key("M", { meta: true, shift: true }), "darwin")).toEqual({
      type: "aiSendPage",
    });
    expect(shortcutFor(key("a", { control: true }), "linux")).toBeNull();
    expect(shortcutHint("ai", "linux")).toBe("Ctrl+Shift+A");
    expect(shortcutHint("aiSendPage", "darwin")).toBe("⇧⌘M");
  });
});

describe("sending the page to the assistant", () => {
  it("gives the title and the address, ready for a question", () => {
    expect(pagePrompt({ title: "  Moon   phases ", url: "https://moon.example/phases" })).toBe(
      "Page: Moon phases\nURL: https://moon.example/phases\n\n",
    );
  });

  it("leaves out a title that says nothing", () => {
    expect(pagePrompt({ title: "", url: "https://moon.example/" })).toBe(
      "URL: https://moon.example/\n\n",
    );
    expect(pagePrompt({ title: "https://moon.example/", url: "https://moon.example/" })).toBe(
      "URL: https://moon.example/\n\n",
    );
  });

  it("adds the selected text, shortened when it is long", () => {
    const prompt = pagePrompt({
      title: "Moon",
      url: "https://moon.example/",
      selection: "  The moon is\r\na loyal companion.  ",
    });
    expect(prompt).toBe(
      'Page: Moon\nURL: https://moon.example/\n\nSelected text:\n"""\nThe moon is\na loyal companion.\n"""\n\n',
    );
    const long = pagePrompt({
      title: "Moon",
      url: "https://moon.example/",
      selection: "x".repeat(MAX_SELECTION + 500),
    });
    expect(long).toContain("Selected text (shortened):");
    expect(long).toContain(`${"x".repeat(MAX_SELECTION)}…`);
    expect(long).not.toContain("x".repeat(MAX_SELECTION + 1));
  });
});

describe("the assistant's tools", () => {
  it("are all there, each closed to unknown fields", () => {
    expect(AI_TOOLS.map((t) => t.name)).toEqual([
      "read_page",
      "click",
      "type",
      "scroll",
      "navigate",
      "go_back",
      "list_tabs",
      "open_tab",
      "switch_tab",
    ]);
    for (const tool of AI_TOOLS) {
      expect(tool.input_schema.additionalProperties).toBe(false);
      for (const key of tool.input_schema.required)
        expect(tool.input_schema.properties).toHaveProperty(key);
    }
  });

  it("accept well-formed inputs", () => {
    expect(validateToolInput("read_page", {})).toEqual({
      ok: true,
      call: { name: "read_page", tabId: undefined, offset: 0 },
    });
    expect(validateToolInput("read_page", { tab_id: 4, offset: 16000 })).toEqual({
      ok: true,
      call: { name: "read_page", tabId: 4, offset: 16000 },
    });
    expect(validateToolInput("click", { ref: "e12" })).toEqual({
      ok: true,
      call: { name: "click", tabId: undefined, ref: "e12" },
    });
    expect(validateToolInput("type", { ref: "e3", text: "moon", submit: true })).toEqual({
      ok: true,
      call: { name: "type", tabId: undefined, ref: "e3", text: "moon", submit: true },
    });
    expect(validateToolInput("type", { ref: "e3", text: "" })).toMatchObject({
      ok: true,
      call: { submit: false },
    });
    expect(validateToolInput("scroll", { direction: "down" })).toMatchObject({ ok: true });
    expect(validateToolInput("navigate", { url: " https://moon.example/a b " })).toEqual({
      ok: true,
      call: { name: "navigate", tabId: undefined, url: "https://moon.example/a%20b" },
    });
    expect(validateToolInput("switch_tab", { tab_id: 2 })).toEqual({
      ok: true,
      call: { name: "switch_tab", tabId: 2 },
    });
    expect(validateToolInput("list_tabs", {})).toEqual({ ok: true, call: { name: "list_tabs" } });
  });

  it("refuse inputs that are cut off, mistyped or made up", () => {
    const bad = (name: string, input: unknown) =>
      expect(validateToolInput(name, input).ok, `${name} ${JSON.stringify(input)}`).toBe(false);
    bad("run_shell", { command: "rm -rf /" });
    bad("click", null);
    bad("click", "e12");
    bad("click", []);
    bad("click", {});
    bad("click", { ref: "#login" });
    bad("click", { ref: "e12", force: true });
    bad("type", { ref: "e3" });
    bad("type", { ref: "e3", text: 7 });
    bad("type", { ref: "e3", text: "x", submit: "yes" });
    bad("type", { ref: "e3", text: "x".repeat(20_001) });
    bad("scroll", {});
    bad("scroll", { direction: "sideways" });
    bad("read_page", { offset: -1 });
    bad("read_page", { offset: 1.5 });
    bad("read_page", { tab_id: "4" });
    bad("switch_tab", {});
    bad("open_tab", {});
  });

  it("open only http and https addresses", () => {
    for (const url of [
      "moon://settings/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "chrome-extension://abc/page.html",
      "data:text/html,<h1>x</h1>",
      "about:blank",
      "example.com",
      "",
      42,
    ]) {
      expect(validateToolInput("navigate", { url }).ok, String(url)).toBe(false);
      expect(validateToolInput("open_tab", { url }).ok, String(url)).toBe(false);
    }
    expect(validateToolInput("open_tab", { url: "http://localhost:3000/" }).ok).toBe(true);
  });
});

describe("asking before the assistant acts", () => {
  const ask = { askBeforeActing: true, allowedForChat: false, sensitive: false };

  it("never asks for looking", () => {
    for (const name of ["read_page", "scroll", "list_tabs"] as const) {
      expect(isActingTool(name)).toBe(false);
      expect(needsApproval(name, ask)).toBe(false);
    }
  });

  it("asks for every acting tool", () => {
    for (const name of [
      "click",
      "type",
      "navigate",
      "go_back",
      "open_tab",
      "switch_tab",
    ] as const) {
      expect(isActingTool(name)).toBe(true);
      expect(needsApproval(name, ask)).toBe(true);
    }
  });

  it("stops asking once allowed for the chat, or with the setting off", () => {
    expect(needsApproval("click", { ...ask, allowedForChat: true })).toBe(false);
    expect(needsApproval("navigate", { ...ask, askBeforeActing: false })).toBe(false);
  });

  it("always asks before typing into a password or payment field", () => {
    const sensitive = { askBeforeActing: false, allowedForChat: true, sensitive: true };
    expect(needsApproval("type", sensitive)).toBe(true);
    // Reading stays free even there: such a field's value is never read anyway.
    expect(needsApproval("read_page", sensitive)).toBe(false);
  });

  it("recognizes password and payment fields", () => {
    expect(isSensitiveField({ type: "password" })).toBe(true);
    expect(isSensitiveField({ type: "PASSWORD" })).toBe(true);
    expect(isSensitiveField({ type: "text", autocomplete: "cc-number" })).toBe(true);
    expect(isSensitiveField({ type: "text", autocomplete: "section-pay cc-csc" })).toBe(true);
    expect(isSensitiveField({ type: "text", autocomplete: "one-time-code" })).toBe(true);
    expect(isSensitiveField({ type: "tel", name: "cardNumber" })).toBe(true);
    expect(isSensitiveField({ type: "text", name: "card-number checkout" })).toBe(true);
    expect(isSensitiveField({ type: "text", name: "cvv" })).toBe(true);
    expect(isSensitiveField({ type: "text", name: "iban" })).toBe(true);
    expect(isSensitiveField({ type: "search", autocomplete: "off", name: "q" })).toBe(false);
    expect(isSensitiveField({ type: "email", autocomplete: "username", name: "email" })).toBe(
      false,
    );
    expect(isSensitiveField({ type: "text", name: "discard-reason" })).toBe(false);
    expect(isSensitiveField({})).toBe(false);
  });

  it("says what is about to happen, without repeating a secret", () => {
    const button = { label: "Sign in", role: "button", sensitive: false };
    expect(approvalSummary({ name: "click", ref: "e1" }, button)).toBe("Click “Sign in”");
    expect(approvalSummary({ name: "click", ref: "e1" })).toBe("Click an element");
    expect(
      approvalSummary(
        { name: "type", ref: "e2", text: "moon phases", submit: true },
        { label: "Search", role: "field", sensitive: false },
      ),
    ).toBe("Type “moon phases” into “Search” and send the form");
    const secret = approvalSummary(
      { name: "type", ref: "e3", text: "hunter2", submit: false },
      { label: "Password", role: "password field", sensitive: true },
    );
    expect(secret).toBe("Type text into “Password”");
    expect(secret).not.toContain("hunter2");
    expect(approvalSummary({ name: "open_tab", url: "https://moon.example/" })).toBe(
      "Open https://moon.example/ in a new tab",
    );
    expect(
      approvalSummary(
        { name: "switch_tab", tabId: 3 },
        { label: "", role: "tab", sensitive: false, title: "Inbox" },
      ),
    ).toBe("Switch to the tab “Inbox”");
  });

  it("labels the rows of the chat", () => {
    expect(toolLabel({ name: "read_page", offset: 0 }, false)).toBe("Reading the page…");
    expect(toolLabel({ name: "read_page", offset: 0 }, true)).toBe("Read the page");
    expect(
      toolLabel({ name: "click", ref: "e1" }, true, {
        label: "Sign in",
        role: "button",
        sensitive: false,
      }),
    ).toBe("Clicked “Sign in”");
    expect(toolLabel({ name: "navigate", url: "https://moon.example/x" }, true)).toBe(
      "Went to moon.example",
    );
  });
});

describe("Markdown in the chat", () => {
  it("reads paragraphs, headings, lists, quotes and code", () => {
    const blocks = parseMarkdown(
      "# Title\n\nSome **bold** text\nover two lines.\n\n- one\n- two\n  more\n\n1. first\n2. second\n\n> quoted\n\n```js\nconst a = 1;\n```\n\n---",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "code",
      "rule",
    ]);
    expect(blocks[2]).toMatchObject({
      ordered: false,
      items: [[{ text: "one" }], [{ text: "two more" }]],
    });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[5]).toEqual({ type: "code", text: "const a = 1;" });
  });

  it("reads bold, italics, code and links", () => {
    expect(parseInline("a **b** *c* `d` [e](https://e.example/)")).toEqual([
      { type: "text", text: "a " },
      { type: "bold", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "italic", children: [{ type: "text", text: "c" }] },
      { type: "text", text: " " },
      { type: "code", text: "d" },
      { type: "text", text: " " },
      { type: "link", href: "https://e.example/", children: [{ type: "text", text: "e" }] },
    ]);
    expect(parseInline("snake_case_name and 2 * 3 * 4")).toEqual([
      { type: "text", text: "snake_case_name and 2 * 3 * 4" },
    ]);
    expect(parseInline("see https://moon.example/a.")).toMatchObject([
      { type: "text", text: "see " },
      { type: "link", href: "https://moon.example/a" },
      { type: "text", text: "." },
    ]);
  });

  it("keeps HTML as text and links to the web only", () => {
    expect(parseMarkdown('<img src=x onerror="alert(1)">')).toEqual([
      { type: "paragraph", children: [{ type: "text", text: '<img src=x onerror="alert(1)">' }] },
    ]);
    for (const href of [
      "javascript:alert(1)",
      "moon://settings/",
      "file:///etc/passwd",
      "data:text/html,x",
    ]) {
      const nodes = parseInline(`[click](${href})`);
      expect(
        nodes.some((n) => n.type === "link"),
        href,
      ).toBe(false);
    }
  });

  it("shows a code block that is still streaming in", () => {
    expect(parseMarkdown("```\nhalf")).toEqual([{ type: "code", text: "half" }]);
  });
});
