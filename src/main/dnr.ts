/**
 * chrome.declarativeNetRequest for the browsing session. Electron takes
 * the API calls but applies no rules; here each extension's rules are kept
 * — static rulesets from its package, dynamic rules in the profile,
 * session rules until Moon Browser quits — and src/main/sessions.ts asks
 * them what to do with every web request.
 */
import type { Extension } from "electron";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  applyHeaders,
  compileRule,
  evaluate,
  isRegexSupported,
  parseRule,
  redirectTarget,
  RESOURCE_TYPES,
  type CompiledRule,
  type DnrRequest,
  type ResourceType,
  type Rule,
} from "@shared/dnr";
import { hasSiteAccess, type ManifestLike } from "@shared/extensions";
import { profilePath } from "./paths";
import { JsonStore } from "./store";

export const DYNAMIC_RULESET = "_dynamic";
export const SESSION_RULESET = "_session";
const MAX_DYNAMIC_RULES = 30_000;
const MAX_SESSION_RULES = 5_000;
const MAX_STATIC_RULES = 330_000;
const MAX_REGEX_RULES = 1_000;
const MAX_ENABLED_RULESETS = 50;

interface Stored {
  dynamic: Rule[];
  /** Set once the extension changes which static rulesets are on. */
  enabledRulesets?: string[];
  /** Static rules the extension switched off, by ruleset. */
  disabledStatic?: Record<string, number[]>;
}

interface Active {
  id: string;
  manifest: ManifestLike;
  /** Only declarativeNetRequestWithHostAccess: every rule needs host access. */
  hostAccessOnly: boolean;
  staticSets: Map<string, { enabled: boolean; rules: Rule[] }>;
  compiled: CompiledRule[];
  hasHeaderRules: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function parseStore(raw: unknown): Record<string, Stored> {
  const out: Record<string, Stored> = {};
  if (!isObj(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[a-p]{32}$/.test(id) || !isObj(value)) continue;
    const dynamic: Rule[] = [];
    for (const r of Array.isArray(value.dynamic) ? value.dynamic : []) {
      try {
        dynamic.push(parseRule(r));
      } catch {
        // Dropped: it can't have been valid when it was stored.
      }
    }
    const stored: Stored = { dynamic };
    if (Array.isArray(value.enabledRulesets))
      stored.enabledRulesets = value.enabledRulesets.filter(
        (s): s is string => typeof s === "string",
      );
    if (isObj(value.disabledStatic)) {
      stored.disabledStatic = {};
      for (const [set, ids] of Object.entries(value.disabledStatic))
        if (Array.isArray(ids))
          stored.disabledStatic[set] = ids.filter((n): n is number => Number.isInteger(n));
    }
    out[id] = stored;
  }
  return out;
}

function inside(root: string, rel: string): string | null {
  const full = normalize(join(root, rel));
  return full.startsWith(root + sep) ? full : null;
}

const ids = (v: unknown, what: string): number[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((n) => Number.isInteger(n)))
    throw new Error(`${what} must be a list of rule IDs`);
  return v as number[];
};

export class Dnr {
  private readonly store = JsonStore.load(profilePath("dnr.json"), parseStore);
  private readonly sessionRules = new Map<string, Rule[]>();
  private readonly active = new Map<string, Active>();
  /** allowAllRequests matched by a tab's page: webContents id → extension → priority. */
  private readonly pageAllow = new Map<number, Map<string, number>>();

  /** An extension with a declarativeNetRequest permission was loaded. */
  async load(ext: Extension): Promise<void> {
    const manifest = ext.manifest as ManifestLike & {
      permissions?: unknown;
      declarative_net_request?: { rule_resources?: unknown };
    };
    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const plain = permissions.includes("declarativeNetRequest");
    if (!plain && !permissions.includes("declarativeNetRequestWithHostAccess")) return;
    const staticSets = new Map<string, { enabled: boolean; rules: Rule[] }>();
    const resources = manifest.declarative_net_request?.rule_resources;
    let total = 0;
    for (const res of Array.isArray(resources) ? resources.slice(0, 100) : []) {
      if (!isObj(res) || typeof res.id !== "string" || typeof res.path !== "string") continue;
      const file = inside(ext.path, res.path);
      const rules: Rule[] = [];
      try {
        const list = file ? (JSON.parse(await readFile(file, "utf8")) as unknown) : null;
        for (const raw of Array.isArray(list) ? list : []) {
          if (total >= MAX_STATIC_RULES) break;
          try {
            rules.push(parseRule(raw));
            total++;
          } catch {
            // Chrome skips invalid static rules too.
          }
        }
      } catch {
        // A missing or broken ruleset file: nothing to apply.
      }
      staticSets.set(res.id, { enabled: res.enabled === true, rules });
    }
    this.active.set(ext.id, {
      id: ext.id,
      manifest,
      hostAccessOnly: !plain,
      staticSets,
      compiled: [],
      hasHeaderRules: false,
    });
    this.recompile(ext.id);
  }

  unload(id: string): void {
    this.active.delete(id);
  }

