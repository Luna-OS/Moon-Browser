import { useEffect, useState, type ReactNode } from "react";
import { formatNumber, timeAgo } from "@shared/format";
import { SLEEP_CHOICES } from "@shared/settings";
import type {
  AdblockStatus,
  ImportableProfile,
  ImportResult,
  PermissionKind,
  SearchEngineId,
  Settings,
} from "@shared/types";
import {
  BoltIcon,
  DownloadIcon,
  FolderIcon,
  GlobeIcon,
  InfoIcon,
  MoonIcon,
  SearchIcon,
  ShieldIcon,
  TabIcon,
  TrashIcon,
  UpdateIcon,
} from "@theme/icons";
import { api, useLive, type SettingsInfo } from "./api";
import { Card, Row, Segmented, Toggle } from "./ui";
import { UpdateRow } from "./UpdateRow";

const SECTIONS: { id: string; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <MoonIcon /> },
  { id: "search", label: "Search", icon: <SearchIcon size={16} /> },
  { id: "import", label: "Import", icon: <FolderIcon size={16} /> },
  { id: "privacy", label: "Privacy & Shield", icon: <ShieldIcon /> },
  { id: "permissions", label: "Site permissions", icon: <GlobeIcon /> },
  { id: "tabs", label: "Tabs & startup", icon: <TabIcon size={16} /> },
  { id: "downloads", label: "Downloads", icon: <DownloadIcon /> },
  { id: "system", label: "System", icon: <BoltIcon size={16} /> },
  { id: "updates", label: "Updates", icon: <UpdateIcon size={16} /> },
];

const PERMISSION_LABELS: Record<PermissionKind, string> = {
  camera: "Camera",
  microphone: "Microphone",
  "camera-microphone": "Camera and microphone",
  geolocation: "Location",
  notifications: "Notifications",
  "clipboard-read": "Clipboard",
  "open-external": "Open apps",
  popup: "Pop-ups",
};

const CLEAR_RANGES = [
  { value: 1, label: "Last hour" },
  { value: 24, label: "Last 24 hours" },
  { value: 24 * 7, label: "Last 7 days" },
  { value: 0, label: "All time" },
];

