/**
 * Luma AI: the assistants the side panel can hold, and the plain data the
 * main process, the browser UI and the chat page exchange about them.
 *
 * Two kinds of assistant:
 *
 *  - "web": an assistant's own website (claude.ai, chatgpt.com, …) shown in
 *    the side panel as a normal page of the window's session — people sign
 *    in there with their own account, exactly as in a tab;
 *  - "api": Claude through an Anthropic API key, with Luma's own chat page
 *    (moon://ai/) and tools that read and act in the window's tabs.
 */

export interface Assistant {
  id: string;
  name: string;
  kind: "web" | "api";
  /** The page the side panel loads. */
  url: string;
  /** Added by the user in Settings (removable). */
  custom: boolean;
}

/** An assistant the user added: a name and an address. */
export interface CustomAssistant {
  id: string;
  name: string;
  url: string;
}

export const AI_PAGE_URL = "moon://ai/";
export const API_ASSISTANT_ID = "claude-api";
export const DEFAULT_ASSISTANT_ID = "claude";
export const MAX_CUSTOM_ASSISTANTS = 20;
const MAX_NAME = 40;

export const BUILTIN_ASSISTANTS: readonly Assistant[] = [
  { id: "claude", name: "Claude", kind: "web", url: "https://claude.ai/new", custom: false },
  { id: "chatgpt", name: "ChatGPT", kind: "web", url: "https://chatgpt.com/", custom: false },
  {
    id: "gemini",
    name: "Gemini",
    kind: "web",
    url: "https://gemini.google.com/app",
    custom: false,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    kind: "web",
    url: "https://www.perplexity.ai/",
    custom: false,
  },
  {
    id: "lechat",
    name: "Le Chat",
    kind: "web",
    url: "https://chat.mistral.ai/chat",
    custom: false,
  },
  { id: API_ASSISTANT_ID, name: "Claude (API key)", kind: "api", url: AI_PAGE_URL, custom: false },
];

/** This computer itself: the one place an assistant may be reached without HTTPS. */
function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * The address of an assistant as it is kept: an https:// page, or http://
 * for an assistant running on this computer (Open WebUI and the like).
 * A bare "chat.example.com" gets https://. Null for anything else.
 */
export function normalizeAssistantUrl(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "http:" && !isLoopback(url.hostname)) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!isLoopback(url.hostname) && !url.hostname.includes(".")) return null;
  return url.href;
}

/** What is wrong with an address typed into Settings, or null if it will do. */
export function assistantUrlProblem(input: string): string | null {
  const text = input.trim();
  if (!text) return "Enter the assistant's address.";
  if (/^http:\/\//i.test(text) && !normalizeAssistantUrl(text))
    return "The address must start with https:// (http:// only works for this computer).";
  return normalizeAssistantUrl(text) ? null : "This is not a web address.";
}

export function cleanAssistantName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/** The user's own assistants from stored or received data: valid ones only, no doubles. */
export function sanitizeCustomAssistants(raw: unknown): CustomAssistant[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomAssistant[] = [];
  const ids = new Set(BUILTIN_ASSISTANTS.map((a) => a.id));
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id) || ids.has(id)) continue;
    if (typeof name !== "string" || typeof url !== "string") continue;
    const cleanName = cleanAssistantName(name);
    const cleanUrl = normalizeAssistantUrl(url);
    if (!cleanName || !cleanUrl) continue;
    ids.add(id);
    out.push({ id, name: cleanName, url: cleanUrl });
    if (out.length >= MAX_CUSTOM_ASSISTANTS) break;
  }
  return out;
}

/**
 * Every assistant to choose from: the built-in ones, then the user's own.
 * Private windows have no API assistant (it would act in private tabs).
 */
export function assistantList(custom: readonly CustomAssistant[], isPrivate = false): Assistant[] {
  return [
    ...BUILTIN_ASSISTANTS.filter((a) => !(isPrivate && a.kind === "api")),
    ...custom.map((c): Assistant => ({ ...c, kind: "web", custom: true })),
  ];
}

