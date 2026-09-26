/**
 * Whether Moon Browser is the system's default browser, and making it so.
 *
 * Windows doesn't let apps make themselves the default browser: the
 * installer registers Moon Browser, and "Make default" opens the system
 * settings with Moon Browser preselected. On Linux, xdg-settings sets it
 * directly.
 */
import { app, shell } from "electron";
import { execFile } from "node:child_process";

const execText = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (_err, stdout) =>
      resolve(String(stdout ?? "")),
    ),
  );

const linuxDesktopFile = () => process.env.CHROME_DESKTOP || "moon-browser.desktop";

async function query(): Promise<boolean> {
  if (process.platform === "win32") {
    // The user's choice, as Windows records it.
    const out = await execText("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
      "/v",
      "ProgId",
    ]);
    return /MoonBrowserURL/.test(out);
  }
  if (process.platform === "linux") {
    const out = await execText("xdg-settings", ["get", "default-web-browser"]);
    return out.trim() === linuxDesktopFile();
  }
  return app.isDefaultProtocolClient("https");
}

export class DefaultBrowser {
  /** null until the first check. */
  private value: boolean | null = null;
  private lastCheck = 0;
  private pending: Promise<boolean> | null = null;

  constructor(private readonly onChange: () => void) {}

  /** The last known answer; true while unknown, so nothing nags before the first check. */
  get isDefault(): boolean {
    return this.value ?? true;
  }

  /** Asks the system again (at most every 20 seconds unless forced). */
  refresh(force = false): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!force && this.value !== null && Date.now() - this.lastCheck < 20_000)
      return Promise.resolve(this.value);
    this.pending = query()
      .catch(() => this.value ?? true)
      .then((value) => {
        this.pending = null;
        this.lastCheck = Date.now();
        if (value !== this.value) {
          this.value = value;
          this.onChange();
        }
        return value;
      });
    return this.pending;
  }

  async make(): Promise<boolean> {
    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:defaultapps?registeredAppUser=Moon%20Browser");
      // The choice happens in the Settings app; the next window focus checks again.
      this.lastCheck = 0;
      return this.isDefault;
    }
    if (process.platform === "linux") {
      await execText("xdg-settings", ["set", "default-web-browser", linuxDesktopFile()]);
    } else {
      app.setAsDefaultProtocolClient("http");
      app.setAsDefaultProtocolClient("https");
    }
    return this.refresh(true);
  }
}
