/**
 * Typed access to the internal page API (window.moon). The main process
 * decides per page which of these calls are allowed.
 */
import { useEffect, useState } from "react";
import type { Bang } from "@shared/bangs";
import type { SearchEngine } from "@shared/engines";
import type { Disposition, InternalEvent } from "@shared/ipc";
import type {
  AboutInfo,
  AdblockStatus,
  Bookmark,
  ClearDataOptions,
  DownloadInfo,
  HistoryEntry,
  ImportableProfile,
  ImportResult,
  ResolvedTheme,
  Settings,
  SiteSettingsEntry,
} from "@shared/types";
import type { DownloadAction } from "@shared/ipc";

const m = () => window.moon;

export interface SettingsInfo {
  settings: Settings;
  theme: ResolvedTheme;
  platform: string;
}

export interface NewTabInfo {
  topSites: { url: string; title: string; favicon: string | null }[];
  totalBlocked: number;
  engine: string;
  private: boolean;
  /** A browser to offer importing from on a fresh profile. */
  importFrom: string | null;
}

export const api = {
  settings: () => m().invoke("settings.get") as Promise<SettingsInfo>,
  setSettings: (patch: Partial<Settings>) => m().invoke("settings.set", patch) as Promise<Settings>,
  engines: () => m().invoke("engines.list") as Promise<{ engines: SearchEngine[]; bangs: Bang[] }>,
  newTab: () => m().invoke("newtab.info") as Promise<NewTabInfo>,
  hideTopSite: (url: string) => m().invoke("topSites.hide", url) as Promise<void>,
  navigate: (input: string) => m().invoke("navigate", input) as Promise<void>,
  openUrl: (url: string, disposition: Disposition = "current") =>
    m().invoke("openUrl", url, disposition) as Promise<void>,
  history: (q: { text: string; limit?: number; before?: number }) =>
    m().invoke("history.query", q) as Promise<HistoryEntry[]>,
  removeHistory: (urls: string[]) => m().invoke("history.remove", urls) as Promise<void>,
  bookmarks: () => m().invoke("bookmarks.list") as Promise<Bookmark[]>,
  updateBookmark: (id: string, patch: { title?: string; url?: string; index?: number }) =>
    m().invoke("bookmarks.update", id, patch) as Promise<void>,
  removeBookmark: (id: string) => m().invoke("bookmarks.remove", id) as Promise<void>,
  downloads: () => m().invoke("downloads.list") as Promise<DownloadInfo[]>,
  downloadAction: (id: string, action: DownloadAction) =>
    m().invoke("downloads.action", id, action) as Promise<void>,
  clearDownloads: () => m().invoke("downloads.clear") as Promise<void>,
  chooseDownloadFolder: () => m().invoke("downloads.chooseFolder") as Promise<string>,
  clearData: (options: ClearDataOptions) => m().invoke("data.clear", options) as Promise<void>,
  adblock: () => m().invoke("adblock.status") as Promise<AdblockStatus>,
  updateAdblock: () => m().invoke("adblock.update") as Promise<AdblockStatus>,
  permissions: () => m().invoke("permissions.list") as Promise<SiteSettingsEntry[]>,
  resetPermission: (origin: string, kind?: string) =>
    m().invoke("permissions.reset", origin, kind) as Promise<void>,
  removeProtectionException: (site: string) =>
    m().invoke("protection.remove", site) as Promise<void>,
  isDefaultBrowser: () => m().invoke("defaultBrowser.get") as Promise<boolean>,
  makeDefaultBrowser: () => m().invoke("defaultBrowser.set") as Promise<boolean>,
  about: () => m().invoke("about.info") as Promise<AboutInfo>,
  detectImports: () => m().invoke("import.detect") as Promise<ImportableProfile[]>,
  chooseImportFolder: () => m().invoke("import.choose") as Promise<ImportableProfile | null>,
  runImport: (path: string, what: { bookmarks: boolean; history: boolean }) =>
    m().invoke("import.run", path, what) as Promise<ImportResult>,
  dismissImportHint: () => m().invoke("import.dismissHint") as Promise<void>,
};

/** Re-runs `load` whenever the main process reports a change of `kind`. */
export function useLive<T>(load: () => Promise<T>, kinds: InternalEvent[]): [T | null, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void load().then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  useEffect(
    () =>
      m().on((event) => {
        if (kinds.includes(event)) setTick((t) => t + 1);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [value, () => setTick((t) => t + 1)];
}