export function findAssistant(
  id: string,
  custom: readonly CustomAssistant[],
  isPrivate = false,
): Assistant | null {
  return assistantList(custom, isPrivate).find((a) => a.id === id) ?? null;
}

/** The assistant the toolbar button opens: the chosen one, or Claude if that one is gone. */
export function defaultAssistant(
  id: string,
  custom: readonly CustomAssistant[],
  isPrivate = false,
): Assistant {
  return (
    findAssistant(id, custom, isPrivate) ??
    findAssistant(DEFAULT_ASSISTANT_ID, custom, isPrivate) ??
    BUILTIN_ASSISTANTS[0]
  );
}

// ---- Claude with an API key ----

export const AI_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", hint: "Most capable" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", hint: "Fast and capable" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", hint: "Fastest, lowest cost" },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];
export const AI_MODEL_IDS: readonly AiModelId[] = AI_MODELS.map((m) => m.id);
export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-5-5";

/** Where people make an API key. */
export const API_KEYS_URL = "https://platform.claude.com/settings/keys";

/** Looks like an Anthropic API key (the API itself decides whether it is one). */
export function isPlausibleApiKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{16,400}$/.test(key);
}

// ---- "Send the page to the assistant" ----

/** How much of a selection goes into the message box. */
export const MAX_SELECTION = 6000;

export interface PageContext {
  title: string;
  url: string;
  /** The text selected on the page, if any. */
  selection?: string;
}

/**
 * The short prompt put into the assistant's message box: the page, and the
 * selected text if there is some. It ends ready for the person's own
 * question; nothing is sent for them.
 */
export function pagePrompt(page: PageContext): string {
  const title = page.title.replace(/\s+/g, " ").trim();
  const lines = [title && title !== page.url ? `Page: ${title}` : "", `URL: ${page.url}`].filter(
    Boolean,
  );
  const selection = (page.selection ?? "").replace(/\r\n?/g, "\n").trim();
  if (selection) {
    const cut = selection.length > MAX_SELECTION;
    lines.push(
      "",
      cut ? "Selected text (shortened):" : "Selected text:",
      `"""`,
      cut ? `${selection.slice(0, MAX_SELECTION)}…` : selection,
      `"""`,
    );
  }
  return `${lines.join("\n")}\n\n`;
}

// ---- The chat of the API assistant, as its page shows it ----

export type AiToolStatus = "running" | "done" | "failed" | "denied";

export type AiChatItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string }
  /** One tool call, as a compact row: "Read the page", "Clicked ‘Sign in’". */
  | { kind: "tool"; id: number; label: string; status: AiToolStatus }
  /** Something the person should know: an error, a refusal, a cut-off answer. */
  | { kind: "notice"; id: number; tone: "error" | "info"; text: string; needsKey?: boolean };

/** The assistant wants to act and waits for the person's answer. */
export interface AiApproval {
  id: number;
  /** "Click “Sign in”", "Open https://example.com/". */
  summary: string;
  /** Where: the site the action happens on. */
  site: string;
  /** A password or payment field: asked every time, never "for this chat". */
  sensitive: boolean;
}

export type AiApprovalAnswer = "once" | "chat" | "deny";
export const AI_APPROVAL_ANSWERS: readonly AiApprovalAnswer[] = ["once", "chat", "deny"];

export interface AiKeyStatus {
  hasKey: boolean;
  /**
   * False when the system has no keyring to encrypt with: the key is then
   * kept in memory only, until Luma closes.
   */
  persistent: boolean;
}

export interface AiChatState extends AiKeyStatus {
  /** False in private windows: the assistant doesn't act there. */
  available: boolean;
  model: AiModelId;
  askBeforeActing: boolean;
  /** "Allow for this chat" was chosen. */
  allowedForChat: boolean;
  running: boolean;
  items: AiChatItem[];
  approval: AiApproval | null;
}
