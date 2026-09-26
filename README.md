# Moon Browser

> The web, calmly under the moon.

Moon Browser is a private, open-source Chromium browser for Windows and Linux — in the spirit of
[Helium](https://github.com/imputnet/helium): no bloat, no noise, ad and tracker blocking built in,
and nothing phoning home. It wears the same night-sky design as
[MoonDisk](https://github.com/Luna-OS/MoonDisk) and [MoonTask](https://github.com/Luna-OS/Moon-Task).

![The new tab page: today's moon phase, the time and a search box](docs/screenshots/new-tab.png)

![Split view: two tabs side by side](docs/screenshots/split-view.png)

![The menu, drawn over the page](docs/screenshots/menu.png)

## Features

- **Perplexity search** by default — answers instead of a list of links. DuckDuckGo, Startpage,
  Brave Search, Kagi, Ecosia, Qwant, Google, Bing or your own engine are one click away.
- **Bangs** straight from the address bar, like Helium's native bangs: `!w moon` searches
  Wikipedia, `!yt` YouTube, `!gh` GitHub, `!p` Perplexity — 60 of them, resolved locally.
- **Moon Shield** — ads and trackers blocked with uBlock Origin's filter lists, EasyList,
  EasyPrivacy and Peter Lowe's list (no "acceptable ads" exceptions), including cosmetic filters
  and scriptlets. Optional cookie-banner and annoyance lists. One click switches it off per site.
- **Import from Comet** — bookmarks and history from Comet, Chrome, Brave, Edge, Helium, Vivaldi
  or any other Chromium browser, read directly from its profile folder
- **Split view** — two tabs side by side, with a divider to resize
- **Sleeping tabs** — tabs you haven't looked at for a while give their memory back and wake up
  when you return
- **Address bar** with suggestions from your history, bookmarks and open tabs, and inline
  completion — suggestions never leave your computer
- **Private windows** with their own in-memory session, wiped when the last one closes
- Tabs you can pin, mute, duplicate, drag around and reopen after closing; session restore
- History, bookmarks (with an optional bookmarks bar), downloads, find in page, zoom per site,
  print, full screen, developer tools
- **Night and day themes** (or follow the system); websites follow along when they support dark
  mode
- A new tab page with the **real moon phase** of today

![Settings: importing from Comet](docs/screenshots/settings-import.png)

## Privacy and security

Moon Browser is built to be safe by default. See [SECURITY.md](SECURITY.md) for the details.

- **No telemetry, no accounts, no sync.** Moon Browser only goes online for the pages you open
  and to refresh its filter lists every few days. Even Chromium's spell-check dictionaries are
  not fetched from Google unless you switch spell checking on (Linux).
- **HTTPS first** — every site is tried over HTTPS; if a site has no working HTTPS, or sends you
  back to HTTP, Moon Browser warns before loading it insecurely. Nothing is downgraded silently.
- **Dangerous pages are stopped** before they load: sites on the malware, scam and tracker lists
  get a warning page instead (like uBlock Origin's strict blocking).
- **Third-party cookies blocked**, **Global Privacy Control** sent, **tracking parameters**
  (`utm_…`, `fbclid`, `gclid`, …) removed from links, **WebRTC** can't reveal your local IP,
  **secure DNS** (DNS over HTTPS, with Quad9, Mullvad or Cloudflare to choose).
- **Permissions are asked for** — camera, microphone, location, notifications, clipboard,
  opening other apps and pop-ups without a click. USB, serial, HID and Bluetooth access are
  refused.
- **Downloads** — programs and scripts are only saved after you confirm, and on Windows every
  download gets the Mark of the Web, so SmartScreen checks it.
- **Sandboxed everything** — every page, Moon Browser's own pages and the browser UI run in
  Chromium's sandbox with context isolation; web pages can't reach the internal API or the
  `moon://` pages, and every IPC message is checked for who sent it.
- **Hardened app** — Electron fuses are flipped in the shipped binary: no running as Node.js,
  no `--inspect`, no `NODE_OPTIONS`, only the integrity-checked `app.asar` is loaded, and
  **cookies are encrypted on disk** with the system's key store.
- **No password store** — on purpose. Keep passwords in a dedicated password manager (Bitwarden,
  KeePassXC, …) that works in every browser.
- Optional: delete cookies and site data every time Moon Browser closes.

## Keyboard

| Keys                              | Action                                |
|-----------------------------------|---------------------------------------|
| `Ctrl T` / `Ctrl W`               | New tab / close tab                   |
| `Ctrl Shift T`                    | Reopen the last closed tab            |
| `Ctrl Tab` / `Ctrl Shift Tab`     | Next / previous tab                   |
| `Ctrl 1` … `Ctrl 8`, `Ctrl 9`     | Go to tab 1 … 8, to the last tab      |
| `Ctrl L`, `Alt D`, `F6`           | Address bar                           |
| `Alt Enter` in the address bar    | Open in a new tab                     |
| `Ctrl N` / `Ctrl Shift N`         | New window / new private window       |
| `Alt ←` / `Alt →`                 | Back / forward                        |
| `Ctrl R`, `F5` / `Ctrl Shift R`   | Reload / reload without cache         |
| `Ctrl F`, `F3` / `Shift F3`       | Find in page / next / previous match  |
| `Ctrl D`                          | Bookmark this page                    |
| `Ctrl H` / `Ctrl J` / `Ctrl Shift O` | History / downloads / bookmarks    |
| `Ctrl Shift B`                    | Show or hide the bookmarks bar        |
| `Ctrl +` / `Ctrl -` / `Ctrl 0`    | Zoom in / out / reset                 |
| `Ctrl ,`                          | Settings                              |
| `Ctrl Shift Delete`               | Clear browsing data                   |
| `F11` / `F12`                     | Full screen / developer tools         |
| `Ctrl Shift Q`                    | Quit                                  |

## Installation

Installers for **Windows** (`.exe`, x64 and ARM64) and **Linux** (`.AppImage`, `.deb`, `.rpm`)
are published on the [Releases](https://github.com/Luna-OS/Moon-Browser/releases) page. macOS
follows later.

- **Windows:** run the installer. Moon Browser registers itself as a web browser; choose it
  under *Settings → Apps → Default apps* (or with *Make default* in Moon Browser's settings).
- **Linux:** install the `.deb` or `.rpm`, or make the `.AppImage` executable and start it.
  On Ubuntu 24.04 and newer, prefer the `.deb`: it sets up Chromium's sandbox helper, which the
  AppImage can't.

The builds are not code-signed yet, so Windows SmartScreen asks once before the first start
(*More info → Run anyway*).

### Coming from Comet

Open *Settings → Import* (the new tab page offers it on a fresh profile too), pick Comet and
import your bookmarks and history. If Comet isn't found automatically, *Choose folder…* and
point Moon Browser at Comet's profile folder (on Windows usually
`%LOCALAPPDATA%\Perplexity\Comet\User Data\Default`). Passwords stay out on purpose: export them
from Comet into a password manager.

## How it compares to Helium

Helium is a patched Chromium (on top of ungoogled-chromium). Moon Browser takes Helium's ideas —
unbiased blocking, bangs, a quiet interface, privacy by default, split view — and builds them on
[Electron](https://www.electronjs.org), which ships the same Chromium engine and security fixes
but can be built on an ordinary machine in minutes instead of hours on a build farm. The
trade-off: no Chrome Web Store extensions; the most important one, an ad blocker, is built in.

## Development

```sh
npm install
npm run dev              # build and start Moon Browser
npm test                 # unit tests (address bar, bangs, settings, import, security rules, …)
npm run lint && npm run typecheck && npm run format:check
npm run test:e2e         # drives the real browser (needs a display; xvfb-run on Linux CI)
npm run dist:linux       # AppImage, .deb, .rpm in release/
npm run dist:win         # Windows installer in release/
```

Set `MOON_BROWSER_PROFILE=/some/folder` to start with a separate profile.

```
src/
  main/       the browser: windows, tabs, the request pipeline (HTTPS first, Moon Shield,
              cookies), permissions, downloads, import, the moon:// protocol, IPC
  preload/    the small APIs the browser UI and the internal pages get — nothing else
  renderer/
    ui/       the browser UI: tab strip, toolbar, address bar, menus (moon://ui)
    pages/    new tab, settings, history, bookmarks, downloads, about (moon://…)
    theme/    the night-sky design tokens, icons and the moon
  shared/     pure logic, unit-tested: address bar input, bangs, search engines,
              settings, suggestions, sites, HTTPS rules, security helpers, import
build/        icons and the Windows installer's browser registration
```

## Credits

[Chromium](https://www.chromium.org) and [Electron](https://www.electronjs.org);
[Helium](https://github.com/imputnet/helium) for the inspiration;
the [Ghostery adblocker](https://github.com/ghostery/adblocker) engine (MPL-2.0) with the filter
lists of [uBlock Origin](https://github.com/uBlockOrigin/uAssets),
[EasyList](https://easylist.to) and [Peter Lowe](https://pgl.yoyo.org/adservers/);
[tldts](https://github.com/remusao/tldts) for the Public Suffix List.

## License

This repository is licensed under the [MIT License](LICENSE). The filter lists Moon Browser
downloads keep their own licenses.
