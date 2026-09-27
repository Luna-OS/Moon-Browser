/**
 * Chrome's own members of `window.chrome` on web pages: chrome.loadTimes(),
 * chrome.csi() and chrome.app. Electron gives pages a bare `chrome` object
 * without them, and to Google's sign-in a Chrome with an empty `chrome`
 * looks like an app embedding a browser: "This browser or app may not be
 * secure" (accounts.google.com/v3/signin/rejected). chrome.app alone is
 * what gets past it; the others make the object whole.
 *
 * Runs in the page's world before its scripts (preload/web.ts), so it has
 * to be self-contained. Shapes and values are Chrome's; existing members
 * are left alone.
 */
export function completeChromeObject(): void {
  const g = globalThis as unknown as {
    chrome?: unknown;
    document?: unknown;
    performance?: Performance;
    location?: { protocol: string };
  };
  const chrome = g.chrome;
  if (typeof chrome !== "object" || chrome === null || g.document === undefined) return;

  const put = (target: object, name: string, value: unknown) => {
    if (Object.prototype.hasOwnProperty.call(target, name)) return;
    Object.defineProperty(target, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
  // A proxy keeps the function's name and length and looks native, as
  // Chrome's own functions do.
  const native = <T extends object>(fn: T): T => new Proxy(fn, {});

  const perf = g.performance;
  const timing = perf?.timing;
  const ms = (
    name: "navigationStart" | "responseStart" | "domContentLoadedEventEnd" | "loadEventEnd",
  ) => {
    const value: unknown = timing?.[name];
    return typeof value === "number" ? value : 0;
  };
  const seconds = (value: number) => (value > 0 ? value / 1000 : 0);
  const navigation = () => {
    const entry = perf?.getEntriesByType?.("navigation")[0] as
      { type?: string; nextHopProtocol?: string } | undefined;
    return { type: entry?.type ?? "navigate", protocol: entry?.nextHopProtocol ?? "" };
  };

  put(
    chrome,
    "loadTimes",
    native(function loadTimes() {
      const { type, protocol } = navigation();
      const paint = perf?.getEntriesByType?.("paint").find((e) => e.name === "first-paint");
      const negotiated = g.location?.protocol === "https:" && protocol !== "";
      return {
        requestTime: seconds(ms("navigationStart")),
        startLoadTime: seconds(ms("navigationStart")),
        commitLoadTime: seconds(ms("responseStart")),
        finishDocumentLoadTime: seconds(ms("domContentLoadedEventEnd")),
        finishLoadTime: seconds(ms("loadEventEnd")),
        firstPaintTime: paint && perf ? seconds(perf.timeOrigin + paint.startTime) : 0,
        firstPaintAfterLoadTime: 0,
        navigationType:
          type === "reload" ? "Reload" : type === "back_forward" ? "BackForward" : "Other",
        wasFetchedViaSpdy: protocol === "h2" || protocol === "h3",
        wasNpnNegotiated: negotiated,
        npnNegotiatedProtocol: negotiated ? protocol : "unknown",
        wasAlternateProtocolAvailable: false,
        connectionInfo: protocol || "unknown",
      };
    }),
  );

  put(
    chrome,
    "csi",
    native(function csi() {
      const { type } = navigation();
      const start = ms("navigationStart");
      return {
        startE: start,
        onloadT: ms("domContentLoadedEventEnd"),
        pageT: perf ? perf.now() : 0,
        // Chrome's page transition: 16 a reload, 6 back or forward, 15 the rest.
        tran: type === "reload" ? 16 : type === "back_forward" ? 6 : 15,
      };
    }),
  );

  const app = {};
  put(app, "isInstalled", false);
  put(
    app,
    "getDetails",
    native(function getDetails() {
      return null;
    }),
  );
  put(
    app,
    "getIsInstalled",
    native(function getIsInstalled() {
      return false;
    }),
  );
  put(
    app,
    "installState",
    native(function installState(...args: unknown[]) {
      // Chrome answers the callback later, never right away.
      const callback = args[0];
      if (typeof callback === "function")
        setTimeout(() => (callback as (state: string) => void)("not_installed"), 0);
    }),
  );
  put(
    app,
    "runningState",
    native(function runningState() {
      return "cannot_run";
    }),
  );
  put(app, "InstallState", {
    DISABLED: "disabled",
    INSTALLED: "installed",
    NOT_INSTALLED: "not_installed",
  });
  put(app, "RunningState", {
    CANNOT_RUN: "cannot_run",
    READY_TO_RUN: "ready_to_run",
    RUNNING: "running",
  });
  put(chrome, "app", app);
}
