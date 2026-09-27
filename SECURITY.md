# Security

Moon Browser is a web browser, so it treats every web page as hostile. This file describes how it
is built to stay safe, and how to report a problem.

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/Luna-OS/Moon-Browser/security/advisories/new)
rather than in a public issue. Include the Moon Browser version (*Settings → About*), your system
and the steps to reproduce.

Fixes for Chromium itself arrive with Electron updates; Moon Browser follows them closely
(Dependabot watches Electron weekly), and a release ships soon after a Chromium security fix.

## The security model

### Processes and sandboxing

- Every renderer — web pages, Moon Browser's own pages and the browser UI — runs in Chromium's
  **sandbox** with **context isolation** and **without Node.js**. The app-wide sandbox switch
  (`app.enableSandbox()`) is on; only an explicit `--no-sandbox` (needed for containers running
  as root) turns it off.
- Web pages get **no preload API at all**. Moon Browser's own pages (`moon://settings`, …) get a
  small `window.moon` API; the browser UI (`moon://ui`) gets `window.moonUI`.
- The main process **checks every IPC message**: UI commands must come from the main frame of a
  window's own UI, internal page calls from the main frame of a tab showing that internal page,
  and each page may only call the methods listed for it (`PAGE_METHODS` in `src/shared/ipc.ts`).
  All arguments are validated.
- Web pages **can't navigate to `moon://` pages**, not by link, redirect or `window.open`, and
  `moon://ui` doesn't exist in their session at all. Internal pages are served with a strict
  Content-Security-Policy and `frame-ancestors 'none'`.
- The browser UI's own session may only load `moon://` resources and site icons; no cookies or
  referrers are sent with those.
- `<webview>` is disabled everywhere.

### The shipped binary

Electron fuses are flipped at package time (`electron-builder.yml`):

| Fuse                                   | Setting | Why                                             |
|----------------------------------------|---------|-------------------------------------------------|
| RunAsNode                              | off     | the app can't be misused as a Node.js runtime   |
| EnableNodeOptionsEnvironmentVariable   | off     | no code injection through `NODE_OPTIONS`        |
| EnableNodeCliInspectArguments          | off     | no `--inspect` debugging of the main process    |
| EnableCookieEncryption                 | on      | cookies are encrypted with the OS key store     |
| OnlyLoadAppFromAsar                    | on      | only the packaged `app.asar` is loaded          |
| EnableEmbeddedAsarIntegrityValidation  | on      | … and it must match its embedded hash (Windows) |
| GrantFileProtocolExtraPrivileges       | off     | `file://` has no more rights than in Chrome     |

On Windows, the installer registers links as `moon-browser.exe -- "%1"`: after `--`, an address
can never be read as a command-line switch.

### Network

- **HTTPS first**: `http://` addresses (except local ones) are upgraded. If the secure connection
  fails, or the site redirects back to HTTP, a warning page asks before continuing insecurely.
- **Moon Shield** blocks ads and trackers by uBlock Origin–compatible filter lists. Pages whose
  whole host is on a list, or that match a `$document` rule (malware, scams, pure tracking
  hosts), are stopped before they load, with a warning page.
- **Third-party cookies** are removed from requests and responses; **tracking parameters** are
  removed from addresses; **Global Privacy Control** (`Sec-GPC: 1`) is sent.
- **WebRTC** only uses the public network interface, so pages can't learn local IP addresses.
- **Secure DNS**: DNS over HTTPS in automatic mode by default; Quad9, Mullvad or Cloudflare can
  be chosen for strict mode.
- The user agent is a plain, version-reduced Chrome user agent, and `Accept-Language` carries
  only the preferred language, so Moon Browser doesn't stand out. Pages get Chrome's
  low-entropy client hints (`Sec-CH-UA`, `-Mobile`, `-Platform`, only over HTTPS) and Chrome's
  `window.chrome` (`loadTimes`, `csi`, `app`): the same Chromium in every header and to every
  script. Google's sign-in turns away browsers that don't add up. FedCM is switched off, as
  in Firefox and Safari, because Electron has no account chooser behind it.
- Moon Browser itself only contacts the filter-list mirror (every few days), GitHub to look for a
  new release (every few hours; *Settings → Updates* switches it off) and, when extensions are
  installed, Google's extension update server for them. There is no telemetry, crash reporting
  or sync. Spell-check dictionaries (downloaded from Google on Linux) are only fetched if spell
  checking is switched on.

### Updates

Installed copies look for a newer release of `Luna-OS/Moon-Browser` on GitHub (`latest.yml`,
`latest-linux.yml`), download it over HTTPS and check it against the SHA-512 hash in that file
before installing. Downgrades and pre-releases are never installed. On Windows the new
installer runs over the installed version (per user, no administrator rights); an AppImage is
replaced; `.deb` and `.rpm` packages are installed through `pkexec`/`sudo`, which asks for the
administrator password, and only when the user clicks *Update*. Because the builds aren't
code-signed yet, an update is as trustworthy as the GitHub release it comes from.

The Windows installer only removes the browser registration when Moon Browser is really
uninstalled, not while an update replaces it; the profile is never deleted by the installer.

### Engine security updates

Moon Browser's engine is Chromium, inside Electron. Chromium's security fixes — the ones Chrome
and Helium ship — reach Moon Browser through Electron's patch releases, which carry them to
Electron's supported major versions (its latest three), usually within days. The *Security
updates* workflow (`.github/workflows/security-updates.yml`, `scripts/security-update.mjs`)
looks for a newer Electron release of Moon Browser's major version every six hours. It installs
it, runs all of CI with it (unit tests, the end-to-end test on Linux and Windows, packaging, the
installer test) and, only if everything passes, puts it on `main` and releases the next patch
version; installed copies then update themselves. A failed test or a new Electron major version
(which can change APIs) becomes an issue for a person instead. Each run's summary compares
Moon Browser's Electron with the Chromium version Helium builds on.