  /** The extension was removed: its rules go with it. */
  forget(id: string): void {
    this.active.delete(id);
    this.sessionRules.delete(id);
    const all = this.store.get();
    if (all[id]) {
      delete all[id];
      this.store.changed();
    }
  }

  private stored(id: string): Stored {
    const all = this.store.get();
    return (all[id] ??= { dynamic: [] });
  }

  private enabledSets(ext: Active): string[] {
    const chosen = this.store.get()[ext.id]?.enabledRulesets;
    return [...ext.staticSets]
      .filter(([setId, set]) => (chosen ? chosen.includes(setId) : set.enabled))
      .map(([setId]) => setId);
  }

  private recompile(id: string): void {
    const ext = this.active.get(id);
    if (!ext) return;
    const stored = this.store.get()[id];
    const compiled: CompiledRule[] = [];
    for (const setId of this.enabledSets(ext)) {
      const off = new Set(stored?.disabledStatic?.[setId] ?? []);
      for (const rule of ext.staticSets.get(setId)?.rules ?? [])
        if (!off.has(rule.id)) compiled.push(compileRule(rule, setId));
    }
    for (const rule of stored?.dynamic ?? []) compiled.push(compileRule(rule, DYNAMIC_RULESET));
    for (const rule of this.sessionRules.get(id) ?? [])
      compiled.push(compileRule(rule, SESSION_RULESET));
    ext.compiled = compiled;
    ext.hasHeaderRules = compiled.some((r) => r.rule.action.type === "modifyHeaders");
  }

  // ---- The API (chrome.declarativeNetRequest.*) ----

  call(id: string, method: string, arg: unknown): unknown {
    const opts = isObj(arg) ? arg : {};
    switch (method) {
      case "updateDynamicRules":
        return this.updateRules(id, opts, false);
      case "getDynamicRules":
        return this.filterRules(this.store.get()[id]?.dynamic ?? [], opts);
      case "updateSessionRules":
        return this.updateRules(id, opts, true);
      case "getSessionRules":
        return this.filterRules(this.sessionRules.get(id) ?? [], opts);
      case "updateEnabledRulesets":
        return this.updateEnabledRulesets(id, opts);
      case "getEnabledRulesets": {
        const ext = this.active.get(id);
        return ext ? this.enabledSets(ext) : [];
      }
      case "updateStaticRules":
        return this.updateStaticRules(id, opts);
      case "getDisabledRuleIds":
        return this.store.get()[id]?.disabledStatic?.[String(opts.rulesetId)] ?? [];
      case "getAvailableStaticRuleCount": {
        const ext = this.active.get(id);
        const used = ext
          ? this.enabledSets(ext).reduce(
              (n, s) => n + (ext.staticSets.get(s)?.rules.length ?? 0),
              0,
            )
          : 0;
        return Math.max(0, MAX_STATIC_RULES - used);
      }
      case "isRegexSupported":
        return typeof opts.regex === "string" && isRegexSupported(opts.regex)
          ? { isSupported: true }
          : { isSupported: false, reason: "syntaxError" };
      case "testMatchOutcome":
        return this.testMatchOutcome(id, opts);
      case "getMatchedRules":
        return { rulesMatchedInfo: [] };
      case "setExtensionActionOptions":
        return undefined;
      default:
        throw new Error(`chrome.declarativeNetRequest.${method} isn't available in Moon Browser`);
    }
  }

  private filterRules(rules: Rule[], opts: Record<string, unknown>): Rule[] {
    const wanted = Array.isArray(opts.ruleIds) ? new Set(opts.ruleIds) : null;
    return rules.filter((r) => !wanted || wanted.has(r.id));
  }

  private updateRules(id: string, opts: Record<string, unknown>, session: boolean): void {
    const remove = new Set(ids(opts.removeRuleIds, "removeRuleIds"));
    const add = Array.isArray(opts.addRules) ? opts.addRules.map((r) => parseRule(r)) : [];
    const current = session ? (this.sessionRules.get(id) ?? []) : this.stored(id).dynamic;
    const next = current.filter((r) => !remove.has(r.id));
    for (const rule of add) {
      if (next.some((r) => r.id === rule.id))
        throw new Error(`Rule with id ${rule.id} already exists`);
      next.push(rule);
    }
    const max = session ? MAX_SESSION_RULES : MAX_DYNAMIC_RULES;
    if (next.length > max) throw new Error(`More than ${max} rules`);
    if (next.filter((r) => r.condition.regexFilter).length > MAX_REGEX_RULES)
      throw new Error(`More than ${MAX_REGEX_RULES} regex rules`);
    if (session) this.sessionRules.set(id, next);
    else {
      this.stored(id).dynamic = next;
      this.store.changed();
    }
    this.recompile(id);
  }

