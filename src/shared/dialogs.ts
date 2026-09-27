/**
 * The questions a window asks in Moon Browser's own dialogs, one at a time:
 * each waits in line until the ones before it are answered, and every one
 * gets an answer — the dismissal one when the window goes away.
 */
import type { DialogInfo } from "./types";

export type DialogSpec = Omit<DialogInfo, "id">;

/** The whole answer: the button, and what was typed and ticked. */
export interface DialogAnswer {
  response: number;
  /** The text field's value (null when the dialog had none or was dismissed). */
  text: string | null;
  checked: boolean;
}

let nextId = 1;

export class DialogQueue {
  private readonly waiting: { info: DialogInfo; resolve: (answer: DialogAnswer) => void }[] = [];

  constructor(private readonly changed: () => void) {}

  /** The dialog on show, if any. */
  current(): DialogInfo | null {
    return this.waiting[0]?.info ?? null;
  }

  ask(spec: DialogSpec, signal?: AbortSignal): Promise<number> {
    return this.askFull(spec, signal).then((a) => a.response);
  }

  /** Like ask(); `signal` takes the question back (its page went away). */
  askFull(spec: DialogSpec, signal?: AbortSignal): Promise<DialogAnswer> {
    const dismissed = (): DialogAnswer => ({ response: spec.cancelId, text: null, checked: false });
    if (signal?.aborted) return Promise.resolve(dismissed());
    return new Promise((resolve) => {
      const id = nextId++;
      this.waiting.push({ info: { ...spec, id }, resolve });
      signal?.addEventListener("abort", () => this.answer(id, -1), { once: true });
      this.changed();
    });
  }

  /** The UI's answer; anything but one of the dialog's buttons counts as dismissing it. */
  answer(id: number, response: number, text?: string, checked = false): void {
    const index = this.waiting.findIndex((d) => d.info.id === id);
    if (index < 0) return;
    const [{ info, resolve }] = this.waiting.splice(index, 1);
    const chosen =
      Number.isInteger(response) && response >= 0 && response < info.buttons.length
        ? response
        : info.cancelId;
    const dismissed = chosen === info.cancelId;
    resolve({
      response: chosen,
      text: info.input && !dismissed ? (text ?? info.input.value) : null,
      checked: !!info.checkbox && checked,
    });
    this.changed();
  }

  /** The window closed: every question is dismissed. */
  dismissAll(): void {
    for (const { info, resolve } of this.waiting.splice(0))
      resolve({ response: info.cancelId, text: null, checked: false });
  }
}

/**
 * The same question as the system's message box, where no window of Moon
 * Browser's is left to ask it in.
 */
export function messageBoxOptions(spec: DialogSpec): {
  type: "question" | "warning";
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: true;
  title: string;
  message: string;
  detail: string;
} {
  const detail = [
    spec.message,
    spec.list?.items.length ? `${spec.list.label}:\n• ${spec.list.items.join("\n• ")}` : undefined,
    ...(spec.notes ?? []),
  ].filter(Boolean);
  return {
    type: spec.tone === "warning" ? "warning" : "question",
    buttons: spec.buttons.map((b) => b.label),
    defaultId: spec.defaultId,
    cancelId: spec.cancelId,
    noLink: true,
    title: spec.eyebrow ?? spec.title,
    message: spec.title,
    detail: detail.join("\n\n"),
  };
}
