/**
 * document.execCommand("copy" / "cut" / "paste") for extensions. Chrome lets
 * extensions holding clipboardWrite or clipboardRead use them without a
 * click — NordPass copies passwords this way, in its offscreen document.
 * Electron refuses them in extensions; where it does, this does what Chrome
 * would, through `write` and `read` (the main process, which checks the
 * permission). `read` is null where nothing can answer at once (offscreen
 * documents): paste stays refused there.
 *
 * Put in only for extensions that declare one of the two permissions. Runs
 * in the page's own world (serialized there), so it uses nothing from
 * outside itself.
 */
export function clipboardCommands(
  write: (text: string, html: string) => boolean,
  read: (() => string | null) | null,
): void {
  const own = Object.getOwnPropertyDescriptor(Document.prototype, "execCommand");
  // Put in once.
  if (typeof own?.value !== "function" || (own.value as { moonClipboard?: boolean }).moonClipboard)
    return;
  const native = own.value as (
    this: Document,
    command: string,
    showUI?: boolean,
    value?: string,
  ) => boolean;

  const selected = (doc: Document): string => {
    const el = doc.activeElement;
    if (
      (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) &&
      typeof el.selectionStart === "number"
    )
      return el.value.slice(el.selectionStart, el.selectionEnd ?? el.selectionStart);
    return String(doc.getSelection?.() ?? "");
  };
  const clipboardEvent = (type: string, data: DataTransfer) =>
    new ClipboardEvent(type, {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
      composed: true,
    });

  const execCommand = function execCommand(
    this: Document,
    command: string,
    showUI?: boolean,
    value?: string,
  ): boolean {
    const done = native.call(this, command, showUI, value);
    const name = String(command).toLowerCase();
    if (done || (name !== "copy" && name !== "cut" && name !== "paste")) return done;
    const target = this.activeElement ?? this.body ?? this.documentElement;
    if (!target) return false;
    if (name === "paste") {
      const text = read?.();
      if (typeof text !== "string") return false;
      const data = new DataTransfer();
      data.setData("text/plain", text);
      if (target.dispatchEvent(clipboardEvent("paste", data)))
        native.call(this, "insertText", false, text);
      return true;
    }
    // A listener may put in data of its own (and prevent the default);
    // otherwise the selection is copied.
    const data = new DataTransfer();
    const ownData = !target.dispatchEvent(clipboardEvent(name, data));
    const text = ownData ? data.getData("text/plain") : selected(this);
    const html = ownData ? data.getData("text/html") : "";
    if ((!text && !html) || !write(text, html)) return false;
    if (name === "cut" && !ownData) native.call(this, "delete");
    return true;
  };
  Object.defineProperty(execCommand, "moonClipboard", { value: true });
  Object.defineProperty(Document.prototype, "execCommand", {
    value: execCommand,
    writable: true,
    configurable: true,
  });
}

/** Whether an extension declares clipboardWrite or clipboardRead, maybe as optional. */
export function declaresClipboard(manifest: {
  permissions?: unknown;
  optional_permissions?: unknown;
}): boolean {
  return [manifest.permissions, manifest.optional_permissions].some(
    (list) =>
      Array.isArray(list) && (list.includes("clipboardWrite") || list.includes("clipboardRead")),
  );
}
