/**
 * Settings → Luma AI: the toolbar button, the assistant it opens, your own
 * assistants (added and removed here), and "Claude (API key)" — its key
 * (set or removed, never shown), its model, and whether it asks before it
 * acts.
 */
import { useState } from "react";
import {
  AI_MODELS,
  API_KEYS_URL,
  assistantList,
  assistantUrlProblem,
  cleanAssistantName,
  isPlausibleApiKey,
  MAX_CUSTOM_ASSISTANTS,
  normalizeAssistantUrl,
  type AiModelId,
  type CustomAssistant,
} from "@shared/ai";
import { shortcutHint } from "@shared/shortcuts";
import type { Settings } from "@shared/types";
import { KeyIcon, PlusIcon, TrashIcon } from "@theme/icons";
import { api, useLive } from "./api";
import { Card, Row, Toggle } from "./ui";

const newId = () => `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function AiSettings({
  settings,
  platform,
  set,
}: {
  settings: Settings;
  platform: string;
  set: (patch: Partial<Settings>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const own = settings.aiAssistants;

  return (
    <Card
      id="ai"
      title="Luma AI"
      description="Your own AI assistant in a panel next to the page. Luma has no AI of its own and sends nothing anywhere: you choose the assistant, and you sign in to it yourself."
    >
      <Toggle
        label="Show the Luma AI button in the toolbar"
        hint={`${shortcutHint("ai", platform)} opens and closes the panel either way; ${shortcutHint("aiSendPage", platform)} puts the page you're on into the assistant's message box.`}
        checked={settings.showAiButton}
        onChange={(v) => set({ showAiButton: v })}
      />
      <Row
        label="Assistant"
        hint="The one the button opens. The websites (Claude, ChatGPT, …) open in the panel like in a tab: sign in there with your own account."
      >
        <select
          className="mb-input w-56"
          aria-label="Assistant"
          value={settings.aiAssistant}
          onChange={(e) => set({ aiAssistant: e.target.value })}
        >
          {assistantList(own).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Row>
      <Row
        label="Your own assistants"
        hint="Any other assistant with a website — one your company runs, or one on this computer (Open WebUI and the like). It needs an https:// address."
      >
        <button
          type="button"
          className="mb-btn mb-btn-ghost"
          disabled={adding || own.length >= MAX_CUSTOM_ASSISTANTS}
          onClick={() => setAdding(true)}
        >
          <PlusIcon size={15} /> Add assistant
        </button>
      </Row>
      {own.map((a) => (
        <Row key={a.id} label={a.name} hint={<span className="font-mono">{a.url}</span>}>
          <button
            type="button"
            className="mb-icon-btn"
            aria-label={`Remove ${a.name}`}
            onClick={() => set({ aiAssistants: own.filter((o) => o.id !== a.id) })}
          >
            <TrashIcon />
          </button>
        </Row>
      ))}
      {adding && (
        <AssistantForm
          onSave={(assistant) => {
            set({ aiAssistants: [...own, assistant] });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <ApiKeyRow />
      <Row
        label="Model of “Claude (API key)”"
        hint="Opus is the most capable, Haiku the fastest and cheapest. Anthropic bills your API account for what you use."
      >
        <select
          className="mb-input w-64"
          aria-label="Model"
          value={settings.aiModel}
          onChange={(e) => set({ aiModel: e.target.value as AiModelId })}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.hint}
            </option>
          ))}
        </select>
      </Row>
      <Toggle
        label="Ask before the assistant acts"
        hint="“Claude (API key)” reads pages without asking, but shows you every click, every text it types and every page it opens first. Typing into password and payment fields always asks."
        checked={settings.aiAskBeforeActing}
        onChange={(v) => set({ aiAskBeforeActing: v })}
      />
    </Card>
  );
}

function AssistantForm({
  onSave,
  onCancel,
}: {
  onSave: (assistant: CustomAssistant) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tried, setTried] = useState(false);
  const problem = !cleanAssistantName(name) ? "Give it a name." : assistantUrlProblem(url);

  return (
    <form
      className="flex flex-col gap-2.5 border-b border-(--mb-border) px-5 py-3.5 last:border-b-0"
      aria-label="New assistant"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        const address = normalizeAssistantUrl(url);
        if (problem || !address) return;
        onSave({ id: newId(), name: cleanAssistantName(name), url: address });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          className="mb-input min-w-40 flex-1"
          aria-label="Name"
          placeholder="Name, e.g. Team assistant"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="mb-input min-w-60 flex-[2] font-mono"
          aria-label="Address"
          placeholder="https://chat.example.com/"
          value={url}
          maxLength={2048}
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <p className="m-0 min-w-0 flex-1 text-xs text-(--mb-danger)" role="alert">
          {tried ? problem : ""}
        </p>
        <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="mb-btn mb-btn-primary mb-btn-sm">
          Add
        </button>
      </div>
    </form>
  );
}

/** The API key: whether one is set, a field to set it, a button to remove it. It is never shown. */
function ApiKeyRow() {
  const [status, reload] = useLive(api.aiKeyStatus, ["settings"]);
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState("");

  const save = async () => {
    const value = key.trim();
    if (!isPlausibleApiKey(value)) {
      setProblem("This doesn't look like an Anthropic API key (it starts with sk-ant-).");
      return;
    }
    try {
      await api.aiSetKey(value);
      setKey("");
      setEditing(false);
      setProblem("");
      reload();
    } catch {
      setProblem("The key could not be saved.");
    }
  };

  return (
    <>
      <Row
        label="Anthropic API key"
        hint={
          <>
            “Claude (API key)” can read and act in your tabs. Signing in with a Claude subscription
            (Pro, Max, Team) is only possible on claude.ai — the Claude assistant above; Anthropic
            does not let other apps use that login, so an assistant that acts inside Luma needs an
            API key from{" "}
            <a
              className="text-(--mb-accent)"
              href={API_KEYS_URL}
              onClick={(e) => {
                e.preventDefault();
                void api.openUrl(API_KEYS_URL, "foreground");
              }}
            >
              platform.claude.com
            </a>
            .{" "}
            {status?.hasKey
              ? status.persistent
                ? "A key is set. It is kept encrypted on this computer and never shown again."
                : "A key is set. This system has no keyring to encrypt it with, so it is kept only until Luma closes."
              : "No key is set."}
          </>
        }
      >
        <div className="flex items-center gap-1">
          {!editing && (
            <button type="button" className="mb-btn mb-btn-ghost" onClick={() => setEditing(true)}>
              <KeyIcon /> {status?.hasKey ? "Replace key" : "Set key"}
            </button>
          )}
          {status?.hasKey && !editing && (
            <button
              type="button"
              className="mb-icon-btn"
              aria-label="Remove the API key"
              title="Remove the API key"
              onClick={() => void api.aiRemoveKey().then(reload)}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </Row>
      {editing && (
        <form
          className="flex flex-col gap-2.5 border-b border-(--mb-border) px-5 py-3.5 last:border-b-0"
          aria-label="Anthropic API key"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            className="mb-input font-mono"
            type="password"
            aria-label="API key"
            placeholder="sk-ant-…"
            value={key}
            maxLength={512}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <p className="m-0 min-w-0 flex-1 text-xs text-(--mb-danger)" role="alert">
              {problem}
            </p>
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => {
                setEditing(false);
                setKey("");
                setProblem("");
              }}
            >
              Cancel
            </button>
            <button type="submit" className="mb-btn mb-btn-primary mb-btn-sm">
              Save
            </button>
          </div>
        </form>
      )}
    </>
  );
}