export function SettingsPage({ info }: { info: SettingsInfo }) {
  const s = info.settings;
  const set = (patch: Partial<Settings>) => void api.setSettings(patch);
  const [engines] = useLive(api.engines, []);
  const [adblock, refreshAdblock] = useLive(api.adblock, ["adblock", "settings"]);
  const [permissions, refreshPermissions] = useLive(api.permissions, ["settings"]);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [customUrl, setCustomUrl] = useState(s.customSearchUrl);
  const [homePage, setHomePage] = useState(s.homePage);
  const [showBangs, setShowBangs] = useState(false);
  const [active, setActive] = useState(() => window.location.hash.slice(1) || "appearance");

  useEffect(() => {
    void api.isDefaultBrowser().then(setIsDefault);
  }, []);

  // Jump to a section when opened as moon://settings/#privacy.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto flex max-w-5xl gap-8 px-6 pt-10 pb-20">
      <nav
        className="sticky top-10 flex h-fit w-52 shrink-0 flex-col gap-1 max-md:hidden"
        aria-label="Settings sections"
      >
        <div className="mb-4 flex items-center gap-3 px-2">
          <img src="/moon.svg" width={36} height={36} alt="" />
          <h1 className="mb-title m-0 text-2xl font-semibold">Settings</h1>
        </div>
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={active === section.id ? "true" : undefined}
            className={`flex items-center gap-2.5 rounded-[0.7rem] px-3 py-2 text-sm no-underline transition-colors ${
              active === section.id
                ? "bg-(--mb-selected) text-(--mb-accent)"
                : "text-(--mb-text-muted) hover:bg-(--mb-hover) hover:text-(--mb-text)"
            }`}
          >
            {section.icon}
            {section.label}
          </a>
        ))}
        <a
          href="moon://about/"
          className="mt-3 flex items-center gap-2.5 rounded-[0.7rem] px-3 py-2 text-sm text-(--mb-text-muted) no-underline hover:bg-(--mb-hover) hover:text-(--mb-text)"
        >
          <InfoIcon size={16} /> About Moon Browser
        </a>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card id="appearance" title="Appearance">
          <Row
            label="Theme"
            hint="Night is Moon Browser's home; websites follow it when they support dark mode."
          >
            <Segmented
              label="Theme"
              value={s.theme}
              onChange={(theme) => set({ theme })}
              options={[
                { value: "dark", label: "Night" },
                { value: "light", label: "Day" },
                { value: "system", label: "System" },
              ]}
            />
          </Row>
          <Toggle
            label="Show home button"
            checked={s.showHomeButton}
            onChange={(v) => set({ showHomeButton: v })}
          />
          <Toggle
            label="Show bookmarks bar"
            hint="Ctrl+Shift+B"
            checked={s.showBookmarksBar}
            onChange={(v) => set({ showBookmarksBar: v })}
          />
          <Toggle
            label="Shortcuts on the new tab page"
            hint="Your most visited sites, from your local history."
            checked={s.newTabShortcuts}
            onChange={(v) => set({ newTabShortcuts: v })}
          />
        </Card>

        <Card
          id="search"
          title="Search"
          description="Search suggestions never leave your computer: they come from your history and bookmarks only."
        >
          <Row label="Search engine">
            <select
              className="mb-input w-56"
              aria-label="Search engine"
              value={s.searchEngine}
              onChange={(e) => set({ searchEngine: e.target.value as SearchEngineId })}
            >
              {engines?.engines.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.name}
                </option>
              ))}
              <option value="custom" disabled={!s.customSearchUrl}>
                Custom…
              </option>
            </select>
          </Row>
          <Row
            label="Custom search engine"
            hint="Its search address with %s where the query goes, e.g. https://search.example/?q=%s"
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void api
                  .setSettings({ customSearchUrl: customUrl, searchEngine: "custom" })
                  .then((next) => {
                    setCustomUrl(next.customSearchUrl);
                  });
              }}
            >
              <input
                className="mb-input w-64"
                aria-label="Custom search URL"
                placeholder="https://…?q=%s"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
              <button
                type="submit"
                className="mb-btn mb-btn-ghost"
                disabled={!customUrl.includes("%s")}
              >
                Use
              </button>
            </form>
          </Row>
          <Toggle
            label="Bangs"
            hint={
              <>
                Type <code>!w moon</code> to search Wikipedia, <code>!yt</code> for YouTube,{" "}
                <code>!gh</code> for GitHub — straight from the address bar.{" "}
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-xs text-(--mb-accent) underline"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowBangs((v) => !v);
                  }}
                >
                  {showBangs ? "Hide all bangs" : "Show all bangs"}
                </button>
              </>
            }
            checked={s.bangs}
            onChange={(v) => set({ bangs: v })}
          />
          {showBangs && engines && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-5 py-3.5 text-xs md:grid-cols-3">
              {engines.bangs.map((b) => (
                <div key={b.trigger} className="flex gap-2">
                  <code className="w-16 shrink-0 text-(--mb-accent)">!{b.trigger}</code>
                  <span className="truncate text-(--mb-text-muted)">{b.name}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <ImportCard />

        <Card id="privacy" title="Privacy & Moon Shield">
          <Toggle
            label="Block ads and trackers"
            hint="Moon Shield uses uBlock Origin's filter lists, EasyList, EasyPrivacy and Peter Lowe's list — no paid exceptions for anyone."
            checked={s.adblock}
            onChange={(v) => set({ adblock: v })}
          />
          <Toggle
            label="Hide cookie banners and annoyances"
            hint="Adds the cookie-notice and annoyance lists."
            checked={s.adblockAnnoyances}
            onChange={(v) => set({ adblockAnnoyances: v })}
          />
          <AdblockRow
            status={adblock}
            onUpdate={() => void api.updateAdblock().then(refreshAdblock)}
          />
          <Toggle
            label="Block third-party cookies"
            hint="Other sites embedded in a page can't set or read cookies to follow you around."
            checked={s.blockThirdPartyCookies}
            onChange={(v) => set({ blockThirdPartyCookies: v })}
          />
          <Toggle
            label="Send Global Privacy Control"
            hint="Tells sites you don't want your data sold or shared. In some places, they have to listen."
            checked={s.globalPrivacyControl}
            onChange={(v) => set({ globalPrivacyControl: v })}
          />
          <Toggle
            label="HTTPS first"
            hint="Try every site over a secure connection first, and warn before falling back to plain HTTP."
            checked={s.httpsFirst}
            onChange={(v) => set({ httpsFirst: v })}
          />
          <Toggle
            label="Hide your local IP address from WebRTC"
            hint="Video calls keep working; only your address inside your network stays private."
            checked={s.webrtcProtection}
            onChange={(v) => set({ webrtcProtection: v })}
          />
          <Toggle
            label="Remove tracking parameters from links"
            hint="Strips click IDs and campaign tags like utm_source, fbclid and gclid before a page loads."
            checked={s.stripTrackingParams}
            onChange={(v) => set({ stripTrackingParams: v })}
          />
          <Row
            label="Secure DNS"
            hint={
              s.secureDns === "automatic"
                ? "Uses encrypted DNS whenever your network's DNS provider supports it."
                : s.secureDns === "off"
                  ? "Addresses are looked up unencrypted by your network."
                  : "Every address lookup is encrypted and goes to this provider only. Names that exist only in your local network may stop working."
            }
          >
            <select
              className="mb-input w-64"
              aria-label="Secure DNS"
              value={s.secureDns}
              onChange={(e) => set({ secureDns: e.target.value as Settings["secureDns"] })}
            >
              <option value="automatic">Automatic</option>
              <option value="quad9">Quad9 — blocks malware domains</option>
              <option value="mullvad">Mullvad</option>
              <option value="cloudflare">Cloudflare</option>
              <option value="off">Off</option>
            </select>
          </Row>
          <Toggle
            label="Delete cookies and site data when Moon Browser closes"
            hint="Every start is a fresh start: you'll be signed out of websites."
            checked={s.clearOnExit}
            onChange={(v) => set({ clearOnExit: v })}
          />
          <Row
            label="Always on"
            hint="Every page runs in Chromium's sandbox, dangerous and scam sites on the filter lists are stopped before they load, programs and scripts are only downloaded after you confirm, and Moon Browser keeps no passwords."
          />
          <Row
            label="Sites with Moon Shield off"
            hint={
              s.protectionAllowlist.length
                ? undefined
                : "None. Switch the shield off for a site from the shield button in the toolbar."
            }
          >
            {null}
          </Row>
          {s.protectionAllowlist.length > 0 && (
            <ul className="m-0 list-none border-b border-(--mb-border) px-5 pb-3">
              {s.protectionAllowlist.map((site) => (
                <li key={site} className="flex items-center gap-3 py-1 text-sm">
                  <span className="flex-1">{site}</span>
                  <button
                    type="button"
                    className="mb-btn mb-btn-ghost mb-btn-sm"
                    onClick={() => void api.removeProtectionException(site)}
                  >
                    Turn shield back on
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ClearData />
        </Card>

        <Card
          id="permissions"
          title="Site permissions"
          description="Moon Browser asks before a site may use your camera, microphone, location, notifications or clipboard."
        >
          {!permissions || permissions.length === 0 ? (
            <Row
              label="No decisions saved yet"
              hint="When you allow or block something and keep “Remember for this site” ticked, it shows up here."
            />
          ) : (
            permissions.map((p) => (
              <Row
                key={`${p.origin} ${p.kind}`}
                label={p.origin}
                hint={`${PERMISSION_LABELS[p.kind]}: ${p.decision === "allow" ? "allowed" : "blocked"}`}
              >
                <button
                  type="button"
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() =>
                    void api.resetPermission(p.origin, p.kind).then(refreshPermissions)
                  }
                >
                  Reset
                </button>
              </Row>
            ))
          )}
        </Card>

        <Card id="tabs" title="Tabs & startup">
          <Row label="On startup">
            <Segmented
              label="On startup"
              value={s.startup}
              onChange={(startup) => set({ startup })}
              options={[
                { value: "newtab", label: "New tab" },
                { value: "restore", label: "Continue where I left off" },
              ]}
            />
          </Row>
          <Row label="Home page" hint="Where the home button goes. Empty for the new tab page.">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void api
                  .setSettings({ homePage: homePage.trim() })
                  .then((next) => setHomePage(next.homePage));
              }}
            >
              <input
                className="mb-input w-64"
                aria-label="Home page"
                placeholder="https://…"
                value={homePage}
                onChange={(e) => setHomePage(e.target.value)}
              />
              <button type="submit" className="mb-btn mb-btn-ghost">
                Save
              </button>
            </form>
          </Row>
          <Toggle
            label="Put unused tabs to sleep"
            hint="Frees memory from tabs you haven't looked at for a while. They wake up when you switch to them."
            checked={s.sleepTabs}
            onChange={(v) => set({ sleepTabs: v })}
          />
          {s.sleepTabs && (
            <Row label="Sleep after">
              <select
                className="mb-input w-40"
                aria-label="Sleep after"
                value={s.sleepAfterMinutes}
                onChange={(e) => set({ sleepAfterMinutes: Number(e.target.value) })}
              >
                {SLEEP_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <Toggle
            label="Open new tabs next to the current one"
            checked={s.openTabsNextToActive}
            onChange={(v) => set({ openTabsNextToActive: v })}
          />
        </Card>

        <Card id="downloads" title="Downloads">
          <Row label="Save files to" hint={s.downloadDir || "Your Downloads folder"}>
            <button
              type="button"
              className="mb-btn mb-btn-ghost"
              onClick={() => void api.chooseDownloadFolder()}
            >
              Change…
            </button>
          </Row>
          <Toggle
            label="Ask where to save each file"
            checked={s.askDownloadLocation}
            onChange={(v) => set({ askDownloadLocation: v })}
          />
        </Card>

        <Card id="system" title="System">
          <Row
            label="Default browser"
            hint={
              isDefault
                ? "Moon Browser is your default browser."
                : info.platform === "win32"
                  ? "Windows lets you choose it in Settings → Apps → Default apps."
                  : "Open links from other apps in Moon Browser."
            }
          >
            {!isDefault && (
              <button
                type="button"
                className="mb-btn mb-btn-primary"
                onClick={() => void api.makeDefaultBrowser().then(setIsDefault)}
              >
                Make default
              </button>
            )}
          </Row>
          <Row
            label="Extensions"
            hint="Add-ons from the Chrome Web Store, such as your password manager."
          >
            <a href="moon://extensions/" className="mb-btn no-underline">
              Manage
            </a>
          </Row>
          <Toggle
            label="Spell check"
            hint={
              info.platform === "linux"
                ? "On Linux, the dictionaries are downloaded from Google's servers the first time."
                : "Uses your system's dictionaries."
            }
            checked={s.spellcheck}
            onChange={(v) => set({ spellcheck: v })}
          />
        </Card>

        <Card
          id="updates"
          title="Updates"
          description="New versions install over the old one — nothing to uninstall, and your profile stays as it is."
        >
          <UpdateRow autoCheck={s.autoUpdate} />
          <Toggle
            label="Look for updates automatically"
            hint="Every few hours, Moon Browser asks GitHub for a new release and downloads it in the background."
            checked={s.autoUpdate}
            onChange={(v) => set({ autoUpdate: v })}
          />
        </Card>
      </div>
    </div>
  );
}

function ImportCard() {
  const [profiles, setProfiles] = useState<ImportableProfile[] | null>(null);
  const [selected, setSelected] = useState("");
  const [what, setWhat] = useState({ bookmarks: true, history: true });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    void api.detectImports().then((list) => {
      setProfiles(list);
      if (list[0]) setSelected(list[0].path);
    });
  }, []);

  const choose = () =>
    void api.chooseImportFolder().then((p) => {
      if (!p) return;
      setProfiles((list) => [...(list ?? []).filter((x) => x.path !== p.path), p]);
      setSelected(p.path);
    });

  const run = () => {
    setBusy(true);
    setResult(null);
    void api
      .runImport(selected, what)
      .then(setResult, (err: unknown) =>
        setResult({ bookmarks: 0, history: 0, errors: [String(err)] }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card
      id="import"
      title="Import from another browser"
      description="Bookmarks and history from Comet, Chrome, Brave, Edge, Helium and other Chromium browsers — read directly from their profile folder, nothing goes online."
    >
      <Row
        label="Import from"
        hint={
          profiles && profiles.length === 0
            ? "No browser found automatically. Choose its profile folder instead."
            : undefined
        }
      >
        <div className="flex flex-wrap justify-end gap-2">
          {profiles && profiles.length > 0 && (
            <select
              className="mb-input w-64"
              aria-label="Browser profile"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="mb-btn mb-btn-ghost" onClick={choose}>
            Choose folder…
          </button>
        </div>
      </Row>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-(--mb-border) px-5 py-3.5 text-sm">
        {(
          [
            ["bookmarks", "Bookmarks"],
            ["history", "History"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={what[key]}
              onChange={() => setWhat((w) => ({ ...w, [key]: !w[key] }))}
            />
            {label}
          </label>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          className="mb-btn mb-btn-primary"
          disabled={!selected || busy || (!what.bookmarks && !what.history)}
          onClick={run}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {result && (
        <p
          className={`m-0 px-5 py-3 text-sm ${result.errors.length ? "text-(--mb-warning)" : "text-(--mb-success)"}`}
          role="status"
        >
          Imported {formatNumber(result.bookmarks)} bookmarks and {formatNumber(result.history)}{" "}
          history entries.
          {result.errors.map((e) => (
            <span key={e} className="block text-xs">
              {e}
            </span>
          ))}
        </p>
      )}
      <p className="m-0 px-5 py-3.5 text-xs leading-relaxed text-(--mb-text-muted)">
        Passwords, cookies and payment data are not imported: they are locked with the other
        browser's key, and Moon Browser keeps no password store on purpose. Export your passwords
        from Comet into a password manager such as Bitwarden or KeePassXC — that keeps them safe in
        every browser.
      </p>
    </Card>
  );
}

function AdblockRow({ status, onUpdate }: { status: AdblockStatus | null; onUpdate: () => void }) {
  if (!status) return <Row label="Filter lists" hint="Loading…" />;
  const hint = status.updating
    ? "Updating the filter lists…"
    : status.error && !status.ready
      ? `Couldn't download the filter lists yet (${status.error}). Moon Browser tries again in a while.`
      : status.updatedAt
        ? `${status.lists.length} lists, updated ${timeAgo(status.updatedAt)}. ${formatNumber(status.totalBlocked)} ads and trackers blocked so far.`
        : "The filter lists are downloaded on first start.";
  return (
    <Row label="Filter lists" hint={hint}>
      <button
        type="button"
        className="mb-btn mb-btn-ghost"
        disabled={status.updating}
        onClick={onUpdate}
      >
        {status.updating ? "Updating…" : "Update now"}
      </button>
    </Row>
  );
}

function ClearData() {
  const [hours, setHours] = useState(1);
  const [what, setWhat] = useState({
    history: true,
    cookies: false,
    cache: true,
    downloads: false,
  });
  const [done, setDone] = useState(false);
  const toggle = (key: keyof typeof what) => setWhat((w) => ({ ...w, [key]: !w[key] }));
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div>
        <div className="text-sm">Clear browsing data</div>
        <div className="mt-0.5 text-xs text-(--mb-text-muted)">
          The time range applies to history. Cookies, site data and the cache are always cleared
          completely.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <select
          className="mb-input"
          aria-label="Time range"
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {CLEAR_RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {(
          [
            ["history", "History"],
            ["cookies", "Cookies and site data"],
            ["cache", "Cached files"],
            ["downloads", "Download list"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={what[key]} onChange={() => toggle(key)} />
            {label}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="mb-btn mb-btn-danger"
          disabled={!Object.values(what).some(Boolean)}
          onClick={() => {
            setDone(false);
            void api.clearData({ hours, ...what }).then(() => setDone(true));
          }}
        >
          <TrashIcon /> Clear data
        </button>
        {done && <span className="text-xs text-(--mb-success)">Cleared.</span>}
      </div>
    </div>
  );
}
