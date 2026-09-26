import { useEffect, useState } from "react";
import type { AboutInfo } from "@shared/types";
import { api } from "./api";
import { Card, Row } from "./ui";

const CREDITS: { name: string; url: string; what: string; license: string }[] = [
  {
    name: "Chromium",
    url: "https://www.chromium.org/",
    what: "the engine that renders every page",
    license: "BSD-3-Clause",
  },
  {
    name: "Electron",
    url: "https://www.electronjs.org/",
    what: "Chromium as a building block",
    license: "MIT",
  },
  {
    name: "Helium",
    url: "https://github.com/imputnet/helium",
    what: "the inspiration: a private, quiet Chromium browser",
    license: "GPL-3.0",
  },
  {
    name: "Ghostery adblocker",
    url: "https://github.com/ghostery/adblocker",
    what: "the blocking engine behind Moon Shield",
    license: "MPL-2.0",
  },
  {
    name: "uBlock Origin filter lists",
    url: "https://github.com/uBlockOrigin/uAssets",
    what: "filters, scriptlets and redirect resources",
    license: "GPL-3.0",
  },
  {
    name: "EasyList & EasyPrivacy",
    url: "https://easylist.to/",
    what: "ad and tracker filters",
    license: "GPL-3.0 / CC BY-SA 3.0",
  },
  {
    name: "Peter Lowe's list",
    url: "https://pgl.yoyo.org/adservers/",
    what: "ad and tracking server list",
    license: "McRae GPL",
  },
  {
    name: "tldts",
    url: "https://github.com/remusao/tldts",
    what: "the Public Suffix List for telling sites apart",
    license: "MIT",
  },
  {
    name: "React & Tailwind CSS",
    url: "https://react.dev/",
    what: "the interface",
    license: "MIT",
  },
];

export function AboutPage() {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  useEffect(() => {
    void api.about().then(setInfo);
  }, []);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 pt-14 pb-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src="/moon.svg" width={112} height={112} alt="Moon Browser" />
        <h1 className="mb-title m-0 text-4xl font-semibold">Moon Browser</h1>
        <p className="m-0 text-(--mb-text-muted)">The web, calmly under the moon.</p>
        {info && <span className="mb-chip">Version {info.version}</span>}
      </div>

      <Card title="This build">
        {info ? (
          <>
            <Row
              label="Engine"
              hint={`Chromium ${info.chromium} · Electron ${info.electron} · V8 ${info.v8}`}
            />
            <Row label="System" hint={`${info.platform} (${info.arch})`} />
            <Row label="Profile" hint={info.userData} />
          </>
        ) : (
          <Row label="…" />
        )}
      </Card>

      <Card
        title="Open source"
        description="Moon Browser is free software under the MIT license — made by Luna, standing on the shoulders of:"
      >
        <ul className="m-0 list-none p-1.5">
          {CREDITS.map((c) => (
            <li
              key={c.name}
              className="flex items-baseline gap-3 rounded-[0.7rem] px-3.5 py-2 hover:bg-(--mb-hover)"
            >
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sm text-(--mb-accent) no-underline hover:underline"
              >
                {c.name}
              </a>
              <span className="min-w-0 flex-1 truncate text-xs text-(--mb-text-muted)">
                {c.what}
              </span>
              <span className="shrink-0 text-xs text-(--mb-text-faint)">{c.license}</span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="m-0 text-center text-xs text-(--mb-text-faint)">
        <a
          href="https://github.com/Luna-OS/Moon-Browser"
          target="_blank"
          rel="noreferrer"
          className="text-(--mb-accent)"
        >
          github.com/Luna-OS/Moon-Browser
        </a>{" "}
        · No telemetry. No accounts. Your data stays on your computer.
      </p>
    </main>
  );
}