### Extensions

- Extensions only come from the **Chrome Web Store** (Manifest V3 only). The package is
  downloaded over HTTPS from Google's update server, and its extension ID must match the key
  inside it. Nothing side-loaded into the profile's Extensions folder is loaded.
- **Developer mode** (off by default, a switch on `moon://extensions`) adds one exception: an
  extension loaded from a folder the user picks. It gets the same permission confirmation as a
  Web Store install, can't take the ID of an installed Web Store extension, and runs only while
  developer mode is on.
- When an extension's service worker script no longer compiles (a damaged file), the
  extensions page says so and offers *Repair*: the package is downloaded from the Web Store
  again, and the old copy is only replaced once the new one has arrived. The script is compiled
  for this check, never run.
- Before an extension is added, Moon Browser shows what it may do (the permission warnings
  Chrome would show) and adds nothing without a click on *Add extension*. Optional permissions
  requested later are asked for the same way.
- Extensions run **only in normal windows**, never in private ones, and web pages get none of
  their APIs: the extension API preloads only act on `chrome-extension://` pages and the
  Chrome Web Store's own pages.
- Extension pages get only the web permissions their manifest declares (notifications,
  clipboard reading, location); everything else is refused.
- Links in extension pop-ups open as normal tabs. Extensions are updated from the Chrome Web
  Store; *Menu → Extensions* switches them off or removes them with their files.
- The toolbar's extension buttons live in the browser UI; the only thing they can reach is the
  extension system of the normal browsing session.
- **WebAuthn in extension pages** (Windows only; NordPass sets up Windows Hello with it):
  Electron refuses `navigator.credentials` in `chrome-extension://` pages, so Moon Browser
  answers it through Windows' own WebAuthn API (`webauthn.dll`, the system dialog Chrome uses
  too), with Chrome's rules. The main process takes the extension from the calling frame's
  origin and writes the client data itself (origin `chrome-extension://<id>`); the relying
  party ID is the extension's own origin, or a web domain only if the extension has host
  permission for it. Only extension pages can call it, never web pages or service workers. The
  call goes through [koffi](https://koffi.dev/), whose native module ships with the Windows
  build (`resources/koffi`) and is loaded only when an extension asks.

### Permissions

Fullscreen, pointer lock, writing to the clipboard and similar harmless capabilities are granted.
Camera, microphone, location, notifications, reading the clipboard, opening other apps and
pop-ups without a click are **asked for** in a bar above the page; decisions can be remembered
per site (in private windows only until they close) and reset in *Settings → Site permissions*.
USB, serial, HID, Bluetooth and screen capture are refused.

### Downloads

Files that run code (`.exe`, `.msi`, `.bat`, `.ps1`, `.js`, `.jar`, `.sh`, `.AppImage`, `.deb`,
…) are downloaded under a name nothing runs (`Unconfirmed <number>.crdownload`, as Chrome does)
and only get their own name once the user chooses *Keep anyway*; *Discard* deletes them, even
if they had already finished (up to 0.1.10, a small file could be complete before the question
was answered). On Windows, every download gets the **Mark of the Web** (`Zone.Identifier`), so
SmartScreen and Office treat it as coming from the internet.

### Data at rest

History, bookmarks and settings are plain JSON files in the profile folder, written atomically.
Cookies are encrypted (see fuses). Moon Browser stores **no passwords**. Private windows use an
in-memory session that is wiped when the last private window closes. Optionally, cookies and
site data are deleted whenever Moon Browser closes.

### Importing

The importer only reads bookmarks and history, from browser profile folders it detected itself
or that the user picked in a folder dialog; the settings page can't point it anywhere else. The
history database is read from a temporary copy, read-only. Passwords, cookies and payment data are
never imported.

## Known limitations

- Extensions run on Electron's extension support plus electron-chrome-extensions and Moon
  Browser's own additions (side panel, identity, tab groups, search, debugger, proxy,
  `declarativeNetRequest` rules, `runtime.onInstalled` / `onStartup`), which cover the common
  APIs but not all of Chrome's: keyboard commands and moving tab groups to another window are
  missing, and `chrome.webRequest` listeners get no events (Moon Shield handles the requests
  itself).
- `declarativeNetRequest` rules (static rulesets, dynamic and session rules) apply to requests
  of web pages in normal windows, before Moon Shield: block, allow, allowAllRequests,
  upgradeScheme, redirect and modifyHeaders. Redirects and header changes need host access to
  the request's site, as in Chrome.
- `chrome.privacy` settings can be read but not changed: Moon Browser has no password saving or
  autofill of its own, so extensions (password managers turn these off) find them off already.
- `chrome.proxy` sets the proxy of normal windows (the extension that set it last controls it,
  until it's switched off or removed); private windows always use the system's proxy. Native messaging starts the desktop apps registered for Google Chrome, only for the
  extensions those apps name, as Chrome does.
- `chrome.debugger` (for extensions that declare it, with the install warning "Access the page
  debugger") can attach to web pages only, never to Moon Browser's own pages.
- Extension packages are checked for the right ID and come over HTTPS from Google, but their
  signature isn't verified beyond that the way Chrome does.
- Chromium's Safe Browsing service isn't part of Electron; the Moon Shield lists (including
  uBlock Origin's *Badware risks* list) and, optionally, Quad9 DNS cover part of it.
- The builds are not code-signed yet.
