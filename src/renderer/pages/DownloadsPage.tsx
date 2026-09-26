import { useState } from "react";
import { formatBytes, groupByDay } from "@shared/format";
import type { DownloadInfo } from "@shared/types";
import { CloseIcon, FileIcon, FolderIcon, PauseIcon, PlayIcon, TrashIcon } from "@theme/icons";
import { shortHost } from "@shared/display";
import { api, useLive } from "./api";
import { Card, EmptyState, PageShell } from "./ui";

function status(d: DownloadInfo): string {
  switch (d.state) {
    case "completed":
      return `${formatBytes(d.total || d.received)} · ${shortHost(d.url)}`;
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Failed";
    default:
      return `${d.paused ? "Paused — " : ""}${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ""}`;
  }
}

export function DownloadsPage() {
  const [downloads] = useLive(api.downloads, ["downloads"]);
  const [now] = useState(Date.now);
  const groups = downloads ? groupByDay(downloads, (d) => d.startTime, now) : [];
  return (
    <PageShell
      title="Downloads"
      actions={
        downloads?.some((d) => d.state !== "progressing") && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost"
            onClick={() => void api.clearDownloads()}
          >
            <TrashIcon /> Clear list
          </button>
        )
      }
    >
      {downloads && downloads.length === 0 && (
        <Card>
          <EmptyState title="No downloads yet">Files you download will be listed here.</EmptyState>
        </Card>
      )}
      {groups.map((group) => (
        <Card key={group.label} title={group.label}>
          <ul className="m-0 list-none p-1.5">
            {group.items.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-[0.7rem] px-3 py-2.5 hover:bg-(--mb-hover)"
              >
                <span className="text-(--mb-text-muted)">
                  <FileIcon size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  {d.state === "completed" ? (
                    <button
                      type="button"
                      className="max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm text-(--mb-text) hover:underline"
                      onClick={() => void api.downloadAction(d.id, "open")}
                    >
                      {d.filename}
                    </button>
                  ) : (
                    <div
                      className={`truncate text-sm ${d.state === "progressing" ? "" : "text-(--mb-text-muted) line-through"}`}
                    >
                      {d.filename}
                    </div>
                  )}
                  {d.state === "progressing" && d.total > 0 && (
                    <div className="mb-meter my-1.5 max-w-md">
                      <span style={{ width: `${Math.min(100, (d.received / d.total) * 100)}%` }} />
                    </div>
                  )}
                  <div className="truncate text-xs text-(--mb-text-muted)">{status(d)}</div>
                </div>
                {d.state === "progressing" ? (
                  <>
                    <button
                      type="button"
                      className="mb-icon-btn"
                      aria-label={d.paused ? "Resume" : "Pause"}
                      onClick={() => void api.downloadAction(d.id, d.paused ? "resume" : "pause")}
                    >
                      {d.paused ? <PlayIcon /> : <PauseIcon />}
                    </button>
                    <button
                      type="button"
                      className="mb-icon-btn"
                      aria-label="Cancel"
                      onClick={() => void api.downloadAction(d.id, "cancel")}
                    >
                      <CloseIcon />
                    </button>
                  </>
                ) : (
                  <>
                    {d.state === "completed" && (
                      <button
                        type="button"
                        className="mb-icon-btn"
                        aria-label="Show in folder"
                        title="Show in folder"
                        onClick={() => void api.downloadAction(d.id, "show")}
                      >
                        <FolderIcon />
                      </button>
                    )}
                    <button
                      type="button"
                      className="mb-icon-btn"
                      aria-label="Remove from list"
                      title="Remove from list"
                      onClick={() => void api.downloadAction(d.id, "remove")}
                    >
                      <CloseIcon />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </PageShell>
  );
}
