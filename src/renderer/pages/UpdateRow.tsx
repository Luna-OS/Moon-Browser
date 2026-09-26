import { timeAgo } from "@shared/format";
import type { UpdateStatus } from "@shared/types";
import { api, useLive } from "./api";
import { Row } from "./ui";

function describe(s: UpdateStatus, autoCheck: boolean): string {
  switch (s.state) {
    case "unsupported":
      return "This copy can't update itself: it is a development build or an unpacked folder.";
    case "checking":
      return "Looking for a new version…";
    case "downloading":
      return `Downloading version ${s.version ?? ""}… ${s.percent}%`;
    case "ready":
      return `Version ${s.version ?? ""} is ready. Restart Moon Browser to install it — your tabs come back.${s.needsAdmin ? " Installing asks for your password." : ""}`;
    case "error":
      return `Couldn't look for updates: ${s.error ?? "unknown error"}`;
    default:
      return s.checkedAt
        ? `Up to date · checked ${timeAgo(s.checkedAt)}`
        : autoCheck
          ? "Moon Browser looks for updates every few hours."
          : "Not checked yet.";
  }
}

/** The installed version, what the updater is doing, and the button for it. */
export function UpdateRow({ autoCheck = true }: { autoCheck?: boolean }) {
  const [status, reload] = useLive(api.updateStatus, ["update"]);
  if (!status) return <Row label="Moon Browser" hint="…" />;
  const busy = status.state === "checking" || status.state === "downloading";
  return (
    <Row label={`Moon Browser ${status.current}`} hint={describe(status, autoCheck)}>
      {status.state === "ready" ? (
        <button
          type="button"
          className="mb-btn mb-btn-primary"
          onClick={() => void api.installUpdate()}
        >
          Restart to update
        </button>
      ) : (
        status.state !== "unsupported" && (
          <button
            type="button"
            className="mb-btn mb-btn-ghost"
            disabled={busy}
            onClick={() => void api.checkForUpdate().then(reload)}
          >
            {status.state === "downloading"
              ? "Downloading…"
              : status.state === "checking"
                ? "Checking…"
                : "Check now"}
          </button>
        )
      )}
    </Row>
  );
}
