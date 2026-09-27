/**
 * chrome.declarativeNetRequest rules: checking them, and matching requests
 * against them the way Chrome does. Electron accepts the API but applies no
 * rules, so Moon Browser does it in its request pipeline.
 *
 * https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
 */

export const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

const ACTION_TYPES = [
  "block",
  "redirect",
  "allow",
  "upgradeScheme",
  "modifyHeaders",
  "allowAllRequests",
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const METHODS = ["connect", "delete", "get", "head", "options", "patch", "post", "put", "other"];

export interface HeaderInfo {
  header: string;
  operation: "set" | "append" | "remove";
  value?: string;
}

export interface QueryKeyValue {
  key: string;
  value: string;
  replaceOnly?: boolean;
}

export interface UrlTransform {
  scheme?: string;
  host?: string;
  port?: string;
  path?: string;
  query?: string;
  queryTransform?: { removeParams?: string[]; addOrReplaceParams?: QueryKeyValue[] };
  fragment?: string;
  username?: string;
  password?: string;
}

export interface Redirect {
  url?: string;
  extensionPath?: string;
  transform?: UrlTransform;
  regexSubstitution?: string;
}

export interface Rule {
  id: number;
  priority: number;
  action: {
    type: ActionType;
    redirect?: Redirect;
    requestHeaders?: HeaderInfo[];
    responseHeaders?: HeaderInfo[];
  };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    isUrlFilterCaseSensitive?: boolean;
    initiatorDomains?: string[];
    excludedInitiatorDomains?: string[];
    requestDomains?: string[];
    excludedRequestDomains?: string[];
    resourceTypes?: ResourceType[];
    excludedResourceTypes?: ResourceType[];
    requestMethods?: string[];
    excludedRequestMethods?: string[];
    domainType?: "firstParty" | "thirdParty";
    tabIds?: number[];
    excludedTabIds?: number[];
  };
}

/** A request as the rules see it. */
export interface DnrRequest {
  url: string;
  method: string;
  type: ResourceType;
  /** The URL of the document that made the request, if any. */
  initiator: string | null;
  tabId: number;
  /** Whether the request goes to another site than the initiator's. */
  thirdParty: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function strings(v: unknown, what: string, lower = false): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string"))
    throw new Error(`${what} must be a list of strings`);
  return lower ? v.map((s: string) => s.toLowerCase()) : v;
}

function types(v: unknown, what: string): ResourceType[] {
  const list = strings(v, what);
  for (const t of list)
    if (!(RESOURCE_TYPES as readonly string[]).includes(t))
      throw new Error(`${what}: unknown resource type "${t}"`);
  return list as ResourceType[];
}

function headers(v: unknown, what: string, response: boolean): HeaderInfo[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${what} must be a non-empty list`);
  return v.map((h) => {
    if (!isObj(h) || typeof h.header !== "string" || !/^[!#$%&'*+.^_`|~\w-]+$/.test(h.header))
      throw new Error(`${what}: a header needs a valid name`);
    const op = h.operation;
    if (op !== "set" && op !== "remove" && op !== "append")
      throw new Error(`${what}: unknown operation`);
    if (op === "remove") return { header: h.header, operation: op };
    if (typeof h.value !== "string") throw new Error(`${what}: "${op}" needs a value`);
    if (
      !response &&
      op === "append" &&
      !/^(accept|accept-encoding|accept-language|cache-control|connection|content-language|cookie|forwarded|if-match|if-none-match|keep-alive|range|te|trailer|transfer-encoding|upgrade|user-agent|via|want-digest|x-forwarded-for)$/i.test(
        h.header,
      )
    )
      throw new Error(`${what}: "${h.header}" can't be appended to`);
    return { header: h.header, operation: op, value: h.value };
  });
}

