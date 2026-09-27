import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PermissionKind, PermissionPrompt, WindowState } from "@shared/types";
import {
  BellIcon,
  CameraIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardIcon,
  CloseIcon,
  ExternalIcon,
  MicIcon,
  PinIcon,
  PopupIcon,
} from "@theme/icons";
import { ui } from "./store";

const PROMPTS: Record<PermissionKind, { icon: ReactNode; text: string }> = {
  camera: { icon: <CameraIcon />, text: "wants to use your camera" },
  microphone: { icon: <MicIcon />, text: "wants to use your microphone" },
  "camera-microphone": { icon: <CameraIcon />, text: "wants to use your camera and microphone" },
  geolocation: { icon: <PinIcon />, text: "wants to know your location" },
  notifications: { icon: <BellIcon />, text: "wants to show notifications" },
  "clipboard-read": { icon: <ClipboardIcon />, text: "wants to see what you copied" },
  "open-external": {
    icon: <ExternalIcon size={15} />,
    text: "wants to open an app on your computer",
  },
  popup: { icon: <PopupIcon />, text: "tried to open a pop-up" },
};

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function PromptBar({ prompt }: { prompt: PermissionPrompt }) {
  const [remember, setRemember] = useState(true);
  const info = PROMPTS[prompt.kind];
  const respond = (allow: boolean) =>
    void ui.command({
      type: "respondPrompt",
      id: prompt.id,
      allow,
      remember: remember && prompt.kind !== "open-external",
    });
  const detail =
    prompt.kind === "open-external" && prompt.detail
      ? `${prompt.detail.split(":")[0]}:`
      : prompt.kind === "popup"
        ? prompt.detail
        : undefined;
  return (
    <div className="mb-prompt-bar" role="alert">
      <span className="text-(--mb-accent)">{info.icon}</span>
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold">{hostOf(prompt.origin)}</strong> {info.text}
        {detail && <span className="text-(--mb-text-muted)"> — {detail}</span>}
      </span>
      {prompt.kind !== "open-external" && (
        <label className="flex items-center gap-1.5 text-xs text-(--mb-text-muted)">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember for this site
        </label>
      )}
      <button
        type="button"
        className="mb-btn mb-btn-ghost mb-btn-sm"
        onClick={() => respond(false)}
      >
        Block
      </button>
      <button
        type="button"
        className="mb-btn mb-btn-primary mb-btn-sm"
        onClick={() => respond(true)}
      >
        {prompt.kind === "popup"
          ? "Open pop-up"
          : prompt.kind === "open-external"
            ? "Open app"
            : "Allow"}
      </button>
    </div>
  );
}

export function FindBar({ state, onClose }: { state: WindowState; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const find = (value: string, forward: boolean, findNext: boolean) =>
    void ui.command({ type: "findInPage", text: value, forward, findNext });
  const close = () => {
    void ui.command({ type: "stopFind" });
    onClose();
  };
  const f = state.find;
  return (
    <div className="mb-find-bar" role="search">
      <input
        ref={input}
        className="mb-input w-64"
        placeholder="Find in page"
        aria-label="Find in page"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value) find(e.target.value, true, false);
          else void ui.command({ type: "stopFind" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text) find(text, !e.shiftKey, true);
          if (e.key === "Escape") close();
        }}
      />
      <span className="min-w-20 text-xs text-(--mb-text-muted) tabular-nums" aria-live="polite">
        {text && f ? (f.matches ? `${f.active} of ${f.matches}` : "No results") : ""}
      </span>
      <button
        type="button"
        className="mb-icon-btn"
        aria-label="Previous match"
        disabled={!text}
        onClick={() => find(text, false, true)}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        className="mb-icon-btn"
        aria-label="Next match"
        disabled={!text}
        onClick={() => find(text, true, true)}
      >
        <ChevronDownIcon />
      </button>
      <span className="flex-1" />
      <button type="button" className="mb-icon-btn" aria-label="Close find bar" onClick={close}>
        <CloseIcon />
      </button>
    </div>
  );
}
