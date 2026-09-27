/**
 * Moon Browser's own dialogs (DialogInfo): the questions other browsers ask
 * in the system's message box, asked in the night-sky look over the
 * window. Enter takes the suggested answer, Escape dismisses.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { DialogGlyph, DialogInfo } from "@shared/types";
import {
  DownloadIcon,
  ExternalIcon,
  FolderIcon,
  GlobeIcon,
  PuzzleIcon,
  ShieldIcon,
  TrashIcon,
  WarningIcon,
} from "@theme/icons";
import { ui } from "./store";

const GLYPHS: Record<DialogGlyph, (size: number) => ReactNode> = {
  extension: (size) => <PuzzleIcon size={size} />,
  permission: (size) => <ShieldIcon size={size} />,
  download: (size) => <DownloadIcon size={size} />,
  leave: (size) => <ExternalIcon size={size} />,
  remove: (size) => <TrashIcon size={size} />,
  page: (size) => <GlobeIcon size={size} />,
  folder: (size) => <FolderIcon size={size} />,
};

const BUTTON_CLASS = {
  primary: "mb-btn mb-btn-primary",
  secondary: "mb-btn mb-btn-ghost",
  danger: "mb-btn mb-btn-danger",
} as const;

export function MoonDialog({ dialog }: { dialog: DialogInfo }) {
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [text, setText] = useState(dialog.input?.value ?? "");
  const [checked, setChecked] = useState(false);
  /** A picture that doesn't load (a site without a favicon) gives way to the glyph. */
  const [imageFailed, setImageFailed] = useState(false);
  const answer = (response: number) =>
    void ui.command({
      type: "answerDialog",
      id: dialog.id,
      response,
      text: dialog.input ? text : undefined,
      checked: dialog.checkbox ? checked : undefined,
    });

  // The text field or the suggested answer has the focus, so Enter takes it.
  useEffect(() => {
    if (field.current) {
      field.current.focus();
      field.current.select();
      return;
    }
    card.current
      ?.querySelector<HTMLButtonElement>(`[data-dialog-button="${dialog.defaultId}"]`)
      ?.focus();
  }, [dialog.id, dialog.defaultId]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      answer(dialog.cancelId);
    } else if (event.key === "Enter" && event.target === field.current) {
      event.preventDefault();
      answer(dialog.defaultId);
    } else if (event.key === "Tab") {
      // The focus stays in the dialog.
      const stops = [...(card.current?.querySelectorAll<HTMLElement>("input, button") ?? [])];
      if (!stops.length) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      event.preventDefault();
      stops[next].focus();
    }
  };

  const warning = dialog.tone === "warning";
  return (
    <div className="mb-dialog-backdrop" onKeyDown={onKeyDown}>
      <div
        ref={card}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="mb-dialog"
        data-tone={dialog.tone}
      >
        <div className="mb-dialog-sky" aria-hidden="true">
          <span className="mb-dialog-moon" />
          <span className="mb-dialog-star" style={{ top: 9, right: 64 }} />
          <span className="mb-dialog-star" style={{ top: 15, right: 118 }} />
          <span className="mb-dialog-star" style={{ top: 48, right: 16 }} />
        </div>
        <div className="mb-dialog-head">
          <div className="mb-dialog-medallion">
            {dialog.image && !imageFailed ? (
              <>
                <img
                  src={dialog.image}
                  alt=""
                  width={40}
                  height={40}
                  onError={() => setImageFailed(true)}
                />
                <span className="mb-dialog-badge">{GLYPHS[dialog.glyph](11)}</span>
              </>
            ) : warning ? (
              <WarningIcon size={26} />
            ) : (
              GLYPHS[dialog.glyph](24)
            )}
          </div>
          <div className="min-w-0">
            {dialog.eyebrow && <p className="mb-dialog-eyebrow">{dialog.eyebrow}</p>}
            <h2 id={titleId} className="mb-dialog-title">
              {dialog.title}
            </h2>
          </div>
        </div>
        <div id={bodyId} className="mb-dialog-body">
          {dialog.message && <p>{dialog.message}</p>}
          {dialog.list && dialog.list.items.length > 0 && (
            <div className="mb-dialog-list">
              <p className="mb-dialog-list-label">{dialog.list.label}</p>
              <ul>
                {dialog.list.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {dialog.notes?.map((note) => (
            <p key={note} className="mb-dialog-note">
              {note}
            </p>
          ))}
          {dialog.input && (
            <input
              ref={field}
              className="mb-dialog-input"
              aria-label={dialog.title}
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {dialog.checkbox && (
            <label className="mb-dialog-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              {dialog.checkbox}
            </label>
          )}
        </div>
        <div className="mb-dialog-actions">
          {dialog.buttons.map((button, index) => (
            <button
              key={button.label}
              type="button"
              data-dialog-button={index}
              className={BUTTON_CLASS[button.style]}
              onClick={() => answer(index)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
