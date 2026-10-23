/**
 * Links and files other apps hand to Moon Browser. On Windows and Linux they
 * come on the command line; macOS sends them as events (open-url,
 * open-file) instead, often before the browser has started. Those are held
 * here until it is ready.
 */

/** A link from another app that may open as a tab: web addresses and local files only. */
export function linkFromOtherApp(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" || protocol === "file:" ? url : null;
  } catch {
    return null;
  }
}

/** Holds links until the browser can open them, then hands them on at once. */
export class LaunchQueue {
  private pending: string[] = [];
  private open: ((urls: string[]) => void) | null = null;

  add(url: string): void {
    const link = linkFromOtherApp(url);
    if (!link) return;
    if (this.open) this.open([link]);
    else this.pending.push(link);
  }

  /** The browser is ready: returns what came in so far; later links go to `open`. */
  ready(open: (urls: string[]) => void): string[] {
    this.open = open;
    const urls = this.pending;
    this.pending = [];
    return urls;
  }
}
