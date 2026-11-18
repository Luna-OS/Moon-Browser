/**
 * moon://ai/ — the chat with "Claude (API key)", shown in the side panel.
 * The conversation and the agent live in the main process; this page shows
 * their state as it changes: the messages, what the assistant does in the
 * tabs, and its questions before it acts.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AI_MODELS,
  API_KEYS_URL,
  isPlausibleApiKey,
  type AiApproval,
  type AiChatItem,
  type AiChatState,
  type AiModelId,
} from "@shared/ai";
import { parseMarkdown, type Block, type Inline } from "@shared/markdown";
import {
  CheckIcon,
  CloseIcon,
  KeyIcon,
  PlusIcon,
  SendIcon,
  ShieldIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
} from "@theme/icons";
import "./ai.css";
import { api, useLive } from "./api";

export function AiPage() {
  const [state] = useLive(api.aiState, ["ai", "settings"]);
  const [keyForm, setKeyForm] = useState(false);
  if (!state) return null;

  if (!state.available) {
    return (
      <Centered icon={<SparkleIcon size={22} />} title="Not in private windows">
        “Claude (API key)” reads and acts in your tabs, so it stays out of private windows. The web
        assistants work here: choose one from the list above.
      </Centered>
    );
  }
  if (!state.hasKey || keyForm) {
    return <KeySetup replacing={state.hasKey} onDone={() => setKeyForm(false)} />;
  }
  return <Chat state={state} onSetKey={() => setKeyForm(true)} />;
}

function Centered({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-7 text-center">
      <span className="mb-ai-badge">{icon}</span>
      <h1 className="mb-title m-0 text-xl font-semibold">{title}</h1>
      <p className="m-0 max-w-xs text-sm leading-relaxed text-(--mb-text-muted)">{children}</p>
    </div>
  );
}

/** The first run, and replacing a key: paste it, with where to get one and what it is for. */
function KeySetup({ replacing, onDone }: { replacing: boolean; onDone: () => void }) {
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = key.trim();
    if (!isPlausibleApiKey(value)) {
      setProblem("This doesn't look like an Anthropic API key (it starts with sk-ant-).");
      return;
    }
    setSaving(true);
    try {
      await api.aiSetKey(value);
      onDone();
    } catch {
      setProblem("The key could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col justify-center gap-4 overflow-y-auto px-6 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="mb-ai-badge">
          <SparkleIcon size={22} />
        </span>
        <h1 className="mb-title m-0 text-xl font-semibold">Claude, with your API key</h1>
        <p className="m-0 max-w-xs text-sm leading-relaxed text-(--mb-text-muted)">
          An assistant that reads the page you're on and, when you allow it, clicks, types and opens
          pages for you.
        </p>
      </div>
      <form
        className="mb-glass flex flex-col gap-3 p-4"
        aria-label="Anthropic API key"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs font-medium text-(--mb-text-muted)">
          Anthropic API key
          <input
            className="mb-input font-mono"
            type="password"
            placeholder="sk-ant-…"
            value={key}
            maxLength={512}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setKey(e.target.value);
              setProblem("");
            }}
          />
        </label>
        {problem && (
          <p className="m-0 text-xs text-(--mb-danger)" role="alert">
            {problem}
          </p>
        )}
        <div className="flex items-center gap-2">
          <a
            className="min-w-0 flex-1 text-xs text-(--mb-accent)"
            href={API_KEYS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Get a key at platform.claude.com
          </a>
          {replacing && (
            <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={onDone}>
              Cancel
            </button>
          )}
          <button type="submit" className="mb-btn mb-btn-primary mb-btn-sm" disabled={saving}>
            <KeyIcon size={14} /> Save key
          </button>
        </div>
      </form>
      <p className="m-0 text-xs leading-relaxed text-(--mb-text-faint)">
        Signing in with a Claude subscription (Pro, Max, Team) is only possible on claude.ai —
        choose “Claude” from the list above for that. Anthropic does not let other apps use that
        login, so an assistant that acts inside Luma needs an API key, billed by Anthropic for what
        you use. The key is kept encrypted on this computer and is sent to Anthropic only.
      </p>
    </div>
  );
}

