import { useState } from "react";
import { WEB_STORE_URL, webStoreDetailUrl } from "@shared/extensions";
import type { ExtensionInfo } from "@shared/types";
import {
  ExternalIcon,
  FolderIcon,
  PuzzleIcon,
  ReloadIcon,
  SettingsIcon,
  TrashIcon,
  UpdateIcon,
  WarningIcon,
} from "@theme/icons";
import { api, useLive } from "./api";
import { Card, EmptyState, PageShell } from "./ui";

/** Password managers people usually look for first. */
const SUGGESTIONS = [
  { name: "NordPass", id: "eiaeiblijfjekdanodkjadfinkhbfgcd" },
  { name: "Bitwarden", id: "nngceckbapebfimnlniiiahkandclblb" },
  { name: "1Password", id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa" },
];

export function ExtensionsPage() {
  const [list] = useLive(api.extensions, ["extensions"]);
  const [developer] = useLive(api.developerMode, ["extensions"]);
  const [loadError, setLoadError] = useState<string | null>(null);
  return (
    <PageShell
      title="Extensions"
      subtitle="From the Chrome Web Store — in normal windows, never in private ones."
      actions={
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-(--mb-text-muted)">
            Developer mode
            <input
              type="checkbox"
              className="mb-switch"
              checked={developer === true}
              onChange={(e) => {
                setLoadError(null);
                void api.setDeveloperMode(e.target.checked);
              }}
            />
          </label>
          <a
            className="mb-btn mb-btn-primary no-underline"
            href={WEB_STORE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalIcon /> Chrome Web Store
          </a>
        </>
      }
    >
      {developer && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Your own extensions</div>
              <p className="m-0 mt-0.5 text-xs leading-relaxed text-(--mb-text-muted)">
                Load an extension from a folder with a manifest.json. It runs only while developer
                mode is on, and “Reload” picks up your changes.
              </p>
              {loadError && (
                <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-(--mb-danger)">
                  <WarningIcon size={12} /> {loadError}
                </p>
              )}
            </div>
            <button
              type="button"
              className="mb-btn"
              onClick={() => {
                setLoadError(null);
                void api.loadUnpacked().then(setLoadError);
              }}
            >
              <FolderIcon /> Load unpacked
            </button>
          </div>
        </Card>
      )}
      {list && list.length === 0 && (
        <Card>
          <EmptyState title="No extensions yet">
            Open an extension in the Chrome Web Store and choose “Add to Moon Browser”. Before
            anything is added, Moon Browser shows what the extension will be able to do.
          </EmptyState>
          <div className="flex flex-wrap items-center justify-center gap-2 px-5 pb-7">
            <span className="text-xs text-(--mb-text-muted)">Password managers:</span>
            {SUGGESTIONS.map((s) => (
              <a
                key={s.id}
                className="mb-chip no-underline hover:border-(--mb-accent)"
                href={webStoreDetailUrl(s.id)}
                target="_blank"
                rel="noreferrer"
              >
                {s.name}
              </a>
            ))}
          </div>
        </Card>
      )}
      {list && list.length > 0 && (
        <Card>
          <ul className="m-0 list-none p-1.5">
            {list.map((ext) => (
              <ExtensionRow key={ext.id} ext={ext} developer={developer === true} />
            ))}
          </ul>
        </Card>
      )}
      <p className="m-0 text-center text-xs leading-relaxed text-(--mb-text-faint)">
        Extensions are updated from the Chrome Web Store automatically. Moon Shield keeps blocking
        ads and trackers on its own — no ad-blocking extension needed.
      </p>
    </PageShell>
  );
}

function ExtensionRow({ ext, developer }: { ext: ExtensionInfo; developer: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [repairing, setRepairing] = useState(false);
  return (
    <li className="flex items-start gap-3.5 rounded-[0.7rem] px-3 py-3 hover:bg-(--mb-hover)">
      <span
        className="mb-glass flex h-11 w-11 shrink-0 items-center justify-center"
        style={{ borderRadius: "0.8rem", opacity: ext.enabled ? 1 : 0.5 }}
      >
        {ext.icon ? <img src={ext.icon} width={28} height={28} alt="" /> : <PuzzleIcon size={20} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{ext.name}</span>
          <span className="text-xs text-(--mb-text-faint)">{ext.version}</span>
          {!ext.enabled && <span className="mb-chip h-5! text-[0.65rem]!">Off</span>}
          {ext.unpacked && <span className="mb-chip h-5! text-[0.65rem]!">Unpacked</span>}
        </div>
        {developer && (
          <p className="m-0 mt-0.5 font-mono text-[0.7rem] break-all text-(--mb-text-faint)">
            ID {ext.id}
            {ext.path && <> · {ext.path}</>}
          </p>
        )}
        {ext.description && (
          <p className="m-0 mt-0.5 line-clamp-2 text-xs leading-relaxed text-(--mb-text-muted)">
            {ext.description}
          </p>
        )}
        {ext.permissions.length > 0 && (
          <p className="m-0 mt-1.5 text-xs leading-relaxed text-(--mb-text-faint)">
            Can: {ext.permissions.join(" · ")}
          </p>
        )}
        {ext.unsupported.map((text) => (
          <p
            key={text}
            className="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-(--mb-warning)"
          >
            <WarningIcon size={12} /> {text}
          </p>
        ))}
        {ext.damaged && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[0.6rem] border border-(--mb-border) bg-(--mb-inset) px-2.5 py-2 text-xs">
            <WarningIcon size={13} />
            <span className="min-w-0 flex-1 text-(--mb-text-muted)">
              Its files are damaged, so it can't work. Repairing installs it again from the Chrome
              Web Store; your settings and logins in it stay.
            </span>
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-primary"
              disabled={repairing}
              onClick={() => {
                setRepairing(true);
                void api.repairExtension(ext.id).finally(() => setRepairing(false));
              }}
            >
              <UpdateIcon size={13} /> {repairing ? "Repairing…" : "Repair"}
            </button>
          </div>
        )}
        {ext.errors.length > 0 && (
          <details className="mt-2 rounded-[0.6rem] border border-(--mb-border) bg-(--mb-inset) px-2.5 py-1.5 text-xs">
            <summary className="cursor-pointer text-(--mb-danger)">
              Errors ({ext.errors.length})
            </summary>
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
              {ext.errors.map((error, i) => (
                <li key={i} className="font-mono break-words text-(--mb-text-muted)">
                  {error}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-ghost mt-1.5"
              onClick={() => void api.clearExtensionErrors(ext.id)}
            >
              Clear
            </button>
          </details>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {ext.hasOptions && ext.enabled && (
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-ghost"
              onClick={() => void api.extensionOptions(ext.id)}
            >
              <SettingsIcon size={13} /> Options
            </button>
          )}
          {ext.unpacked ? (
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-ghost"
              onClick={() => void api.reloadExtension(ext.id)}
            >
              <ReloadIcon size={13} /> Reload
            </button>
          ) : (
            <a
              className="mb-btn mb-btn-sm mb-btn-ghost no-underline"
              href={webStoreDetailUrl(ext.id)}
              target="_blank"
              rel="noreferrer"
            >
              Web Store
            </a>
          )}
          {confirming ? (
            <>
              <span className="ml-1 text-xs text-(--mb-text-muted)">
                Remove {ext.name}?{ext.unpacked && " Its folder stays."}
              </span>
              <button
                type="button"
                className="mb-btn mb-btn-sm mb-btn-danger"
                onClick={() => void api.removeExtension(ext.id)}
              >
                Remove
              </button>
              <button
                type="button"
                className="mb-btn mb-btn-sm"
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="mb-btn mb-btn-sm mb-btn-ghost"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon size={13} /> Remove
            </button>
          )}
        </div>
      </div>
      <input
        type="checkbox"
        className="mb-switch mt-1"
        aria-label={`${ext.name} on or off`}
        checked={ext.enabled}
        onChange={(e) => void api.setExtensionEnabled(ext.id, e.target.checked)}
      />
    </li>
  );
}
