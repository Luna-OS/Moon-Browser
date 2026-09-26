import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A value kept in a JSON file. Reads happen once at start-up; writes are
 * debounced and atomic (a temporary file renamed over the old one), so a
 * crash in the middle of a write never leaves a half-written profile.
 */
export class JsonStore<T> {
  private timer: NodeJS.Timeout | null = null;
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writing = this.writing
        .then(() => this.writeAsync())
        .catch((err: unknown) => {
          console.warn(`[store] could not save ${this.file}:`, err);
        });
    }, this.delay);
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
