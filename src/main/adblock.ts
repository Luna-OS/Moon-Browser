/**
 * Moon Browser's built-in ad and tracker blocker: the Ghostery adblocker
 * engine (uBlock Origin–compatible filter syntax, including cosmetic
 * filters and scriptlets) wired into Electron's request pipeline.
 *
 * The engine lives in the main process. Filter lists are downloaded in the
 * background, parsed in a utility process and cached in the profile, so
 * later starts load the ready engine from disk in a few milliseconds.
 */
import { ipcMain, session, utilityProcess, type IpcMainInvokeEvent } from "electron";
import { FiltersEngine, Request } from "@ghostery/adblocker";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse } from "tldts";
import { blocksWholePage } from "@shared/security";
import type { AdblockStatus } from "@shared/types";
import { listsFor, RESOURCES_URL } from "./adblock-config";
import { adblockWorker, profilePath } from "./paths";

const UPDATE_EVERY = 3 * 24 * 60 * 60 * 1000;
const RETRY_AFTER = 30 * 60 * 1000;

interface CacheMeta {
  updatedAt: number;
  lists: string[];
}

export type BlockDecision = { cancel: true } | { redirectURL: string } | null;

export class Adblocker {
  private engine: FiltersEngine | null = null;
  private updating: Promise<void> | null = null;
  private updatedAt: number | null = null;
  private lists: string[] = [];
  private error: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      annoyances: () => boolean;
      totalBlocked: () => number;
      onChange: () => void;
    },
  ) {}

  get ready(): boolean {
    return this.engine !== null;
  }

  async start(): Promise<void> {
    await this.loadCache();
    this.scheduleUpdate(this.isStale() ? 5_000 : this.nextUpdateIn());
  }

  status(enabled: boolean): AdblockStatus {
    return {
      enabled,
      ready: this.ready,
      updating: this.updating !== null,
      updatedAt: this.updatedAt,
      error: this.error,
      lists: listsFor(this.options.annoyances()).map((l) => l.name),
      totalBlocked: this.options.totalBlocked(),
    };
  }

  /** Called when the list selection changed (annoyances on/off). */
  listsChanged(): void {
    if (this.isStale()) void this.update();
  }

  /** Blocking decision for one sub-resource request of a page. */
  match(url: string, type: string, contextUrl: string): BlockDecision {
    if (!this.engine) return null;
    const request = Request.fromRawDetails({ url, sourceUrl: contextUrl, type: type as never });
    const { match, redirect } = this.engine.match(request);
    if (redirect) return { redirectURL: redirect.dataUrl };
    if (match) return { cancel: true };
    return null;
  }

  /**
   * The rule that marks a page itself as dangerous (malware, scams, pure
   * tracking hosts), or null. Only whole-host and $document rules count.
   */
  pageBlockRule(url: string): string | null {
    if (!this.engine) return null;
    const { match, filter } = this.engine.match(
      Request.fromRawDetails({ url, sourceUrl: url, type: "mainFrame" }),
    );
    if (!match || !filter) return null;
    const text = filter.toString();
    return blocksWholePage({
      hostnameAnchored: filter.isHostnameAnchor(),
      pattern: filter.getFilter(),
      text,
    })
      ? text
      : null;
  }

  /** Extra Content-Security-Policy directives some filters add to a document. */
  cspFor(url: string, type: string, contextUrl: string): string | undefined {
    if (!this.engine) return undefined;
    return this.engine.getCSPDirectives(
      Request.fromRawDetails({ url, sourceUrl: contextUrl, type: type as never }),
    );
  }

  update(): Promise<void> {
    if (this.updating) return this.updating;
    this.updating = this.runUpdate().finally(() => {
      this.updating = null;
      this.options.onChange();
    });
    this.options.onChange();
    return this.updating;
  }

  /**
   * Cosmetic filtering: the adblock preload in each page asks for element
   * hiding rules and scriptlets for its URL. `allowed(sender)` decides
   * whether blocking is active for that page at all.
   */
  registerCosmeticHandlers(allowed: (event: IpcMainInvokeEvent, url: string) => boolean): void {
    ipcMain.handle(
      "@ghostery/adblocker/inject-cosmetic-filters",
      (
        event,
        url: unknown,
        msg?: { classes?: string[]; hrefs?: string[]; ids?: string[]; lifecycle?: string },
      ) => {
        if (!this.engine || typeof url !== "string" || !/^https?:/.test(url)) return;
        if (!allowed(event, url)) return;
        const parsed = parse(url);
        const first = msg === undefined;
        const { active, styles, scripts } = this.engine.getCosmeticsFilters({
          url,
          hostname: parsed.hostname ?? "",
          domain: parsed.domain ?? "",
          classes: Array.isArray(msg?.classes) ? msg.classes : undefined,
          hrefs: Array.isArray(msg?.hrefs) ? msg.hrefs : undefined,
          ids: Array.isArray(msg?.ids) ? msg.ids : undefined,
          getBaseRules: first,
          getInjectionRules: first,
          getExtendedRules: false,
          getRulesFromHostname: first,
          getRulesFromDOM: !first,
          callerContext: {
            frameId: event.frameId,
            processId: event.processId,
            lifecycle: msg?.lifecycle,
          },
        });
        if (!active) return;
        if (styles.length > 0) void event.sender.insertCSS(styles, { cssOrigin: "user" });
        for (const script of scripts) {
          event.sender.executeJavaScript(script, true).catch(() => {
            // A scriptlet failing on one page must not affect anything else.
          });
        }
      },
    );
    ipcMain.handle("@ghostery/adblocker/is-mutation-observer-enabled", () => true);
  }

  private isStale(): boolean {
    const wanted = listsFor(this.options.annoyances()).map((l) => l.url);
    const sameLists =
      wanted.length === this.lists.length && wanted.every((u) => this.lists.includes(u));
    return !this.engine || !sameLists || this.nextUpdateIn() <= 0;
  }

  private nextUpdateIn(): number {
    return this.updatedAt ? this.updatedAt + UPDATE_EVERY - Date.now() : 0;
  }

  private scheduleUpdate(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.update();
      },
      Math.max(1_000, Math.min(delay, 2 ** 31 - 1)),
    );
  }

  private async loadCache(): Promise<void> {
    try {
      const meta = JSON.parse(
        await readFile(profilePath("adblock", "meta.json"), "utf8"),
      ) as CacheMeta;
      const data = await readFile(profilePath("adblock", "engine.bin"));
      this.engine = FiltersEngine.deserialize(new Uint8Array(data));
      this.updatedAt = typeof meta.updatedAt === "number" ? meta.updatedAt : 0;
      this.lists = Array.isArray(meta.lists) ? meta.lists : [];
    } catch {
      // No cache yet, or one from an older engine version: fetch fresh lists.
      this.engine = null;
    }
    this.options.onChange();
  }

  private async runUpdate(): Promise<void> {
    const lists = listsFor(this.options.annoyances());
    try {
      // A separate in-memory session: list downloads carry no cookies and
      // don't pass through the browsing sessions' request filters.
      const ses = session.fromPartition("moon-updates");
      ses.setSpellCheckerEnabled(false);
      const fetchText = async (url: string) => {
        const res = await ses.fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.text();
      };
      const [texts, resources] = await Promise.all([
        Promise.all(lists.map((l) => fetchText(l.url))),
        fetchText(RESOURCES_URL).catch(() => null),
      ]);
      const data = await parseInWorker(texts, resources);
      const engine = FiltersEngine.deserialize(data);
      await mkdir(profilePath("adblock"), { recursive: true });
      await writeFile(profilePath("adblock", "engine.bin.tmp"), data);
      await rename(profilePath("adblock", "engine.bin.tmp"), profilePath("adblock", "engine.bin"));
      const meta: CacheMeta = { updatedAt: Date.now(), lists: lists.map((l) => l.url) };
      await writeFile(profilePath("adblock", "meta.json"), JSON.stringify(meta));
      this.engine = engine;
      this.updatedAt = meta.updatedAt;
      this.lists = meta.lists;
      this.error = null;
      this.scheduleUpdate(UPDATE_EVERY);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      console.warn("[adblock] update failed:", this.error);
      this.scheduleUpdate(RETRY_AFTER);
    }
  }
}

function parseInWorker(lists: string[], resources: string | null): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(adblockWorker, [], {
      serviceName: "Moon Browser filter lists",
      stdio: "inherit",
    });
    let settled = false;
    child.once("message", (msg: { ok: boolean; data?: Uint8Array; error?: string }) => {
      settled = true;
      child.kill();
      if (msg.ok && msg.data) resolve(new Uint8Array(msg.data));
      else reject(new Error(msg.error ?? "filter lists could not be parsed"));
    });
    child.once("exit", (code) => {
      if (!settled) reject(new Error(`filter list worker exited with code ${code}`));
    });
    child.postMessage({ lists, resources });
  });
}
