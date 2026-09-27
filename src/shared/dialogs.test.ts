import { describe, expect, it } from "vitest";
import { DialogQueue, messageBoxOptions, type DialogSpec } from "./dialogs";

const spec = (title: string): DialogSpec => ({
  tone: "calm",
  glyph: "extension",
  title,
  buttons: [
    { label: "Cancel", style: "secondary" },
    { label: "Add extension", style: "primary" },
  ],
  defaultId: 1,
  cancelId: 0,
});

describe("Moon dialogs", () => {
  it("asks one question at a time, in order", async () => {
    let changes = 0;
    const queue = new DialogQueue(() => changes++);
    const first = queue.ask(spec("first"));
    const second = queue.ask(spec("second"));
    expect(queue.current()?.title).toBe("first");
    queue.answer(queue.current()!.id, 1);
    expect(await first).toBe(1);
    expect(queue.current()?.title).toBe("second");
    // Not a button of the dialog: dismissed.
    queue.answer(queue.current()!.id, 7);
    expect(await second).toBe(0);
    expect(queue.current()).toBeNull();
    expect(changes).toBe(4);
  });

  it("ignores answers to dialogs it isn't asking", async () => {
    const queue = new DialogQueue(() => undefined);
    const asked = queue.ask(spec("one"));
    queue.answer(queue.current()!.id + 100, 1);
    expect(queue.current()?.title).toBe("one");
    queue.answer(queue.current()!.id, 1.5);
    expect(await asked).toBe(0);
  });

  it("dismisses everything when the window goes away", async () => {
    const queue = new DialogQueue(() => undefined);
    const answers = Promise.all([queue.ask(spec("a")), queue.ask(spec("b"))]);
    queue.dismissAll();
    expect(await answers).toEqual([0, 0]);
    expect(queue.current()).toBeNull();
  });

  it("hands back what was typed and ticked, and nothing when dismissed", async () => {
    const queue = new DialogQueue(() => undefined);
    const question = { ...spec("Name?"), input: { value: "Luna" }, checkbox: "No more" };
    const typed = queue.askFull(question);
    queue.answer(queue.current()!.id, 1, "Moon", true);
    expect(await typed).toEqual({ response: 1, text: "Moon", checked: true });
    const untouched = queue.askFull(question);
    queue.answer(queue.current()!.id, 1);
    expect(await untouched).toEqual({ response: 1, text: "Luna", checked: false });
    const dismissed = queue.askFull(question);
    queue.answer(queue.current()!.id, 0, "ignored", true);
    expect(await dismissed).toEqual({ response: 0, text: null, checked: true });
  });

  it("takes a question back when its page goes away", async () => {
    const queue = new DialogQueue(() => undefined);
    const stop = new AbortController();
    const asked = queue.ask(spec("gone"), stop.signal);
    stop.abort();
    expect(await asked).toBe(0);
    expect(queue.current()).toBeNull();
    expect(await queue.ask(spec("late"), stop.signal)).toBe(0);
  });

  it("says the same in the system's message box where no window is left", () => {
    expect(
      messageBoxOptions({
        ...spec("Add “Moon” to Moon Browser?"),
        eyebrow: "Add extension",
        list: { label: "It can", items: ["Read your tabs", "Store data"] },
        notes: ["Extensions run in normal windows, not in private ones."],
      }),
    ).toEqual({
      type: "question",
      buttons: ["Cancel", "Add extension"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: "Add extension",
      message: "Add “Moon” to Moon Browser?",
      detail:
        "It can:\n• Read your tabs\n• Store data\n\nExtensions run in normal windows, not in private ones.",
    });
  });
});
