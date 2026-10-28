# Luma

> The web, calmly under the moon.

Luma is a private, open-source Chromium browser for Windows, macOS and Linux — in the spirit of
[Helium](https://github.com/imputnet/helium): no bloat, no noise, ad and tracker blocking built in,
and nothing phoning home. It wears the same night-sky design as
[MoonDisk](https://github.com/Luna-OS/MoonDisk) and [MoonTask](https://github.com/Luna-OS/Moon-Task).

Luma was called **Moon Browser** until version 0.1.35. Copies installed under the old name
update to Luma by themselves and keep their profile — bookmarks, history, logins, extensions —
and their place as the default browser.

![The new tab page: today's moon phase, the time and a search box](docs/screenshots/new-tab.png)

![Split view: two tabs side by side](docs/screenshots/split-view.png)

![The menu, drawn over the page](docs/screenshots/menu.png)

## Features

- **Perplexity search** by default — answers instead of a list of links. DuckDuckGo, Startpage,
  Brave Search, Kagi, Ecosia, Qwant, Google, Bing or your own engine are one click away.
- **Bangs** straight from the address bar, like Helium's native bangs: `!w moon` searches
  Wikipedia, `!yt` YouTube, `!gh` GitHub, `!p` Perplexity — 60 of them, resolved locally.
- **Luma Shield** — ads and trackers blocked with uBlock Origin's filter lists, EasyList,
  EasyPrivacy and Peter Lowe's list (no "acceptable ads" exceptions), including cosmetic filters
  and scriptlets. Optional cookie-banner and annoyance lists. One click switches it off per site.
- **Import from Comet** — bookmarks (with their folders, just as they were) and history from
  Comet, Chrome, Brave, Edge, Helium, Vivaldi or any other Chromium browser, read directly from
  its profile folder — Chrome's bookmarks saved in your Google Account included
- **Chrome extensions** from the Chrome Web Store — your password manager (NordPass, Bitwarden,
  1Password, …) with its toolbar button and pop-up, and side-panel extensions like Claude. The
  puzzle button lists them like Chrome does (*Full access* / *No access needed* on the current
  site), pins them to the toolbar and opens their options. Claude takes screenshots, downloads its
  GIFs and talks to Claude Desktop and Claude Code (native messaging, through the apps registered
  for Chrome). Before an extension is added, Luma shows
  what it will be able to do; `moon://extensions` switches them off, removes them
  and shows their issues (repeats counted once, noise left out), and repairs an extension whose files got damaged.
- **Developer mode** on `moon://extensions` — load your own extension from a folder (*Load
  unpacked*), reload it after changes, see its ID and errors
- **Updates without reinstalling** — Luma downloads a new version in the background; one
  click on *Update* installs it over the old one and brings your tabs back — on macOS too
- **Default browser in one click** — from the new tab page, the menu or *Settings → System*
- **Signing in to Google works** — Google turns away browsers that look like an app with a
  browser built in ("This browser or app may not be secure"). Luma gives pages Chrome's
  whole `window.chrome` and says the same Chromium everywhere: in its user agent, its client
  hints and to scripts. "Sign in with Google" on other sites opens Google's pop-up
- **Tab groups** like Chrome's — right-click a tab → *Add tab to new group*, give the group a
  name and a colour, click its label to collapse it, drag tabs in and out, drag the label to move
  the whole group. Extensions can use them through `chrome.tabGroups`.
- **Continue where you left off** — your tabs and tab groups come back after a restart (switch
  it off under *Settings → Tabs & startup*)
- **Split view** — two tabs side by side, with a divider to resize
- **Perplexity in Luma's look** — the night sky and lavender instead of teal, and **Axo**, Moon
  Code's pixel axolotl, sitting on the search box: it introduces itself, shows how the search works and
  has tips when you click it (*Settings → Search* switches it off). On an answer, Axo sits beside it
  and says it — the answer becomes its speech bubble — and follows you through the conversation
- **YouTube in Luma's look** (optional, *Settings → Appearance*) — the night sky on YouTube, a
  glowing moon on the progress bar and a sparkle on the volume slider
- **Netflix, Disney+, Prime Video and Spotify** play: protected (DRM) content works with
  Google's Widevine module, through castLabs' Electron for Content Security. *Settings → System*
  switches it off, as well as hardware acceleration
- **WebGPU** for 3D sites and games where Chromium offers it (Windows, macOS). *Settings →
  System → WebGPU on every graphics card* also turns it on for graphics cards Chromium doesn't
  allow yet, and on Linux
- **Sleeping tabs** — tabs you haven't looked at for a while give their memory back and wake up
  when you return
- **Address bar** with suggestions from your history, bookmarks and open tabs, and inline
  completion — suggestions never leave your computer
- **Private windows** with their own in-memory session, wiped when the last one closes
- Tabs you can pin, mute, duplicate, drag around and reopen after closing
- A quiet taskbar icon: sites can't put their unread counts on it (`navigator.setAppBadge` does
  nothing, as in Chrome for sites that aren't installed apps)
- **Bookmarks with folders** — on the bookmarks bar a folder opens as a menu (folders inside
  it too); the star (`Ctrl D`) names a bookmark and puts it in a folder, or in a new one;
  `moon://bookmarks` sorts them, and a right-click on the bar opens a folder's bookmarks all at
  once, renames it or moves things to another folder. Folders hold folders: *New folder in …*
  in a folder's menu, its right-click menu, the star's editor (`+`) and on `moon://bookmarks`. Show the bar or not — your choice: in the menu, on
  `moon://bookmarks`, in the star's editor, with a right-click on the bar or with `Ctrl Shift B`
- History, downloads, find in page, zoom per site, print, full screen, developer tools
- **Night and day themes** (or follow the system); websites follow along when they support dark
  mode
- A new tab page with the **real moon phase** of today

![Settings: importing from Comet](docs/screenshots/settings-import.png)

## Privacy and security

Luma is built to be safe by default. See [SECURITY.md](SECURITY.md) for the details.

- **No telemetry, no accounts, no sync.** Luma only goes online for the pages you open,
  to refresh its filter lists every few days and to look for a new release on GitHub (every few
  hours; *Settings → Updates* switches it off). Installed extensions are kept up to date from the
  Chrome Web Store. Even Chromium's spell-check dictionaries are not fetched from Google unless
  you switch spell checking on (Linux). The Widevine module for protected content (Netflix and
  the like) comes from Google and is kept up to date from there, unless you switch protected
  content off.
- **HTTPS first** — every site is tried over HTTPS; if a site has no working HTTPS, or sends you
  back to HTTP, Luma warns before loading it insecurely. Nothing is downgraded silently.
- **Dangerous pages are stopped** before they load: sites on the malware, scam and tracker lists
  get a warning page instead (like uBlock Origin's strict blocking).
- **Third-party cookies blocked**, **Global Privacy Control** sent, **tracking parameters**
  (`utm_…`, `fbclid`, `gclid`, …) removed from links, **WebRTC** can't reveal your local IP,
  **secure DNS** (DNS over HTTPS, with Quad9, Mullvad or Cloudflare to choose) — or **your own
  DNS server**, named as you like: a Pi-hole or Unbound at home or one in Netbird or Tailscale
  by IP address and port (`100.64.0.53:5335`), or any DNS-over-HTTPS address
  (*Settings → Privacy & Shield → Your DNS servers*).
- **Permissions are asked for** — camera, microphone, location, notifications, clipboard,
  opening other apps and pop-ups without a click. Until you've answered, sites see "not asked
  yet" (as in Chrome), not "blocked", so they ask. USB, serial, HID and Bluetooth access are
  refused.
- **Downloads** — programs and scripts are held under a harmless name (`Unconfirmed ….crdownload`)
  until you choose *Keep anyway*. On Windows every download gets the Mark of the Web, so
  SmartScreen checks it; on macOS the quarantine mark, so Gatekeeper checks apps before they
  first open.
- **Questions in Luma's own dialogs** — adding or removing an extension, its requests
  for more access, program downloads, *Leave site?* and a page's `alert()`, `confirm()` and
  `prompt()` are asked in the night-sky look over the window, not in the system's message box.
  A page that keeps asking can be stopped (*Don't let this page show more dialogs*).
- **Sandboxed everything** — every page, Luma's own pages and the browser UI run in
  Chromium's sandbox with context isolation; web pages can't reach the internal API or the
  `moon://` pages, and every IPC message is checked for who sent it.
- **Security updates on their own** — Chromium's security fixes (the ones Chrome and Helium
  ship) reach Luma through Electron's patch releases. Every six hours a workflow looks
  for one, runs every test with it and, if they all pass, releases the next version; your copy
  then updates itself.
- **Hardened app** — Electron fuses are flipped in the shipped binary: no running as Node.js,
  no `--inspect`, no `NODE_OPTIONS`, only the integrity-checked `app.asar` is loaded, and
  **cookies are encrypted on disk** with the system's key store.
- **No built-in password store** — on purpose. Add your password manager's extension (NordPass,
  Bitwarden, 1Password, …) from the Chrome Web Store instead.
- **Extensions only with your OK** — each one shows its permissions before it is added, only
  comes from the Chrome Web Store, and never runs in private windows.
- Optional: delete cookies and site data every time Luma closes.

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
| `Ctrl D`                          | Bookmark this page (name, folder)     |
| `Ctrl H` / `Ctrl J` / `Ctrl Shift O` | History / downloads / bookmarks    |
| `Ctrl Shift B`                    | Show or hide the bookmarks bar        |
| `Ctrl +` / `Ctrl -` / `Ctrl 0`    | Zoom in / out / reset                 |
| `Ctrl ,`                          | Settings                              |
| `Ctrl Shift Delete`               | Clear browsing data                   |
| `F11` / `F12`                     | Full screen / developer tools         |
| `Ctrl Shift Q`                    | Quit                                  |

On a Mac, `⌘` takes the place of `Ctrl`, and Chrome's Mac keys work: `⌘ [` / `⌘ ]` back and
forward, `⌘ ⇧ [` / `⌘ ⇧ ]` or `⌘ ⌥ ←` / `⌘ ⌥ →` previous and next tab, `⌘ Y` history,
`⌥ ⌘ B` bookmarks, `⇧ ⌘ J` downloads, `⌃ ⌘ F` full screen, `⌥ ⌘ I` developer tools, `⌘ Q`
quit. The menu bar has them all; `⌘ H` hides Luma, as in every Mac app.

## Installation

Installers for **Windows** (`.exe`, x64; runs on ARM64 through Windows' emulation), **macOS**
(`.dmg`, for Apple Silicon and for Intel Macs) and **Linux** (`.AppImage`, `.deb`, `.rpm`) are
published on the [Releases](https://github.com/Luna-OS/Moon-Browser/releases) page.

- **Windows:** run the installer — it installs for your user account, needs no administrator
  rights and lets you choose the folder. Luma registers itself as a web browser; *Make
  default* (new tab page, menu or settings) opens Windows' *Default apps* with Luma
  preselected.
- **macOS** (13 Ventura or newer): open the `.dmg` for your Mac — `arm64` for Apple Silicon
  (M1 and later), `x64` for Intel — and drag Luma into *Applications*. *Make default*
  asks macOS, which then asks you to confirm.
- **Linux:** install the `.deb` or `.rpm`, or make the `.AppImage` executable and start it.
  On Ubuntu 24.04 and newer, prefer the `.deb`: it sets up Chromium's sandbox helper, which the
  AppImage can't.

The builds are not code-signed yet, so Windows SmartScreen asks once before the first start
(*More info → Run anyway*). The Mac app is signed only "ad hoc", not with an Apple Developer ID,
and not notarized by Apple, so macOS refuses the first start ("Apple could not verify …"):

- macOS 15 Sequoia and newer: try to open it once, then *System Settings → Privacy & Security →
  Open Anyway*.
- macOS 14 and older: right-click Luma in *Applications* → *Open* → *Open*.
- Or, in Terminal: `xattr -dr com.apple.quarantine "/Applications/Luma.app"`

macOS asks only once. Cookies are encrypted with a key in your Keychain; after an update macOS
may ask once more whether Luma may use it (*Always Allow*).

### Updates

Luma looks for a new release every few hours and downloads it in the background. When
it is ready, an **Update** button appears next to the menu: click it and Luma restarts
into the new version with your tabs. Nothing has to be uninstalled, and your profile —
bookmarks, history, settings, extensions — stays where it is. *Settings → Updates* shows the
state and has a *Check now* button.

- **Windows:** the new installer runs silently over the installed version (also when you quit).
- **AppImage:** the AppImage file is replaced.
- **.deb / .rpm:** the package is installed with your system's package tool, which asks for your
  password — so only when you click *Update*.
- **macOS:** the Mac builds aren't signed with an Apple Developer ID, so macOS's own updater won't
  install over them; Luma does it itself. It downloads the zip for your Mac, checks it
  against the SHA-512 the release lists, checks the new app's signature, bundle ID and version,
  and swaps it in for the old one when you click *Update* (or when you quit). This needs Luma in
  a folder you can write to — *Applications* is fine. Started from the disk image,
  *Update* opens the release's download page instead.

  Copies older than 0.1.35 (still called Moon Browser) can't do that yet. To bring one up to date
  in place — no uninstalling, everything stays — paste this into *Terminal*:

  ```sh
  curl -fsSL https://github.com/Luna-OS/Moon-Browser/releases/latest/download/update-mac.sh | bash
  ```

  It ([scripts/update-mac.sh](scripts/update-mac.sh)) makes the same checks, quits the browser,
  swaps in the new app as *Luma* and opens it again.

Running the installer of a newer version by hand works too: it updates in place.

### Using NordPass (or another password manager)

1. Open *Menu → Extensions* and click **Chrome Web Store** (or go straight to
   [NordPass in the Chrome Web Store](https://chromewebstore.google.com/detail/eiaeiblijfjekdanodkjadfinkhbfgcd)).
2. Click **Add to Luma** and confirm what the extension may do.
3. The NordPass button appears in the toolbar: sign in there. Autofill, saved logins and the
   2FA codes of NordPass Authenticator all live in the extension.
4. On Windows, NordPass can use **Windows Hello** (fingerprint, face or PIN) to unlock and for
   NordPass Authenticator: Luma passes the extension's request to Windows' own
   WebAuthn dialog, laid out exactly as Chrome lays it out. Should Windows refuse it at once,
   Luma tries again from the page's own window and with the older layout, and
   `moon://extensions` lists what Windows said to each try.

Extensions get the Chrome APIs password managers rely on — storage, alarms, idle, tabs, windows,
scripting, cookies, context menus, notifications, offscreen documents, identity (sign-in
windows), pop-ups and content scripts. Talking to the NordPass *desktop app* (native messaging)
uses the connection the app registers for Google Chrome. If an extension misbehaves,
`moon://extensions` shows its errors under *Errors*. Messages an extension sends while none of
its pages is open to receive them (*Could not establish connection. Receiving end does not
exist.*) are harmless and not listed — only for your own extensions, loaded from a folder in
developer mode, where they can help.

### Coming from Comet

Open *Settings → Import* (the new tab page offers it on a fresh profile too), pick Comet and
import your bookmarks and history. The bookmarks keep their folders, and the bookmarks bar
switches on to show them. If Comet isn't found automatically, *Choose folder…* and
point Luma at Comet's profile folder (on Windows usually
`%LOCALAPPDATA%\Perplexity\Comet\User Data\Default`). Passwords stay out on purpose: export them
from Comet into a password manager.

## How it compares to Helium

Helium is a patched Chromium (on top of ungoogled-chromium). Luma takes Helium's ideas —
unbiased blocking, bangs, a quiet interface, privacy by default, split view, extensions from the
Chrome Web Store — and builds them on [Electron](https://www.electronjs.org), which ships the
same Chromium engine and security fixes but can be built on an ordinary machine in minutes
instead of hours on a build farm. The trade-off: Electron's extension support covers the common
Chrome extension APIs (pop-ups, side panels, content scripts, storage, tabs, windows, context
menus, cookies, notifications, identity, native messaging, tab groups, `declarativeNetRequest`
rules, proxy), not all of them — `chrome.webRequest` events are missing, for example. The most important extension, an ad
blocker, is built in.

## Development

```sh
npm install
npm run dev              # build and start Luma
npm test                 # unit tests (address bar, bangs, settings, import, security rules, …)
npm run lint && npm run typecheck && npm run format:check
npm run test:e2e         # drives the real browser, with a test extension (needs a display)
npm run dist:linux       # AppImage, .deb, .rpm in release/
npm run dist:win         # Windows installer in release/
npm run dist:mac         # .dmg and .zip for Apple Silicon and Intel in release/ (on a Mac)
```

Set `MOON_BROWSER_PROFILE=/some/folder` to start with a separate profile.

```
src/
  main/       the browser: windows, tabs, the request pipeline (HTTPS first, Luma Shield,
              cookies), permissions, downloads, import, extensions, updates, the moon://
              protocol, IPC
  preload/    the small APIs the browser UI and the internal pages get — nothing else
  renderer/
    ui/       the browser UI: tab strip, toolbar, address bar, menus (moon://ui)
    pages/    new tab, settings, history, bookmarks, downloads, extensions, about (moon://…)
    theme/    the night-sky design tokens, icons and the moon
  shared/     pure logic, unit-tested: address bar input, bangs, search engines,
              settings, suggestions, sites, HTTPS rules, security helpers, import,
              extension manifests
build/        icons, the Windows installer (theme, artwork, browser registration), the Mac
              entitlements and the packaging hooks (fuses, VMP signing)
scripts/      build, end-to-end test (with a test extension in fixtures/), artwork rendering
```

## Credits

[Chromium](https://www.chromium.org) and [Electron](https://www.electronjs.org);
[Helium](https://github.com/imputnet/helium) for the inspiration;
the [Ghostery adblocker](https://github.com/ghostery/adblocker) engine (MPL-2.0) with the filter
lists of [uBlock Origin](https://github.com/uBlockOrigin/uAssets),
[EasyList](https://easylist.to) and [Peter Lowe](https://pgl.yoyo.org/adservers/);
[tldts](https://github.com/remusao/tldts) for the Public Suffix List;
[electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) (GPL-3.0)
and electron-chrome-web-store (MIT) for Chrome extensions;
[electron-updater](https://www.electron.build/auto-update) (MIT) for updates.

## License

Luma is free software: you can redistribute it and/or modify it under the terms of the
[GNU General Public License](LICENSE), version 3 or (at your option) any later version.
Copyright © 2026 Luna. The filter lists Luma downloads keep their own licenses.
