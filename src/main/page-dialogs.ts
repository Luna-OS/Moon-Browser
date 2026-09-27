/**
 * A page's alert(), confirm() and prompt() in Moon Browser's own dialog
 * over its tab, where Electron would show the system's message box. The
 * web preload hands them over synchronously — the page waits, as it does
 * for the real ones — and the answer goes back the same way.
 */
import { ipcMain, type IpcMainEvent } from "electron";
import { displayUrl } from "@shared/display";
import { PAGE_DIALOG_CHANNEL, type PageDialogKind, type PageDialogReply } from "@shared/ipc";
import type { DialogSpec } from "@shared/dialogs";
import type { Browser } from "./browser";

/** Longer messages are cut, as Chrome cuts them. */
const MAX_MESSAGE = 10_000;

const isKind = (v: unknown): v is PageDialogKind =>
  v === "alert" || v === "confirm" || v === "prompt";

/** What a page may still do since its last navigation: its dialog count, and whether they're off. */
interface PageState {
  shown: number;
  blocked: boolean;
}

export function installPageDialogs(browser: Browser): void {
  const pages = new Map<number, PageState>();

  ipcMain.on(
    PAGE_DIALOG_CHANNEL,
    (event: IpcMainEvent, kind: unknown, message: unknown, value: unknown) => {
      const reply = (answer: PageDialogReply) => {
        try {
          event.returnValue = answer;
        } catch {
          // The page is gone.
        }
      };
      const contents = event.sender;
      const tab = browser.tabFor(contents.id);
      if (!tab || tab.window.closed || !isKind(kind)) return reply({ native: true });

      let page = pages.get(contents.id);
      if (!page) {
        page = { shown: 0, blocked: false };
        pages.set(contents.id, page);
        const forget = () => pages.delete(contents.id);
        contents.once("destroyed", forget);
        contents.on("did-navigate", () => {
          const current = pages.get(contents.id);
          if (current) Object.assign(current, { shown: 0, blocked: false });
        });
      }
      // Turned off for this page: answered at once, as Chrome does.
      if (page.blocked) return reply({ ok: false, text: null });
      page.shown++;

      const frame = event.senderFrame;
      const host = displayUrl(frame?.origin && frame.origin !== "null" ? frame.origin : "") || "";
      const title = !host
        ? "This page says"
        : frame && frame !== contents.mainFrame
          ? `An embedded page at ${host} says`
          : `${host} says`;
      const text = (typeof message === "string" ? message : "").slice(0, MAX_MESSAGE);
      const spec: DialogSpec = {
        tone: "calm",
        glyph: "page",
        image: tab.info().favicon ?? undefined,
        title,
        message: text || undefined,
        input: kind === "prompt" ? { value: typeof value === "string" ? value : "" } : undefined,
        checkbox: page.shown > 1 ? "Don't let this page show more dialogs" : undefined,
        buttons:
          kind === "alert"
            ? [{ label: "OK", style: "primary" }]
            : [
                { label: "Cancel", style: "secondary" },
                { label: "OK", style: "primary" },
              ],
        defaultId: kind === "alert" ? 0 : 1,
        cancelId: 0,
      };

      // The dialog belongs to its tab: shown with it, taken back if it goes.
      tab.window.command({ type: "activate", tabId: tab.id });
      const gone = new AbortController();
      const abort = () => gone.abort();
      const navigated = (details: { isMainFrame: boolean }) => {
        if (details.isMainFrame) abort();
      };
      contents.once("destroyed", abort);
      contents.on("did-start-navigation", navigated);
      void tab.window.askFull(spec, gone.signal).then((answer) => {
        if (!contents.isDestroyed()) {
          contents.off("destroyed", abort);
          contents.off("did-start-navigation", navigated);
        }
        if (answer.checked) page.blocked = true;
        const ok = kind === "alert" || answer.response === 1;
        reply({ ok, text: ok && kind === "prompt" ? (answer.text ?? "") : null });
      });
    },
  );
}
