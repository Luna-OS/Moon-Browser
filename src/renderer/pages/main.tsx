import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@theme/tokens.css";
import { internalPageOf, type InternalPage } from "@shared/internal";
import { Sky } from "@theme/Sky";
import { useDocumentTheme } from "@theme/useTheme";
import { api, useLive } from "./api";
import { AboutPage } from "./AboutPage";
import { BookmarksPage } from "./BookmarksPage";
import { DownloadsPage } from "./DownloadsPage";
import { ExtensionsPage } from "./ExtensionsPage";
import { HistoryPage } from "./HistoryPage";
import { NewTabPage } from "./NewTabPage";
import { SettingsPage } from "./SettingsPage";

const TITLES: Record<InternalPage, string> = {
  newtab: "New tab",
  settings: "Settings",
  history: "History",
  bookmarks: "Bookmarks",
  downloads: "Downloads",
  extensions: "Extensions",
  about: "About Moon Browser",
};

function Root({ page }: { page: InternalPage }) {
  const [info] = useLive(api.settings, ["settings"]);
  useDocumentTheme(info?.theme);
  useEffect(() => {
    document.title = TITLES[page];
  }, [page]);

  let body: ReactNode;
  switch (page) {
    case "newtab":
      body = <NewTabPage settings={info?.settings ?? null} />;
      break;
    case "settings":
      body = info ? <SettingsPage info={info} /> : null;
      break;
    case "history":
      body = <HistoryPage />;
      break;
    case "bookmarks":
      body = <BookmarksPage />;
      break;
    case "downloads":
      body = <DownloadsPage />;
      break;
    case "extensions":
      body = <ExtensionsPage />;
      break;
    case "about":
      body = <AboutPage />;
      break;
  }

  return (
    <div className="mb-night relative min-h-full">
      <Sky moon={page !== "newtab"} />
      <div className="relative z-10 min-h-full">{body}</div>
    </div>
  );
}

const page = internalPageOf(window.location.href) ?? "newtab";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root page={page} />
  </StrictMode>,
);
