import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChromeObject } from "./chrome-object";

const g = globalThis as unknown as Record<string, unknown>;

describe("window.chrome", () => {
  afterEach(() => {
    delete g.chrome;
    delete g.document;
    vi.useRealTimers();
  });

  it("gets Chrome's loadTimes, csi and app, in Chrome's order", () => {
    g.chrome = {};
    g.document = {};
    completeChromeObject();
    const chrome = g.chrome as {
      loadTimes: () => Record<string, unknown>;
      csi: () => Record<string, unknown>;
      app: Record<string, unknown> & {
        getDetails: () => unknown;
        getIsInstalled: () => unknown;
        runningState: () => unknown;
      };
    };
    expect(Object.keys(chrome)).toEqual(["loadTimes", "csi", "app"]);
    expect(Object.keys(chrome.app)).toEqual([
      "isInstalled",
      "getDetails",
      "getIsInstalled",
      "installState",
      "runningState",
      "InstallState",
      "RunningState",
    ]);
    expect(Object.getOwnPropertyDescriptor(chrome, "app")).toMatchObject({
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(chrome.app.isInstalled).toBe(false);
    expect(chrome.app.getDetails()).toBeNull();
    expect(chrome.app.getIsInstalled()).toBe(false);
    expect(chrome.app.runningState()).toBe("cannot_run");
    expect(chrome.app.InstallState).toEqual({
      DISABLED: "disabled",
      INSTALLED: "installed",
      NOT_INSTALLED: "not_installed",
    });
    expect(chrome.app.RunningState).toEqual({
      CANNOT_RUN: "cannot_run",
      READY_TO_RUN: "ready_to_run",
      RUNNING: "running",
    });
    // Native-looking, with their own names.
    expect(Function.prototype.toString.call(chrome.loadTimes)).toContain("[native code]");
    expect((chrome.app.getDetails as { name: string }).name).toBe("getDetails");

    expect(Object.keys(chrome.loadTimes())).toEqual([
      "requestTime",
      "startLoadTime",
      "commitLoadTime",
      "finishDocumentLoadTime",
      "finishLoadTime",
      "firstPaintTime",
      "firstPaintAfterLoadTime",
      "navigationType",
      "wasFetchedViaSpdy",
      "wasNpnNegotiated",
      "npnNegotiatedProtocol",
      "wasAlternateProtocolAvailable",
      "connectionInfo",
    ]);
    expect(Object.keys(chrome.csi())).toEqual(["startE", "onloadT", "pageT", "tran"]);
    expect(chrome.csi().tran).toBe(15);
  });

  it("answers installState later, as Chrome does", () => {
    vi.useFakeTimers();
    g.chrome = {};
    g.document = {};
    completeChromeObject();
    const app = (g.chrome as { app: { installState: (cb: (s: string) => void) => void } }).app;
    const answer = vi.fn();
    app.installState(answer);
    expect(answer).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(answer).toHaveBeenCalledWith("not_installed");
    expect(() => app.installState(undefined as never)).not.toThrow();
  });

  it("keeps what's there and leaves windows without chrome alone", () => {
    const runtime = { id: "x" };
    const app = { isInstalled: true };
    g.chrome = { runtime, app };
    g.document = {};
    completeChromeObject();
    const chrome = g.chrome as Record<string, unknown>;
    expect(chrome.runtime).toBe(runtime);
    expect(chrome.app).toBe(app);
    expect(typeof chrome.loadTimes).toBe("function");

    delete g.chrome;
    completeChromeObject();
    expect(g.chrome).toBeUndefined();
    // Workers have no document: nothing to do there.
    g.chrome = {};
    delete g.document;
    completeChromeObject();
    expect(g.chrome).toEqual({});
  });
});