  private updateEnabledRulesets(id: string, opts: Record<string, unknown>): void {
    const ext = this.active.get(id);
    if (!ext) return;
    const list = (v: unknown) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
    const enable = list(opts.enableRulesetIds);
    const disable = list(opts.disableRulesetIds);
    for (const setId of [...enable, ...disable])
      if (!ext.staticSets.has(setId)) throw new Error(`Invalid ruleset id: ${setId}`);
    const next = new Set(this.enabledSets(ext));
    for (const setId of disable) next.delete(setId);
    for (const setId of enable) next.add(setId);
    if (next.size > MAX_ENABLED_RULESETS)
      throw new Error(`More than ${MAX_ENABLED_RULESETS} enabled rulesets`);
    this.stored(id).enabledRulesets = [...next];
    this.store.changed();
    this.recompile(id);
  }

  private updateStaticRules(id: string, opts: Record<string, unknown>): void {
    const ext = this.active.get(id);
    const setId = String(opts.rulesetId);
    if (!ext?.staticSets.has(setId)) throw new Error(`Invalid ruleset id: ${setId}`);
    const stored = this.stored(id);
    const off = new Set(stored.disabledStatic?.[setId] ?? []);
    for (const n of ids(opts.disableRuleIds, "disableRuleIds")) off.add(n);
    for (const n of ids(opts.enableRuleIds, "enableRuleIds")) off.delete(n);
    stored.disabledStatic = { ...stored.disabledStatic, [setId]: [...off] };
    this.store.changed();
    this.recompile(id);
  }

  private testMatchOutcome(id: string, opts: Record<string, unknown>) {
    const ext = this.active.get(id);
    if (typeof opts.url !== "string" || typeof opts.type !== "string")
      throw new Error("testMatchOutcome needs url and type");
    const type = (RESOURCE_TYPES as readonly string[]).includes(opts.type)
      ? (opts.type as ResourceType)
      : "other";
    const initiator = typeof opts.initiator === "string" ? opts.initiator : null;
    const out = ext
      ? evaluate(ext.compiled, {
          url: opts.url,
          type,
          method: typeof opts.method === "string" ? opts.method : "get",
          initiator,
          tabId: typeof opts.tabId === "number" ? opts.tabId : -1,
          thirdParty: false,
        })
      : { action: null, headers: [] };
    return {
      matchedRules: [...(out.action ? [out.action] : []), ...out.headers].map((r) => ({
        ruleId: r.rule.id,
        rulesetId: r.rulesetId,
      })),
    };
  }

  // ---- Applying the rules ----

  private access(ext: Active, url: string): boolean {
    return hasSiteAccess(ext.manifest, url);
  }

  /** What the rules do with a request before it is sent: block it, send it elsewhere, or nothing. */
  beforeRequest(req: DnrRequest): { cancel: true } | { redirectURL: string } | null {
    if (!this.active.size) return null;
    if (req.type === "main_frame") this.pageAllow.delete(req.tabId);
    const page = this.pageAllow.get(req.tabId);
    let redirect: string | null = null;
    for (const ext of this.active.values()) {
      if (!ext.compiled.length) continue;
      if (ext.hostAccessOnly && !this.access(ext, req.url)) continue;
      const { action } = evaluate(ext.compiled, req, page?.get(ext.id) ?? null);
      const type = action?.rule.action.type;
      if (!action || !type) continue;
      // Across extensions, blocking wins over redirecting, which wins over allowing.
      if (type === "block") return { cancel: true };
      if (type === "allowAllRequests" && req.type === "main_frame") {
        let byExt = this.pageAllow.get(req.tabId);
        if (!byExt) this.pageAllow.set(req.tabId, (byExt = new Map<string, number>()));
        byExt.set(ext.id, action.rule.priority);
      }
      if (!redirect && (type === "redirect" || type === "upgradeScheme")) {
        if (type === "redirect" && !this.access(ext, req.url)) continue;
        redirect = redirectTarget(action, req.url, ext.id);
      }
    }
    return redirect ? { redirectURL: redirect } : null;
  }

  /** Applies header rules to a request's headers; true if anything changed. */
  requestHeaders(req: DnrRequest, headers: Record<string, string>): boolean {
    return this.headers(req, (rule, touched) =>
      rule.action.requestHeaders
        ? applyHeaders(headers, rule.action.requestHeaders, false, touched)
        : false,
    );
  }

  /** Applies header rules to a response's headers; true if anything changed. */
  responseHeaders(req: DnrRequest, headers: Record<string, string[]>): boolean {
    return this.headers(req, (rule, touched) =>
      rule.action.responseHeaders
        ? applyHeaders(headers, rule.action.responseHeaders, true, touched)
        : false,
    );
  }

  private headers(req: DnrRequest, apply: (rule: Rule, touched: Set<string>) => boolean): boolean {
    let changed = false;
    const touched = new Set<string>();
    const page = this.pageAllow.get(req.tabId);
    for (const ext of this.active.values()) {
      if (!ext.hasHeaderRules || !this.access(ext, req.url)) continue;
      for (const r of evaluate(ext.compiled, req, page?.get(ext.id) ?? null).headers)
        changed = apply(r.rule, touched) || changed;
    }
    return changed;
  }

  /** Whether any loaded extension has rules at all (a cheap check per request). */
  get busy(): boolean {
    for (const ext of this.active.values()) if (ext.compiled.length) return true;
    return false;
  }
}