function redirect(v: unknown): Redirect {
  if (!isObj(v)) throw new Error("a redirect rule needs action.redirect");
  const out: Redirect = {};
  if (typeof v.url === "string") {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v.url)) throw new Error("redirect.url must be a full URL");
    out.url = v.url;
  } else if (typeof v.extensionPath === "string") {
    if (!v.extensionPath.startsWith("/"))
      throw new Error("redirect.extensionPath must start with /");
    out.extensionPath = v.extensionPath;
  } else if (typeof v.regexSubstitution === "string") {
    out.regexSubstitution = v.regexSubstitution;
  } else if (isObj(v.transform)) {
    const t = v.transform;
    const tr: UrlTransform = {};
    for (const key of [
      "scheme",
      "host",
      "port",
      "path",
      "query",
      "fragment",
      "username",
      "password",
    ] as const) {
      if (t[key] !== undefined) {
        if (typeof t[key] !== "string") throw new Error(`transform.${key} must be a string`);
        tr[key] = t[key];
      }
    }
    if (tr.scheme && !/^(https?|ftp|chrome-extension)$/.test(tr.scheme))
      throw new Error("transform.scheme isn't allowed");
    if (isObj(t.queryTransform)) {
      const q = t.queryTransform;
      tr.queryTransform = {
        removeParams:
          q.removeParams === undefined ? undefined : strings(q.removeParams, "removeParams"),
        addOrReplaceParams: Array.isArray(q.addOrReplaceParams)
          ? q.addOrReplaceParams.map((p) => {
              if (!isObj(p) || typeof p.key !== "string" || typeof p.value !== "string")
                throw new Error("addOrReplaceParams needs key and value");
              return { key: p.key, value: p.value, replaceOnly: p.replaceOnly === true };
            })
          : undefined,
      };
    }
    out.transform = tr;
  } else {
    throw new Error("action.redirect needs url, extensionPath, transform or regexSubstitution");
  }
  return out;
}

