/**
 * Chrome extension APIs that neither Electron nor electron-chrome-extensions
 * provide: chrome.sidePanel, chrome.identity, chrome.tabGroups, chrome.search,
 * chrome.debugger, chrome.proxy, the rules of chrome.declarativeNetRequest, and the events
 * runtime.onInstalled and onStartup. Without them, an extension whose service
 * worker calls one at start-up (Claude's side panel, logins through
 * identity.launchWebAuthFlow) crashes before it does anything.
 *
 * Runs in every frame and service worker of the browsing session, but only
 * acts in extensions' own pages and workers. The main process takes the
 * extension's ID from the caller's origin, never from the message.
 */
import { contextBridge, ipcRenderer } from "electron";

const CALL = "moon-ext:call";
const EVENT = "moon-ext:event";
const SUBSCRIBE = "moon-ext:subscribe";

function inExtension(): boolean {
  if (process.type === "service-worker") {
    const href = contextBridge.executeInMainWorld({
      func: () => String(globalThis.location?.href ?? ""),
    }) as string;
    return href.startsWith("chrome-extension://");
  }
  return globalThis.location?.href.startsWith("chrome-extension://") ?? false;
}

/** Runs in the extension's own world: no access to anything outside `bridge`. */
function install(bridge: {
  call: (name: string, ...args: unknown[]) => Promise<unknown>;
  on: (name: string, listener: (...args: unknown[]) => void) => void;
}): void {
  const chrome = (globalThis as { chrome?: Record<string, unknown> }).chrome;
  const runtime = chrome?.runtime as { id?: string; getManifest?: () => unknown } | undefined;
  if (!chrome || !runtime?.id) return;

  // Chromium also offers the APIs as `browser` (as Firefox does), but as a
  // separate object holding only Electron's own APIs: an extension that
  // prefers `browser` (NordPass) would miss everything added to `chrome`
  // — contextMenus, windows, privacy, … — and fail to start. In Chrome both
  // name the same object; here too.
  if ((globalThis as { browser?: unknown }).browser !== chrome) {
    try {
      Object.defineProperty(globalThis, "browser", {
        value: chrome,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } catch {
      (globalThis as { browser?: unknown }).browser = chrome;
    }
  }
  const id = runtime.id;
  const manifest = (runtime.getManifest?.() ?? {}) as { permissions?: unknown };
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const has = (p: string) => permissions.includes(p);

  // Chrome's calling convention: a promise, or a callback as the last argument.
  const fn =
    (name: string) =>
    (...args: unknown[]): unknown => {
      const last = args[args.length - 1];
      const callback = typeof last === "function" ? (args.pop() as (v?: unknown) => void) : null;
      const result = bridge.call(name, ...args);
      if (!callback) return result;
      result.then(
        (v) => callback(v),
        (err: unknown) => {
          console.error(`chrome.${name}:`, err);
          callback();
        },
      );
      return undefined;
    };
  const rejecting = (message: string) => () => Promise.reject(new Error(message));
  const event = (name: string) => {
    const listeners = new Set<(...a: unknown[]) => void>();
    let subscribed = false;
    const dispatch = (...a: unknown[]) => {
      for (const l of listeners) {
        try {
          l(...a);
        } catch (err) {
          console.error(err);
        }
      }
    };
    return {
      addListener(l: (...a: unknown[]) => void) {
        listeners.add(l);
        if (!subscribed) {
          subscribed = true;
          bridge.on(name, dispatch);
        }
      },
      removeListener(l: (...a: unknown[]) => void) {
        listeners.delete(l);
      },
      hasListener(l: (...a: unknown[]) => void) {
        return listeners.has(l);
      },
      hasListeners() {
        return listeners.size > 0;
      },
    };
  };
  const define = (name: string, value: unknown) => {
    if (chrome[name] !== undefined) return;
    try {
      Object.defineProperty(chrome, name, { value, enumerable: true, configurable: true });
    } catch {
      // chrome is frozen: nothing to add to
    }
  };

  if (has("sidePanel")) {
    define("sidePanel", {
      setPanelBehavior: fn("sidePanel.setPanelBehavior"),
      getPanelBehavior: fn("sidePanel.getPanelBehavior"),
      setOptions: fn("sidePanel.setOptions"),
      getOptions: fn("sidePanel.getOptions"),
      open: fn("sidePanel.open"),
      close: fn("sidePanel.close"),
      getLayout: () => Promise.resolve({ side: "right" }),
      onOpened: event("sidePanel.onOpened"),
      onClosed: event("sidePanel.onClosed"),
      Side: { LEFT: "left", RIGHT: "right" },
    });
  }

  if (has("identity")) {
    define("identity", {
      getRedirectURL: (path = "") =>
        `https://${id}.chromiumapp.org/${String(path).replace(/^\/+/, "")}`,
      launchWebAuthFlow: fn("identity.launchWebAuthFlow"),
      getAuthToken: rejecting("Signing in with a Google account isn't available in Moon Browser."),
      getProfileUserInfo: () => Promise.resolve({ email: "", id: "" }),
      getAccounts: () => Promise.resolve([]),
      removeCachedAuthToken: () => Promise.resolve(),
      clearAllCachedAuthTokens: () => Promise.resolve(),
      onSignInChanged: event("identity.onSignInChanged"),
      AccountStatus: { SYNC: "SYNC", ANY: "ANY" },
    });
  }

  if (has("tabGroups")) {
    define("tabGroups", {
      TAB_GROUP_ID_NONE: -1,
      Color: {
        GREY: "grey",
        BLUE: "blue",
        RED: "red",
        YELLOW: "yellow",
        GREEN: "green",
        PINK: "pink",
        PURPLE: "purple",
        CYAN: "cyan",
        ORANGE: "orange",
      },
      query: fn("tabGroups.query"),
      get: fn("tabGroups.get"),
      update: fn("tabGroups.update"),
      move: rejecting("Moving tab groups isn't available in Moon Browser."),
      onCreated: event("tabGroups.onCreated"),
      onUpdated: event("tabGroups.onUpdated"),
      onRemoved: event("tabGroups.onRemoved"),
      onMoved: event("tabGroups.onMoved"),
    });
  }

  // chrome.tabs.group/ungroup (no permission needed, as in Chrome).
  const tabs = chrome.tabs as Record<string, unknown> | undefined;
  if (tabs && !tabs.group) {
    try {
      tabs.group = fn("tabs.group");
      tabs.ungroup = fn("tabs.ungroup");
    } catch {
      // chrome.tabs is frozen
    }
  }

  // chrome.runtime.onInstalled / onStartup: Electron never fires them, so
  // Moon Browser does. Should Electron fire one itself, its listeners aren't
  // called a second time.
  const runtimeApi = chrome.runtime as Record<string, unknown>;
  for (const [prop, name] of [
    ["onInstalled", "runtime.onInstalled"],
    ["onStartup", "runtime.onStartup"],
  ] as const) {
    type NativeEvent = {
      addListener(l: (...a: unknown[]) => void): void;
      removeListener(l: (...a: unknown[]) => void): void;
    };
    const native = runtimeApi[prop] as NativeEvent | undefined;
    const ours = event(name);
    let nativeFired = false;
    native?.addListener(() => {
      nativeFired = true;
    });
    const wrapped = new Map<(...a: unknown[]) => void, (...a: unknown[]) => void>();
    try {
      Object.defineProperty(runtimeApi, prop, {
        value: {
          addListener(l: (...a: unknown[]) => void) {
            native?.addListener(l);
            const w = (...a: unknown[]) => {
              if (!nativeFired) l(...a);
            };
            wrapped.set(l, w);
            ours.addListener(w);
          },
          removeListener(l: (...a: unknown[]) => void) {
            native?.removeListener(l);
            const w = wrapped.get(l);
            if (w) ours.removeListener(w);
            wrapped.delete(l);
          },
          hasListener: (l: (...a: unknown[]) => void) => wrapped.has(l),
          hasListeners: () => wrapped.size > 0,
        },
        enumerable: true,
        configurable: true,
      });
    } catch {
      // chrome.runtime is frozen: the native event stays
    }
  }

  // chrome.declarativeNetRequest: Electron accepts the calls but applies no
  // rules; Moon Browser keeps and applies them instead.
  if (has("declarativeNetRequest") || has("declarativeNetRequestWithHostAccess")) {
    const native = (chrome.declarativeNetRequest ?? {}) as Record<string, unknown>;
    const api: Record<string, unknown> = {
      DYNAMIC_RULESET_ID: "_dynamic",
      SESSION_RULESET_ID: "_session",
    };
    // Its constants and enums (MAX_NUMBER_OF_DYNAMIC_RULES, ResourceType, …).
    for (const key of Object.keys(native)) if (/^[A-Z]/.test(key)) api[key] = native[key];
    for (const method of [
      "updateDynamicRules",
      "getDynamicRules",
      "updateSessionRules",
      "getSessionRules",
      "updateEnabledRulesets",
      "getEnabledRulesets",
      "updateStaticRules",
      "getDisabledRuleIds",
      "getAvailableStaticRuleCount",
      "isRegexSupported",
      "testMatchOutcome",
      "getMatchedRules",
      "setExtensionActionOptions",
    ])
      api[method] = fn(`declarativeNetRequest.${method}`);
    api.onRuleMatchedDebug = event("declarativeNetRequest.onRuleMatchedDebug");
    try {
      Object.defineProperty(chrome, "declarativeNetRequest", {
        value: api,
        enumerable: true,
        configurable: true,
      });
    } catch {
      // chrome is frozen
    }
  }

  // chrome.proxy: Electron refuses the calls; Moon Browser sets the proxy.
  if (has("proxy")) {
    try {
      Object.defineProperty(chrome, "proxy", {
        value: {
          settings: {
            get: fn("proxy.settings.get"),
            set: fn("proxy.settings.set"),
            clear: fn("proxy.settings.clear"),
            onChange: event("proxy.settings.onChange"),
          },
          onProxyError: event("proxy.onProxyError"),
          Scope: {
            REGULAR: "regular",
            REGULAR_ONLY: "regular_only",
            INCOGNITO_PERSISTENT: "incognito_persistent",
            INCOGNITO_SESSION_ONLY: "incognito_session_only",
          },
          Mode: {
            DIRECT: "direct",
            AUTO_DETECT: "auto_detect",
            PAC_SCRIPT: "pac_script",
            FIXED_SERVERS: "fixed_servers",
            SYSTEM: "system",
          },
        },
        enumerable: true,
        configurable: true,
      });
    } catch {
      // chrome is frozen
    }
  }

  if (has("search")) {
    define("search", {
      query: fn("search.query"),
      Disposition: { CURRENT_TAB: "CURRENT_TAB", NEW_TAB: "NEW_TAB", NEW_WINDOW: "NEW_WINDOW" },
    });
  }

  if (has("debugger")) {
    define("debugger", {
      attach: fn("debugger.attach"),
      detach: fn("debugger.detach"),
      sendCommand: fn("debugger.sendCommand"),
      getTargets: fn("debugger.getTargets"),
      onEvent: event("debugger.onEvent"),
      onDetach: event("debugger.onDetach"),
    });
  }
}

if (inExtension()) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  ipcRenderer.on(EVENT, (_event, name: string, ...args: unknown[]) => {
    for (const listener of listeners.get(name) ?? []) listener(...args);
  });
  const bridge = {
    call: (name: string, ...args: unknown[]) => ipcRenderer.invoke(CALL, name, ...args),
    on: (name: string, listener: (...args: unknown[]) => void) => {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
        ipcRenderer.send(SUBSCRIBE, name);
      }
      set.add(listener);
    },
  };
  contextBridge.executeInMainWorld({ func: install, args: [bridge] });
}
