import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The longest a change waits for its write while more changes keep coming. */
const MAX_WAIT = 10_000;

/**
 * A value kept in a JSON file. Reads happen once at start-up; writes are
 * debounced and atomic (a temporary file renamed over the old one), so a
 * crash in the middle of a write never leaves a half-written profile.
 */
export class JsonStore<T> {
  private timer: NodeJS.Timeout | null = null;
  /** When the oldest change not yet written was made. */
  private pendingSince = 0;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private value: T,
    private readonly serialize: (value: T) => unknown,
    private readonly delay: number,
  ) {}

  static load<T>(
    file: string,
    parse: (raw: unknown) => T,
    options: { serialize?: (value: T) => unknown; delay?: number } = {},
  ): JsonStore<T> {
    let raw: unknown = undefined;
    try {
      if (existsSync(file)) raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.warn(`[store] ${file} is unreadable, starting fresh:`, err);
    }
    return new JsonStore(file, parse(raw), options.serialize ?? ((v) => v), options.delay ?? 1000);
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    this.value = value;
    this.changed();
  }

  /** Call after mutating the value in place. */
  changed(): void {
    const now = Date.now();
    if (this.timer) clearTimeout(this.timer);
    else this.pendingSince = now;
    // Debounced, but a value that never stops changing (a page whose title
    // ticks) is still written at least every ten seconds.
    const wait = Math.max(0, Math.min(this.delay, this.pendingSince + MAX_WAIT - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writing = this.writing
        .then(() => this.writeAsync())
        .catch((err: unknown) => {
          console.warn(`[store] could not save ${this.file}:`, err);
        });
    }, wait);
  }

  /** Writes pending changes right away (used when quitting). */
  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.serialize(this.value)));
      renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[store] could not save ${this.file}:`, err);
    }
  }

  private async writeAsync(): Promise<void> {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.serialize(this.value)));
    await rename(tmp, this.file);
  }
}
