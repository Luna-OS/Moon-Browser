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
  only the preferred language, so Moon Browser doesn't stand out.
- Moon Browser itself only contacts the filter-list mirror (every few days). There is no
  telemetry, crash reporting, sync or update check. Spell-check dictionaries (downloaded from
  Google on Linux) are only fetched if spell checking is switched on.

### Permissions

Fullscreen, pointer lock, writing to the clipboard and similar harmless capabilities are granted.
Camera, microphone, location, notifications, reading the clipboard, opening other apps and
pop-ups without a click are **asked for** in a bar above the page; decisions can be remembered
per site (in private windows only until they close) and reset in *Settings → Site permissions*.
USB, serial, HID, Bluetooth and screen capture are refused.

### Downloads

Files that run code (`.exe`, `.msi`, `.bat`, `.ps1`, `.js`, `.jar`, `.sh`, `.AppImage`, `.deb`,
…) are paused until the user confirms. On Windows, every download gets the **Mark of the Web**
(`Zone.Identifier`), so SmartScreen and Office treat it as coming from the internet.

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

- Chrome Web Store extensions are not supported.
- Chromium's Safe Browsing service isn't part of Electron; the Moon Shield lists (including
  uBlock Origin's *Badware risks* list) and, optionally, Quad9 DNS cover part of it.
- The builds are not code-signed yet.