/** Checks a rule an extension gave and returns it cleaned up, or throws why it's invalid. */
export function parseRule(raw: unknown): Rule {
  if (!isObj(raw)) throw new Error("a rule must be an object");
  const { id, priority = 1, action, condition = {} } = raw;
  if (!isInt(id) || id < 1) throw new Error("rule.id must be a whole number of at least 1");
  if (!isInt(priority) || priority < 1) throw new Error(`rule ${id}: priority must be at least 1`);
  if (!isObj(action) || !(ACTION_TYPES as readonly string[]).includes(action.type as string))
    throw new Error(`rule ${id}: unknown action type`);
  if (!isObj(condition)) throw new Error(`rule ${id}: condition must be an object`);
  const type = action.type as ActionType;
  const rule: Rule = { id, priority, action: { type }, condition: {} };
  const c = rule.condition;
  try {
    if (condition.urlFilter !== undefined) {
      if (typeof condition.urlFilter !== "string" || !condition.urlFilter)
        throw new Error("urlFilter must be a non-empty string");
      if (!/^[\x20-\x7e]*$/.test(condition.urlFilter)) throw new Error("urlFilter must be ASCII");
      c.urlFilter = condition.urlFilter;
    }
    if (condition.regexFilter !== undefined) {
      if (c.urlFilter !== undefined) throw new Error("use urlFilter or regexFilter, not both");
      if (typeof condition.regexFilter !== "string" || !isRegexSupported(condition.regexFilter))
        throw new Error("regexFilter isn't a valid regular expression");
      c.regexFilter = condition.regexFilter;
    }
    if (condition.isUrlFilterCaseSensitive === true) c.isUrlFilterCaseSensitive = true;
    const domains = (key: string, alias?: string) => {
      const v = condition[key] ?? (alias ? condition[alias] : undefined);
      return v === undefined ? undefined : strings(v, key, true);
    };
    c.initiatorDomains = domains("initiatorDomains", "domains");
    c.excludedInitiatorDomains = domains("excludedInitiatorDomains", "excludedDomains");
    c.requestDomains = domains("requestDomains");
    c.excludedRequestDomains = domains("excludedRequestDomains");
    if (condition.resourceTypes !== undefined) {
      if (condition.excludedResourceTypes !== undefined)
        throw new Error("use resourceTypes or excludedResourceTypes, not both");
      c.resourceTypes = types(condition.resourceTypes, "resourceTypes");
      if (!c.resourceTypes.length) throw new Error("resourceTypes can't be empty");
    }
    if (condition.excludedResourceTypes !== undefined)
      c.excludedResourceTypes = types(condition.excludedResourceTypes, "excludedResourceTypes");
    if (condition.requestMethods !== undefined)
      c.requestMethods = strings(condition.requestMethods, "requestMethods", true);
    if (condition.excludedRequestMethods !== undefined)
      c.excludedRequestMethods = strings(
        condition.excludedRequestMethods,
        "excludedRequestMethods",
        true,
      );
    for (const m of [...(c.requestMethods ?? []), ...(c.excludedRequestMethods ?? [])])
      if (!METHODS.includes(m)) throw new Error(`unknown request method "${m}"`);
    if (condition.domainType === "firstParty" || condition.domainType === "thirdParty")
      c.domainType = condition.domainType;
    else if (condition.domainType !== undefined) throw new Error("unknown domainType");
    for (const key of ["tabIds", "excludedTabIds"] as const) {
      const v = condition[key];
      if (v === undefined) continue;
      if (!Array.isArray(v) || !v.every(isInt)) throw new Error(`${key} must be a list of numbers`);
      c[key] = v;
    }

    if (type === "redirect") {
      rule.action.redirect = redirect(action.redirect);
      if (rule.action.redirect.regexSubstitution !== undefined && !c.regexFilter)
        throw new Error("regexSubstitution needs a regexFilter");
    }
    if (type === "modifyHeaders") {
      if (action.requestHeaders !== undefined)
        rule.action.requestHeaders = headers(action.requestHeaders, "requestHeaders", false);
      if (action.responseHeaders !== undefined)
        rule.action.responseHeaders = headers(action.responseHeaders, "responseHeaders", true);
      if (!rule.action.requestHeaders && !rule.action.responseHeaders)
        throw new Error("modifyHeaders needs requestHeaders or responseHeaders");
    }
    if (type === "allowAllRequests") {
      const t = c.resourceTypes ?? [];
      if (!t.length || t.some((x) => x !== "main_frame" && x !== "sub_frame"))
        throw new Error("allowAllRequests only works with main_frame and sub_frame");
    }
  } catch (err) {
    throw new Error(`rule ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Leave out what wasn't given, so the rule reads back as it was written.
  for (const key of Object.keys(c) as (keyof Rule["condition"])[])
    if (c[key] === undefined) delete c[key];
  return rule;
}

export function isRegexSupported(regex: string): boolean {
  try {
    new RegExp(regex);
    return regex.length <= 2048;
  } catch {
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * A urlFilter as a regular expression: `*` is anything, `^` a separator
 * (anything but a letter, digit or one of `_-.%`, or the end), `|` anchors
 * at the start or end, `||` at the start of the host or of one of its labels.
 */
export function urlFilterToRegExp(filter: string, caseSensitive = false): RegExp {
  let f = filter;
  let head = "";
  let tail = "";
  if (f.startsWith("||")) {
    head = "^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#@]*@)?(?:[^\\/?#]*\\.)?";
    f = f.slice(2);
  } else if (f.startsWith("|")) {
    head = "^";
    f = f.slice(1);
  }
  if (f.endsWith("|") && !f.endsWith("\\|")) {
    tail = "$";
    f = f.slice(0, -1);
  }
  const body = [...f]
    .map((ch) => (ch === "*" ? ".*" : ch === "^" ? "(?:[^\\w\\-.%]|$)" : escapeRegExp(ch)))
    .join("");
  return new RegExp(head + body + tail, caseSensitive ? "" : "i");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** `host` is `domain` or one of its subdomains. */
function inDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const inAny = (host: string, list: string[] | undefined) =>
  !!list && list.some((d) => inDomain(host, d));

/** A rule, ready to test requests against. */
export interface CompiledRule {
  rule: Rule;
  rulesetId: string;
  pattern: RegExp | null;
  /** A piece of text every matching URL contains (cheap first check). */
  token: string | null;
}

export function compileRule(rule: Rule, rulesetId: string): CompiledRule {
  const c = rule.condition;
  const caseSensitive = c.isUrlFilterCaseSensitive === true;
  let pattern: RegExp | null = null;
  let token: string | null = null;
  if (c.urlFilter) {
    pattern = urlFilterToRegExp(c.urlFilter, caseSensitive);
    const pieces = c.urlFilter.replace(/^\|\|?|\|$/g, "").split(/[*^]/);
    const longest = pieces.reduce((a, b) => (b.length > a.length ? b : a), "");
    if (longest.length >= 3) token = caseSensitive ? longest : longest.toLowerCase();
  } else if (c.regexFilter) {
    pattern = new RegExp(c.regexFilter, caseSensitive ? "" : "i");
  }
  return { rule, rulesetId, pattern, token };
}

export function matches(compiled: CompiledRule, req: DnrRequest, lowerUrl: string): boolean {
  const c = compiled.rule.condition;
  if (c.resourceTypes) {
    if (!c.resourceTypes.includes(req.type)) return false;
  } else if (c.excludedResourceTypes) {
    if (c.excludedResourceTypes.includes(req.type)) return false;
  } else if (req.type === "main_frame") {
    return false; // Not unless a rule names it.
  }
  const method = METHODS.includes(req.method.toLowerCase()) ? req.method.toLowerCase() : "other";
  if (c.requestMethods && !c.requestMethods.includes(method)) return false;
  if (c.excludedRequestMethods?.includes(method)) return false;
  if (c.tabIds && !c.tabIds.includes(req.tabId)) return false;
  if (c.excludedTabIds?.includes(req.tabId)) return false;
  if (c.domainType === "firstParty" && req.thirdParty) return false;
  if (c.domainType === "thirdParty" && !req.thirdParty) return false;
  if (c.requestDomains || c.excludedRequestDomains) {
    const host = hostOf(req.url);
    if (c.requestDomains && !inAny(host, c.requestDomains)) return false;
    if (inAny(host, c.excludedRequestDomains)) return false;
  }
  if (c.initiatorDomains || c.excludedInitiatorDomains) {
    const host = req.initiator ? hostOf(req.initiator) : "";
    if (c.initiatorDomains && (!host || !inAny(host, c.initiatorDomains))) return false;
    if (host && inAny(host, c.excludedInitiatorDomains)) return false;
  }
  if (compiled.token) {
    const haystack = c.isUrlFilterCaseSensitive ? req.url : lowerUrl;
    if (!haystack.includes(compiled.token)) return false;
  }
  return compiled.pattern ? compiled.pattern.test(req.url) : true;
}

/** Among rules with the same priority, which action wins. */
const ACTION_ORDER: Record<ActionType, number> = {
  allow: 0,
  allowAllRequests: 1,
  block: 2,
  upgradeScheme: 3,
  redirect: 4,
  modifyHeaders: 5,
};

export interface Outcome {
  /** The rule that decides what happens to the request (not a header rule). */
  action: CompiledRule | null;
  /** Header rules that apply, highest priority first. */
  headers: CompiledRule[];
}

/**
 * What one extension's rules do with a request: the matching rule with the
 * highest priority decides; an allow rule also keeps header rules of lower
 * priority from applying. `floor` is an allowAllRequests priority inherited
 * from the page the request comes from.
 */
export function evaluate(
  rules: readonly CompiledRule[],
  req: DnrRequest,
  floor: number | null = null,
): Outcome {
  const lowerUrl = req.url.toLowerCase();
  let action: CompiledRule | null = null;
  const headerRules: CompiledRule[] = [];
  for (const r of rules) {
    if (!matches(r, req, lowerUrl)) continue;
    if (r.rule.action.type === "modifyHeaders") {
      headerRules.push(r);
      continue;
    }
    if (
      !action ||
      r.rule.priority > action.rule.priority ||
      (r.rule.priority === action.rule.priority &&
        ACTION_ORDER[r.rule.action.type] < ACTION_ORDER[action.rule.action.type])
    )
      action = r;
  }
  let allowAt = floor ?? 0;
  if (action && floor !== null && action.rule.priority <= floor) action = null;
  const type = action?.rule.action.type;
  if (type === "allow" || type === "allowAllRequests")
    allowAt = Math.max(allowAt, action!.rule.priority);
  const headers = headerRules
    .filter((r) => r.rule.priority > allowAt)
    .sort((a, b) => b.rule.priority - a.rule.priority);
  return { action, headers };
}

/** Where a redirect or upgradeScheme rule sends a request, or null to leave it. */
export function redirectTarget(
  compiled: CompiledRule,
  url: string,
  extensionId: string,
): string | null {
  const { action } = compiled.rule;
  if (action.type === "upgradeScheme") {
    if (url.startsWith("http:")) return `https:${url.slice(5)}`;
    if (url.startsWith("ws:")) return `wss:${url.slice(3)}`;
    return null;
  }
  const r = action.redirect;
  if (action.type !== "redirect" || !r) return null;
  let target: string | null = null;
  if (r.url !== undefined) target = r.url;
  else if (r.extensionPath !== undefined)
    target = `chrome-extension://${extensionId}${r.extensionPath}`;
  else if (r.regexSubstitution !== undefined && compiled.pattern) {
    const m = compiled.pattern.exec(url);
    if (!m) return null;
    const replaced = r.regexSubstitution.replace(/\\(\d)|\\\\/g, (_whole, digit: string) =>
      digit === undefined ? "\\" : (m[Number(digit)] ?? ""),
    );
    target = url.slice(0, m.index) + replaced + url.slice(m.index + m[0].length);
  } else if (r.transform) {
    target = transformUrl(url, r.transform);
  }
  if (!target || target === url) return null;
  try {
    return new URL(target).href;
  } catch {
    return null;
  }
}

export function transformUrl(url: string, t: UrlTransform): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (t.scheme !== undefined) u.protocol = `${t.scheme}:`;
  if (t.host !== undefined) u.hostname = t.host;
  if (t.port !== undefined) u.port = t.port;
  if (t.path !== undefined) u.pathname = t.path;
  if (t.query !== undefined) u.search = t.query;
  else if (t.queryTransform) {
    const params = u.searchParams;
    for (const key of t.queryTransform.removeParams ?? []) params.delete(key);
    for (const p of t.queryTransform.addOrReplaceParams ?? []) {
      if (params.has(p.key)) params.set(p.key, p.value);
      else if (!p.replaceOnly) params.append(p.key, p.value);
    }
  }
  if (t.fragment !== undefined) u.hash = t.fragment;
  if (t.username !== undefined) u.username = t.username;
  if (t.password !== undefined) u.password = t.password;
  return u.href;
}

/**
 * Applies header operations to a header map (names in any case). The first
 * rule to set or remove a header wins; appends add to what is there.
 */
export function applyHeaders<T extends string | string[]>(
  headers: Record<string, T>,
  ops: readonly HeaderInfo[],
  asList: boolean,
  touched = new Set<string>(),
): boolean {
  let changed = false;
  for (const op of ops) {
    const lower = op.header.toLowerCase();
    if (op.operation !== "append" && touched.has(lower)) continue;
    const existing = Object.keys(headers).find((k) => k.toLowerCase() === lower);
    if (op.operation === "remove") {
      if (existing) delete headers[existing];
    } else if (op.operation === "set") {
      if (existing) delete headers[existing];
      headers[op.header] = (asList ? [op.value ?? ""] : (op.value ?? "")) as T;
    } else {
      const key = existing ?? op.header;
      const prev = headers[key];
      if (asList) {
        headers[key] = [...((prev as string[] | undefined) ?? []), op.value ?? ""] as T;
      } else {
        const separator = lower === "cookie" ? "; " : ", ";
        headers[key] = (prev ? `${prev as string}${separator}${op.value}` : op.value) as T;
      }
    }
    touched.add(lower);
    changed = true;
  }
  return changed;
}

/** Electron's resource types in Chrome's words. */
export function resourceType(electronType: string): ResourceType {
  switch (electronType) {
    case "mainFrame":
      return "main_frame";
    case "subFrame":
      return "sub_frame";
    case "stylesheet":
      return "stylesheet";
    case "script":
      return "script";
    case "image":
      return "image";
    case "font":
      return "font";
    case "object":
      return "object";
    case "xhr":
      return "xmlhttprequest";
    case "ping":
      return "ping";
    case "cspReport":
      return "csp_report";
    case "media":
      return "media";
    case "webSocket":
      return "websocket";
    default:
      return "other";
  }
}