function Chat({ state, onSetKey }: { state: AiChatState; onSetKey: () => void }) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  /** Whether the list follows new text: until the person scrolls up to read. */
  const follow = useRef(true);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  });

  // The message box grows with its text, up to a third of the panel.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.max(120, window.innerHeight / 3))}px`;
  }, [draft]);

  useEffect(() => {
    if (!state.approval) box.current?.focus();
  }, [state.approval]);

  const send = () => {
    const text = draft.trim();
    if (!text || state.running) return;
    follow.current = true;
    setDraft("");
    void api.aiSend(text);
  };

  const last = state.items.at(-1);
  const waiting =
    state.running &&
    !state.approval &&
    !(last?.kind === "assistant") &&
    !(last?.kind === "tool" && last.status === "running");

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 flex-none items-center gap-2 border-b border-(--mb-border) px-3">
        <select
          className="mb-ai-model"
          aria-label="Model"
          title="Model"
          value={state.model}
          onChange={(e) => void api.aiSetModel(e.target.value as AiModelId)}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          title="Start over: this chat is forgotten"
          disabled={state.items.length === 0 && !state.running}
          onClick={() => void api.aiReset()}
        >
          <PlusIcon size={13} /> New chat
        </button>
      </header>

      <div
        ref={list}
        className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4"
        role="log"
        aria-label="Conversation"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {state.items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="mb-ai-badge">
              <SparkleIcon size={22} />
            </span>
            <p className="m-0 max-w-[16rem] text-sm leading-relaxed text-(--mb-text-muted)">
              Ask about the page you're on, or have Claude do something in your tabs.
            </p>
            <p className="m-0 flex max-w-[17rem] items-start gap-2 text-left text-xs leading-relaxed text-(--mb-text-faint)">
              <ShieldIcon />
              <span>
                {state.askBeforeActing
                  ? "Claude reads pages without asking, and asks before it clicks, types or opens anything."
                  : "Claude acts without asking first (Settings → Luma AI) — except in password and payment fields."}
              </span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state.items.map((item) => (
              <Item key={item.id} item={item} onSetKey={onSetKey} />
            ))}
            {waiting && (
              <div className="mb-ai-thinking" role="status">
                <span />
                <span />
                <span />
                <span className="sr-only">Claude is thinking</span>
              </div>
            )}
          </div>
        )}
      </div>

      {state.approval && <ApprovalCard approval={state.approval} />}

      <form
        className="flex-none border-t border-(--mb-border) p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="mb-ai-composer">
          <textarea
            ref={box}
            rows={1}
            aria-label="Message"
            placeholder="Ask Claude about this page…"
            value={draft}
            maxLength={100_000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {state.running ? (
            <button
              type="button"
              className="mb-ai-send"
              data-stop="true"
              aria-label="Stop"
              title="Stop"
              onClick={() => void api.aiStop()}
            >
              <StopIcon size={16} />
            </button>
          ) : (
            <button
              type="submit"
              className="mb-ai-send"
              aria-label="Send"
              title="Send (Enter)"
              disabled={!draft.trim()}
            >
              <SendIcon size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Item({ item, onSetKey }: { item: AiChatItem; onSetKey: () => void }) {
  switch (item.kind) {
    case "user":
      return <div className="mb-ai-user">{item.text}</div>;
    case "assistant":
      return (
        <div className="mb-ai-text">
          <Markdown source={item.text} />
        </div>
      );
    case "tool":
      return (
        <div className="mb-ai-tool" data-status={item.status}>
          {item.status === "running" ? (
            <span className="mb-ai-spinner" aria-hidden="true" />
          ) : item.status === "done" ? (
            <CheckIcon size={13} />
          ) : item.status === "denied" ? (
            <CloseIcon size={13} />
          ) : (
            <WarningIcon size={13} />
          )}
          <span className="min-w-0 flex-1 truncate" title={item.label}>
            {item.status === "denied" && "Not allowed: "}
            {item.status === "failed" && "Didn't work: "}
            {item.label}
          </span>
        </div>
      );
    case "notice":
      return (
        <div
          className="mb-ai-notice"
          data-tone={item.tone}
          role={item.tone === "error" ? "alert" : "status"}
        >
          <span>{item.text}</span>
          {item.needsKey && (
            <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={onSetKey}>
              <KeyIcon size={13} /> Set API key
            </button>
          )}
        </div>
      );
  }
}

/** The assistant's question before it acts: what, where, and three answers. */
function ApprovalCard({ approval }: { approval: AiApproval }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), [approval.id]);
  return (
    <section className="mb-ai-approval" aria-label="Claude asks to act">
      <div className="mb-eyebrow">Claude wants to{approval.site ? ` · ${approval.site}` : ""}</div>
      <p className="m-0 text-sm leading-snug break-words">{approval.summary}</p>
      {approval.sensitive && (
        <p className="m-0 text-xs text-(--mb-warning)">
          A password or payment field: Luma asks about these every time.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          className="mb-btn mb-btn-ghost mb-btn-sm"
          onClick={() => void api.aiApprove(approval.id, "deny")}
        >
          Don't allow
        </button>
        {!approval.sensitive && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            title="Claude may act without asking until you start a new chat"
            onClick={() => void api.aiApprove(approval.id, "chat")}
          >
            Allow for this chat
          </button>
        )}
        <button
          ref={first}
          type="button"
          className="mb-btn mb-btn-primary mb-btn-sm"
          onClick={() => void api.aiApprove(approval.id, "once")}
        >
          Allow once
        </button>
      </div>
    </section>
  );
}

// ---- Markdown, as elements: whatever the text says, it stays text ----

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "bold":
        return <strong key={i}>{inline(node.children)}</strong>;
      case "italic":
        return <em key={i}>{inline(node.children)}</em>;
      case "link":
        return (
          <a key={i} href={node.href} target="_blank" rel="noreferrer">
            {inline(node.children)}
          </a>
        );
    }
  });
}

function block(node: Block, key: number): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{inline(node.children)}</p>;
    case "heading": {
      const Tag = node.level === 1 ? "h2" : node.level === 2 ? "h3" : "h4";
      return <Tag key={key}>{inline(node.children)}</Tag>;
    }
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag key={key}>
          {node.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return <blockquote key={key}>{inline(node.children)}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{node.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} />;
  }
}

function Markdown({ source }: { source: string }) {
  return <>{parseMarkdown(source).map(block)}</>;
}
