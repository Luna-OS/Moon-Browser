/**
 * The Anthropic API key of "Claude (API key)". It is kept encrypted with the
 * system's keyring (Electron's safeStorage: DPAPI on Windows, the Keychain
 * on macOS, the secret service on Linux) in a file of its own in the
 * profile — never in settings.json, and never sent to a renderer: pages
 * only learn whether a key is set.
 *
 * Where the system has nothing to encrypt with (a Linux session without a
 * keyring), the key is not written to disk at all: it stays in memory until
 * Luma closes.
 */
import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isPlausibleApiKey, type AiKeyStatus } from "@shared/ai";
import { profilePath } from "../paths";

export class AiKeyStore {
  private readonly file = profilePath("ai-key.bin");
  /** The key once read or set; undefined until first asked for. */
  private key: string | null | undefined;

  /**
   * Whether the system encrypts for real (not with Chromium's built-in
   * stand-in password). Windows (DPAPI) and macOS (the Keychain) always do —
   * and macOS is not asked: asking opens the Keychain, which may stop and ask
   * the person for their password, just for looking at Settings.
   */
  private canEncrypt(): boolean {
    if (process.platform !== "linux") return true;
    try {
      return (
        safeStorage.isEncryptionAvailable() &&
        safeStorage.getSelectedStorageBackend() !== "basic_text"
      );
    } catch {
      return false;
    }
  }

  /** Only for the main process (the request to Anthropic). */
  get(): string | null {
    if (this.key !== undefined) return this.key;
    this.key = null;
    try {
      if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
        const key = safeStorage.decryptString(readFileSync(this.file));
        if (isPlausibleApiKey(key)) this.key = key;
      }
    } catch (err) {
      // Encrypted on another computer or by another user: it can't be read here.
      console.warn("[moon] the stored API key can't be read:", err);
    }
    return this.key;
  }

  /** Without reading the key: a stored one is only decrypted when a chat needs it. */
  status(): AiKeyStatus {
    const hasKey = this.key !== undefined ? this.key !== null : existsSync(this.file);
    return { hasKey, persistent: this.canEncrypt() };
  }

  set(key: string): AiKeyStatus {
    if (!isPlausibleApiKey(key)) throw new Error("This doesn't look like an Anthropic API key.");
    this.key = key;
    let stored = false;
    if (this.canEncrypt()) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, safeStorage.encryptString(key), { mode: 0o600 });
        stored = true;
      } catch (err) {
        // The Keychain was refused, for one: the key then lasts until Luma closes.
        console.warn("[moon] the API key can't be stored:", err);
      }
    }
    if (!stored) rmSync(this.file, { force: true });
    return { hasKey: true, persistent: stored };
  }

  remove(): AiKeyStatus {
    this.key = null;
    rmSync(this.file, { force: true });
    return this.status();
  }
}
