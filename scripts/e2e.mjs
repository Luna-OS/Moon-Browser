// End-to-end smoke test: starts the built Moon Browser (npm run build first)
// with a fresh profile, drives it like a user and checks the results in the
// main process. Needs a display (xvfb-run on Linux CI).
//
//   node scripts/e2e.mjs [--screenshots dir]
import { _electron as electron } from "playwright-core";
import { createHash, generateKeyPairSync } from "node:crypto";
import { access, cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const shotsArg = process.argv.indexOf("--screenshots");
const shotsDir = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : null;

const PAGES = {
  "/": `<!doctype html><title>Moon test page</title><body style="font:16px sans-serif;padding:2rem">
    <h1>Hello from the test server</h1><p>The moon is a loyal companion.</p>
    <a id="link" href="/second">Second page</a>
    <a id="blank" href="/second" target="_blank">New tab</a>
    <a id="internal" href="moon://settings/">Sneaky settings link</a></body>`,
  "/second": `<!doctype html><title>Second page</title><body style="padding:2rem"><h1>Second</h1></body>`,
};

const server = createServer((req, res) => {
  // For the extension's declarativeNetRequest rules.
  const dnr = {
    "/dnr-blocked": "not blocked",
    "/dnr-dynamic": "not blocked",
    "/dnr-echo": String(req.headers["x-moon-dnr"] ?? "none"),
    "/dnr-old": "old",
    "/dnr-new": "new",
  }[req.url ?? ""];
  if (dnr) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(dnr);
    return;
  }
  const body = PAGES[req.url ?? "/"];
  res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(body ?? "not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = await mkdtemp(join(tmpdir(), "moon-e2e-"));
if (shotsDir) await mkdir(shotsDir, { recursive: true });

// A small Chrome extension, installed the way the Chrome Web Store installs
// them: Extensions/<id>/<version>_0 in the profile.
const EXTENSION_ID = "cbjmnpnjdiaanhmjfcndgpnieioncein";
await cp(
  join(root, "scripts", "fixtures", "test-extension"),
  join(profile, "Extensions", EXTENSION_ID, "1.0.0_0"),
  { recursive: true },
);
// The same package under another ID: its key doesn't match, so it must not load.
const IMPOSTOR_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
await cp(
  join(root, "scripts", "fixtures", "test-extension"),
  join(profile, "Extensions", IMPOSTOR_ID, "1.0.0_0"),
  { recursive: true },
);

// A fake Comet profile to import from, where Comet keeps it: under
// %LOCALAPPDATA% on Windows, under $XDG_CONFIG_HOME on Linux.
const config = await mkdtemp(join(tmpdir(), "moon-e2e-config-"));
const cometUserData =
  process.platform === "win32"
    ? join(config, "Perplexity", "Comet", "User Data")
    : join(config, "Comet");
const comet = join(cometUserData, "Default");
await mkdir(comet, { recursive: true });
await writeFile(
  join(cometUserData, "Local State"),
  JSON.stringify({ profile: { info_cache: { Default: { name: "Luna" } } } }),
);
await writeFile(
  join(comet, "Bookmarks"),
  JSON.stringify({
    roots: {
      bookmark_bar: {
        type: "folder",
        name: "Bookmarks bar",
        children: [{ type: "url", name: "Perplexity", url: "https://www.perplexity.ai/" }],
      },
      other: { type: "folder", name: "Other", children: [] },
    },
  }),
);
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(comet, "History"));
  db.exec(
    "CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)",
  );
  const chromeNow = (BigInt(Date.now()) + 11_644_473_600_000n) * 1000n;
  db.prepare(
    "INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, 4, 1, ?, 0)",
  ).run("https://comet.example/moon", "From Comet", chromeNow);
  db.close();
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(
      `  ✗ ${name}\n      ${String(err?.message ?? err)
        .split("\n")
        .join("\n      ")}`,
    );
  }
}

async function waitFor(fn, what, timeout = 15_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

// On Linux, a stand-in for Windows' webauthn.dll (scripts/fixtures/webauthn)
// takes the part of Windows Hello, so extensions' navigator.credentials is
// tested end to end.
let webauthnMock = null;
if (process.platform === "linux") {
  const { execFileSync } = await import("node:child_process");
  const fixture = join(root, "scripts", "fixtures", "webauthn");
  try {
    const lib = join(profile, "libwebauthn-mock.so");
    execFileSync("cc", ["-shared", "-fPIC", "-I", fixture, "-o", lib, join(fixture, "mock.c")]);
    webauthnMock = lib;
  } catch (err) {
    console.log(`  (no WebAuthn stand-in: ${err.message})`);
  }
}

const args = [root];
if (process.platform === "linux") args.push("--no-sandbox");
const app = await electron.launch({
  executablePath: require("electron"),
  args,
  env: {
    ...process.env,
    ...(webauthnMock ? { MOON_WEBAUTHN_LIBRARY: webauthnMock } : {}),
    MOON_BROWSER_PROFILE: profile,
    ...(process.platform === "win32" ? { LOCALAPPDATA: config } : { XDG_CONFIG_HOME: config }),
  },
});

/** The URLs and titles of all tabs, straight from the main process. */
const tabs = () =>
  app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter(
        (wc) =>
          !wc.getURL().startsWith("moon://ui") && wc.getType() !== "remote" && !wc.isDestroyed(),
      )
      .map((wc) => ({ url: wc.getURL(), title: wc.getTitle() })),
  );

/**
 * Presses keys the way the OS delivers them. (Playwright's own keyboard
 * goes through DevTools and skips the path browser shortcuts listen on.)
 */
const press = (keyCode, modifiers = []) =>
  app.evaluate(
    ({ webContents }, [key, mods]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("moon://ui"));
      wc.sendInputEvent({ type: "keyDown", keyCode: key, modifiers: mods });
      wc.sendInputEvent({ type: "keyUp", keyCode: key, modifiers: mods });
    },
    [keyCode, modifiers],
  );

async function shot(name) {
  if (!shotsDir) return;
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("python3", [
      "-c",
      `from PIL import ImageGrab; ImageGrab.grab(xdisplay="${process.env.DISPLAY}").save("${join(shotsDir, name)}.png")`,
    ]);
  } catch {
    const page = app.windows().find((p) => p.url().startsWith("moon://ui"));
    await page?.screenshot({ path: join(shotsDir, `${name}.png`) });
  }
}

console.log("Moon Browser end-to-end test");
try {
  // Tabs are pages too; the browser UI is the one on moon://ui.
  const ui = await waitFor(
    () => app.windows().find((p) => p.url().startsWith("moon://ui")),
    "the UI page",
  );
  await ui.waitForLoadState("domcontentloaded");

  await check("the browser UI shows a tab", async () => {
    await waitFor(() => ui.locator('[role="tab"]').count(), "a tab in the tab strip");
  });

  await check("the first tab shows the new tab page", async () => {
    await waitFor(
      async () => (await tabs()).some((t) => t.url === "moon://newtab/"),
      "moon://newtab/",
    );
    await waitFor(async () => (await tabs()).some((t) => t.title === "New tab"), "its title");
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot("01-new-tab");

  await check("typing an address opens the page", async () => {
    const box = ui.getByRole("combobox", { name: "Address and search bar" });
    await box.click();
    await box.fill(`${base}/`);
    await box.press("Enter");
    await waitFor(
      async () => (await tabs()).some((t) => t.title === "Moon test page"),
      "the test page",
    );
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot("02-web-page");

  await check("a Chrome extension loads and its content script runs", async () => {
    await waitFor(
      () =>
        app.evaluate(
          ({ session }, id) => !!session.defaultSession.extensions.getExtension(id),
          EXTENSION_ID,
        ),
      "the extension to load",
    );
    const loaded = await app.evaluate(({ session }) =>
      session.defaultSession.extensions.getAllExtensions().map((e) => e.id),
    );
    if (loaded.join() !== EXTENSION_ID) throw new Error(`loaded: ${loaded.join()}`);
    await waitFor(
      () =>
        app.evaluate(({ webContents }) => {
          const wc = webContents.getAllWebContents().find((w) => w.getTitle() === "Moon test page");
          return wc.executeJavaScript(
            "document.documentElement.dataset.moonExtension === 'content-script' && document.documentElement.dataset.moonPong === 'yes'",
          );
        }),
      "the content script and its answer from the service worker",
    );
  });

  /** The pop-up window's bounds while it shows, else null. */
  const popupBounds = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && w.webContents.getURL().endsWith("/popup.html"),
      );
      return win?.isVisible() ? win.getBounds() : null;
    });

  /** Evaluates `code` in the extension's pop-up. */
  const inPopup = (code) =>
    app.evaluate(
      ({ webContents }, js) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().endsWith("/popup.html"))
          ?.executeJavaScript(js),
      code,
    );
  const extensionButton = () =>
    waitFor(async () => {
      const box = await ui
        .getByRole("button", { name: "Moon test extension", exact: true })
        .boundingBox()
        .catch(() => null);
      return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, "the extension button");

  /** Fetches paths from the test page; each gives its text or "blocked". */
  const fetchFromPage = (paths) =>
    app.evaluate(({ webContents }, list) => {
      const wc = webContents.getAllWebContents().find((w) => w.getTitle() === "Moon test page");
      return wc.executeJavaScript(
        `Promise.all(${JSON.stringify(list)}.map((p) => fetch(p).then((r) => r.text(), () => "blocked")))`,
      );
    }, paths);

  await check("the extension's declarativeNetRequest rules apply", async () => {
    const [blocked, echo, redirected, free] = await fetchFromPage([
      "/dnr-blocked",
      "/dnr-echo",
      "/dnr-old",
      "/second",
    ]);
    if (blocked !== "blocked") throw new Error(`block rule: ${blocked}`);
    if (echo !== "on") throw new Error(`header rule: ${echo}`);
    if (redirected !== "new") throw new Error(`redirect rule: ${redirected}`);
    if (!free.includes("Second")) throw new Error(`unmatched request: ${free}`);
  });

  await check("the extension's toolbar button opens its pop-up", async () => {
    const button = await extensionButton();
    await ui.mouse.click(button.x, button.y);
    // The pop-up asks chrome.tabs which tab is active and shows its title.
    await waitFor(
      () =>
        inPopup("document.getElementById('tab').textContent").then(
          (title) => title === "Moon test page",
        ),
      "the pop-up to name the active tab",
    );
    // …in a window that shows (sized to its page, or measured where
    // Chromium doesn't report the size, as under this test's DevTools link).
    const bounds = await waitFor(() => popupBounds(), "the pop-up window to show");
    if (bounds.width < 100 || bounds.height < 30)
      throw new Error(`pop-up size ${JSON.stringify(bounds)}`);
    // Extension pages get chrome.* functions, never the raw IPC bridge
    // behind them (it would let them act with another extension's ID).
    const bridge = await inPopup("typeof globalThis.electron + '/' + typeof chrome.tabs.query");
    if (bridge !== "undefined/function") throw new Error(`the pop-up sees ${bridge}`);
    // `browser` is the same object as `chrome` (Chromium's own `browser`
    // lacks everything added to `chrome`; NordPass uses `browser`).
    const alias = await inPopup("globalThis.browser === chrome && typeof browser.contextMenus");
    if (alias !== "object") throw new Error(`browser namespace: ${alias}`);
    // chrome.privacy answers instead of never resolving.
    const privacy = await inPopup(
      "chrome.privacy.services.passwordSavingEnabled.get({}).then((r) => r.levelOfControl)",
    );
    if (privacy !== "not_controllable") throw new Error(`privacy: ${privacy}`);
    // WebAuthn in extension pages (NordPass sets up Windows Hello with it):
    // answered by the system's API — or its stand-in here on Linux.
    if (webauthnMock || process.platform === "win32") {
      const create = (rp, name) => `(async () => {
        const text = (b) => new TextDecoder().decode(b);
        const b64 = (u) => btoa(String.fromCharCode(...u)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
        try {
          const challenge = crypto.getRandomValues(new Uint8Array(32));
          const cred = await navigator.credentials.create({ publicKey: {
            rp: { ${rp ? `id: "${rp}", ` : ""}name: "Moon test" },
            user: { id: new Uint8Array([1, 2, 3]), name: "${name}", displayName: "Luna" },
            challenge, pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          } });
          return JSON.stringify({
            real: cred instanceof PublicKeyCredential && cred.response instanceof AuthenticatorAttestationResponse,
            id: cred.id, clientData: text(cred.response.clientDataJSON),
            sent: text(cred.response.attestationObject), challenge: b64(challenge),
          });
        } catch (e) { return "error:" + e.name; }
      })()`;
      // A web domain the extension has no host permission for: refused
      // before anything reaches the system.
      const foreign = await inPopup(create("evil.example", "luna"));
      if (foreign !== "error:SecurityError") throw new Error(`foreign RP ID: ${foreign}`);
      const available = await inPopup(
        "PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()",
      );
      if (typeof available !== "boolean") throw new Error(`isUVPAA gave ${available}`);
      if (webauthnMock) {
        const made = JSON.parse(await inPopup(create(null, "luna")));
        const origin = `chrome-extension://${EXTENSION_ID}`;
        const clientData = JSON.stringify({
          type: "webauthn.create",
          challenge: made.challenge,
          origin,
          crossOrigin: false,
        });
        if (!made.real || made.id !== "AQIDBA" || made.clientData !== clientData)
          throw new Error(`created ${JSON.stringify(made)}`);
        // What Windows got: the extension's origin as RP ID, the same client data.
        if (!made.sent.includes(`;rp=v1:${origin}|Moon test|`) || !made.sent.includes(clientData))
          throw new Error(`sent ${made.sent}`);
        const cancelled = await inPopup(create(null, "!cancel"));
        if (cancelled !== "error:NotAllowedError") throw new Error(`cancelled: ${cancelled}`);
        const got = await inPopup(`navigator.credentials
          .get({ publicKey: { challenge: new Uint8Array(32), allowCredentials: [{ type: "public-key", id: new Uint8Array([1, 2, 3, 4]) }] } })
          .then((c) => [c.response instanceof AuthenticatorAssertionResponse, new TextDecoder().decode(c.response.signature), new Uint8Array(c.response.userHandle).join()].join("|"))`);
        if (
          !got.startsWith(`true|hwnd=`) ||
          !got.includes(`;rp=${origin};`) ||
          !got.endsWith("allow=v1:01020304/public-key/0|85")
        )
          throw new Error(`assertion: ${got}`);
      }
    }
    // The worker's messages reach the open pop-up; one nobody listens for
    // (checked on the extensions page below) is only noise.
    const heard = await inPopup(`new Promise((resolve) => {
      chrome.runtime.onMessage.addListener((m) => { if (m && m.broadcast) resolve(true); });
      chrome.runtime.sendMessage("broadcast").catch(() => null);
      setTimeout(() => resolve(false), 5000);
    })`);
    if (heard !== true) throw new Error("the pop-up didn't hear its service worker");
    await inPopup(`chrome.runtime.sendMessage("unheard").catch(() => null).then(() => true)`);
    // chrome.identity, which Moon Browser adds itself.
    const redirect = await inPopup("chrome.identity.getRedirectURL('done')");
    if (redirect !== `https://${EXTENSION_ID}.chromiumapp.org/done`)
      throw new Error(`identity.getRedirectURL gave ${redirect}`);
    // Extensions can group tabs (chrome.tabs.group, chrome.tabGroups).
    const color = await inPopup(`chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => chrome.tabs.group({ tabIds: [tab.id] }))
      .then((id) => chrome.tabGroups.update(id, { title: "From the extension" }))
      .then((group) => chrome.tabGroups.move(group.id, { index: -1 }))
      .then((group) => group.color)`);
    if (typeof color !== "string") throw new Error(`tabGroups gave ${color}`);
    // Dynamic declarativeNetRequest rules, added and removed at run time.
    const added = await inPopup(`chrome.declarativeNetRequest
      .updateDynamicRules({ addRules: [{ id: 9, action: { type: "block" }, condition: { urlFilter: "/dnr-dynamic" } }] })
      .then(() => chrome.declarativeNetRequest.getDynamicRules())
      .then((rules) => rules.map((r) => r.id).join())`);
    if (added !== "9") throw new Error(`dynamic rules: ${added}`);
    if ((await fetchFromPage(["/dnr-dynamic"]))[0] !== "blocked")
      throw new Error("the dynamic rule didn't block");
    await inPopup("chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [9] })");
    if ((await fetchFromPage(["/dnr-dynamic"]))[0] !== "not blocked")
      throw new Error("the removed rule still blocks");
    await waitFor(
      () =>
        ui
          .locator("[data-group-chip]")
          .textContent()
          .then((t) => t.includes("From the extension")),
      "the extension's group in the tab strip",
    );
    const groupId = Number(await ui.locator("[data-group-chip]").getAttribute("data-group-chip"));
    await ui.evaluate(
      (group) => window.moonUI.command({ type: "groupAction", groupId: group, action: "ungroup" }),
      groupId,
    );
    // A second click on the button closes the pop-up.
    await ui.mouse.click(button.x, button.y);
    await waitFor(() => popupBounds().then((b) => b === null), "the pop-up to close");
  });

  await check("the extensions menu lists the extension and pins it", async () => {
    await ui.getByRole("button", { name: "Extensions", exact: true }).click();
    const menu = ui.getByRole("menu", { name: "Extensions" });
    await waitFor(() => menu.isVisible(), "the extensions menu");
    // The test page is on 127.0.0.1, which the extension may read.
    await waitFor(() => menu.getByText("Full access").isVisible(), "the Full access group");
    await new Promise((r) => setTimeout(r, 500));
    await shot("04-extensions-menu");
    await menu.getByRole("button", { name: "Unpin Moon Test Extension" }).click();
    await waitFor(
      async () =>
        (await ui.getByRole("button", { name: "Moon test extension", exact: true }).count()) === 0,
      "the button to leave the toolbar",
    );
    await menu.getByRole("button", { name: "Pin Moon Test Extension" }).click();
    await ui.keyboard.press("Escape");
    await extensionButton();
  });

  await check("an extension can open its side panel", async () => {
    const button = await extensionButton();
    await ui.mouse.click(button.x, button.y);
    await waitFor(() => inPopup("!!chrome.sidePanel"), "the pop-up again");
    await inPopup("chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("/popup.html"))
        ?.destroy(),
    );
    // Now the button opens the side panel instead of the pop-up.
    await ui.mouse.click(button.x, button.y);
    await waitFor(
      () =>
        app.evaluate(({ webContents }) =>
          webContents.getAllWebContents().some((w) => w.getURL().endsWith("/panel.html")),
        ),
      "the side panel page",
    );
    await waitFor(
      () => ui.getByRole("button", { name: "Close side panel" }).isVisible(),
      "the side panel's title bar",
    );
    await new Promise((r) => setTimeout(r, 600));
    await shot("05-side-panel");
    await ui.getByRole("button", { name: "Close side panel" }).click();
    await waitFor(
      () =>
        app.evaluate(({ webContents }) =>
          webContents.getAllWebContents().every((w) => !w.getURL().endsWith("/panel.html")),
        ),
      "the side panel to close",
    );
  });

  await check("tracking parameters are removed before a page loads", async () => {
    const box = ui.getByRole("combobox", { name: "Address and search bar" });
    await box.click();
    await box.fill(`${base}/second?id=7&utm_source=newsletter&fbclid=abc`);
    await box.press("Enter");
    await waitFor(
      async () => (await tabs()).some((t) => t.url === `${base}/second?id=7`),
      "the cleaned address",
    );
    await app.evaluate(({ webContents }, url) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === url);
      wc.navigationHistory.goBack();
    }, `${base}/second?id=7`);
    await waitFor(
      async () => (await tabs()).some((t) => t.title === "Moon test page"),
      "back on the test page",
    );
  });

  await check("the tab strip shows the page title", async () => {
    await waitFor(
      async () =>
        (await ui.locator('[role="tab"][aria-selected="true"]').getAttribute("title")) ===
        "Moon test page",
      "tab title",
    );
  });

  await check("web pages get no internal API", async () => {
    const hasApi = await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getTitle() === "Moon test page");
      return wc.executeJavaScript(
        "typeof window.moon + typeof window.moonUI + typeof require + typeof process",
      );
    });
    if (hasApi !== "undefinedundefinedundefinedundefined") throw new Error(`page sees: ${hasApi}`);
  });

  await check("web pages cannot navigate to moon:// pages", async () => {
    await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getTitle() === "Moon test page");
      return wc.executeJavaScript("document.getElementById('internal').click()");
    });
    await new Promise((r) => setTimeout(r, 800));
    const list = await tabs();
    if (list.some((t) => t.url.startsWith("moon://settings")))
      throw new Error("navigation to moon://settings was allowed");
  });

  await check("links with target=_blank open in a new tab", async () => {
    const before = (await tabs()).length;
    await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getTitle() === "Moon test page");
      wc.focus();
      return wc.executeJavaScript("document.getElementById('blank').click()", true);
    });
    await waitFor(async () => (await tabs()).length === before + 1, "a second tab");
    await waitFor(
      async () => (await tabs()).some((t) => t.title === "Second page"),
      "the second page",
    );
  });

  await check("tabs can be grouped, named, collapsed and ungrouped", async () => {
    const tabId = (title) =>
      ui.locator(`[role="tab"][title="${title}"]`).getAttribute("data-tab-id").then(Number);
    const first = await tabId("Moon test page");
    const second = await tabId("Second page");
    await ui.evaluate((id) => window.moonUI.command({ type: "groupTab", tabId: id }), first);
    const chip = ui.locator("[data-group-chip]");
    await waitFor(() => chip.count().then((n) => n === 1), "the group's label");
    const groupId = Number(await chip.getAttribute("data-group-chip"));
    await ui.evaluate(
      ([id, group]) => window.moonUI.command({ type: "groupTab", tabId: id, groupId: group }),
      [second, groupId],
    );
    await ui.evaluate(
      (group) => window.moonUI.command({ type: "groupUpdate", groupId: group, title: "Moon work" }),
      groupId,
    );
    await waitFor(() => chip.textContent().then((t) => t.includes("Moon work")), "the group name");
    await new Promise((r) => setTimeout(r, 400));
    await shot("03-tab-group");
    // Collapsing hides the group's tabs and shows a tab outside it (a new
    // one when every tab is in the group, like Chrome).
    const shown = (title) => ui.locator(`[role="tab"][title="${title}"]`).count();
    await chip.click();
    await waitFor(
      async () => (await shown("Moon test page")) === 0 && (await shown("Second page")) === 0,
      "the group's tabs to hide",
    );
    const active = await ui.locator('[role="tab"][aria-selected="true"]').getAttribute("title");
    if (active === "Moon test page" || active === "Second page")
      throw new Error(`the active tab ${active} is hidden in the collapsed group`);
    await chip.click();
    await waitFor(
      async () => (await shown("Moon test page")) === 1 && (await shown("Second page")) === 1,
      "the group to open again",
    );
    await ui.evaluate(
      (group) => window.moonUI.command({ type: "groupAction", groupId: group, action: "ungroup" }),
      groupId,
    );
    await waitFor(() => chip.count().then((n) => n === 0), "the group to go");
  });

  /** The titles of the tabs in the tab strip, left to right. */
  const stripOrder = () =>
    ui.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  /** Drags with the mouse, in small steps, like a hand does. */
  const dragBy = async (locator, toX, toY) => {
    const box = await locator.boundingBox();
    await ui.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await ui.mouse.down();
    await ui.mouse.move(toX, toY, { steps: 15 });
    await ui.mouse.up();
  };

  /** The IDs of the tabs in the tab strip, left to right. */
  const stripIds = () =>
    ui.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-tab-id")));

  await check("a tab can be dragged to another place", async () => {
    await ui.evaluate(() => window.moonUI.command({ type: "newTab" }));
    await waitFor(async () => (await stripIds()).length >= 3, "three tabs");
    const before = await stripIds();
    const all = ui.locator('[role="tab"]');
    const first = await all.first().boundingBox();
    await dragBy(all.last(), first.x + 4, first.y + first.height / 2);
    const expected = [before.at(-1), ...before.slice(0, -1)].join("|");
    await waitFor(
      async () => (await stripIds()).join("|") === expected,
      "the last tab in front",
    ).catch(async (err) => {
      throw new Error(`${err.message}: ${before.join("|")} → ${(await stripIds()).join("|")}`);
    });
  });

  await check("a whole tab group can be dragged", async () => {
    const order = await stripIds();
    const [a, b] = [Number(order[0]), Number(order[1])];
    await ui.evaluate((id) => window.moonUI.command({ type: "groupTab", tabId: id }), a);
    const chip = ui.locator("[data-group-chip]");
    await waitFor(() => chip.count().then((n) => n === 1), "the group's label");
    const groupId = Number(await chip.getAttribute("data-group-chip"));
    await ui.evaluate(
      ([id, group]) => window.moonUI.command({ type: "groupTab", tabId: id, groupId: group }),
      [b, groupId],
    );
    await ui.evaluate(
      (group) => window.moonUI.command({ type: "groupUpdate", groupId: group, title: "Moon trip" }),
      groupId,
    );
    await waitFor(() => chip.textContent().then((t) => t.includes("Moon trip")), "the name");
    // By its label, behind the last tab: both tabs go along, in order.
    const last = await ui.locator('[role="tab"]').last().boundingBox();
    await dragBy(chip, last.x + last.width - 4, last.y + last.height / 2);
    const expected = [...order.slice(2), order[0], order[1]].join("|");
    await waitFor(async () => (await stripIds()).join("|") === expected, "the group at the end");
    if ((await chip.getAttribute("aria-expanded")) !== "true")
      throw new Error("dragging the label also collapsed the group");
    await ui.evaluate(
      (group) => window.moonUI.command({ type: "groupAction", groupId: group, action: "ungroup" }),
      groupId,
    );
    await waitFor(() => chip.count().then((n) => n === 0), "the group to go");
  });

  await check("pages can't put a count on the taskbar icon", async () => {
    const quiet = await app.evaluate(async ({ webContents }) => {
      const tab = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("http://127.0.0.1"));
      return tab.executeJavaScript(
        "navigator.setAppBadge(120).then(() => !Function.prototype.toString.call(navigator.setAppBadge).includes('setAppBadge'))",
      );
    });
    if (quiet !== true) throw new Error("navigator.setAppBadge still reaches the app");
  });

  await check("Ctrl+T opens a new tab and Ctrl+W closes it", async () => {
    const before = await ui.locator('[role="tab"]').count();
    await press("T", ["control"]);
    await waitFor(
      async () => (await ui.locator('[role="tab"]').count()) === before + 1,
      "one more tab",
    );
    await press("W", ["control"]);
    await waitFor(
      async () => (await ui.locator('[role="tab"]').count()) === before,
      "the tab closed",
    );
  });

  await check("a bang opens its site in a new tab", async () => {
    // Record where new tabs start navigating: the bang's own address, before
    // the site gets to redirect it (Wikipedia jumps straight to an article).
    const url = await app.evaluate(async ({ app: electronApp, webContents }) => {
      const started = [];
      const onCreated = (_event, contents) =>
        contents.on("did-start-navigation", (details) => {
          if (details.isMainFrame) started.push(details.url);
        });
      electronApp.on("web-contents-created", onCreated);
      try {
        const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("moon://ui"));
        await wc.executeJavaScript(
          "window.moonUI.command({ type: 'navigate', input: 'full moon !w', disposition: 'background' })",
        );
        for (let i = 0; i < 60 && !started.some((u) => u.includes("wikipedia")); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } finally {
        electronApp.off("web-contents-created", onCreated);
      }
      return started.find((u) => u.includes("wikipedia"));
    });
    if (url !== "https://en.wikipedia.org/w/index.php?search=full+moon") {
      throw new Error(`the Wikipedia tab started at ${url}`);
    }
  });

  await check("settings open and save through the internal API", async () => {
    await press(",", ["control"]);
    await waitFor(
      async () => (await tabs()).some((t) => t.url.startsWith("moon://settings")),
      "moon://settings",
    );
    const result = await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("moon://settings"));
      await new Promise((r) => setTimeout(r, 500));
      return wc.executeJavaScript(
        "window.moon.invoke('settings.set', { showHomeButton: true }).then(s => s.showHomeButton)",
      );
    });
    if (result !== true) throw new Error(`settings.set returned ${result}`);
    await waitFor(() => ui.getByRole("button", { name: "Home" }).isVisible(), "the home button");
  });
  await new Promise((r) => setTimeout(r, 600));
  await shot("06-settings");

  await check("internal pages may only use their own methods", async () => {
    const err = await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("moon://settings"));
      return wc.executeJavaScript(
        "window.moon.invoke('history.remove', ['x']).then(() => 'allowed', e => 'refused')",
      );
    });
    if (err !== "refused") throw new Error(`settings page could call history.remove (${err})`);
  });

  await check("history recorded the visit", async () => {
    const found = await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("moon://settings"));
      await wc.loadURL("moon://history/");
      await new Promise((r) => setTimeout(r, 500));
      return wc.executeJavaScript(
        "window.moon.invoke('history.query', { text: 'Moon test' }).then(list => list.length)",
      );
    });
    if (!found) throw new Error("the test page is not in the history");
  });
  await shot("07-history");

  await check("bookmarks and history import from Comet", async () => {
    const result = await app.evaluate(async ({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("moon://history"));
      await wc.loadURL("moon://settings/#import");
      await new Promise((r) => setTimeout(r, 500));
      return wc.executeJavaScript(`(async () => {
        const found = await window.moon.invoke("import.detect");
        const comet = found.find((p) => p.browser === "Comet");
        if (!comet) return { error: "Comet not detected: " + JSON.stringify(found) };
        return window.moon.invoke("import.run", comet.path, { bookmarks: true, history: true });
      })()`);
    });
    if (result.error || result.bookmarks !== 1 || result.history !== 1)
      throw new Error(JSON.stringify(result));
    const bookmarked = await app.evaluate(({ webContents }) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("moon://settings"));
      return wc.executeJavaScript("window.moon.invoke('settings.get').then(() => true)");
    });
    if (!bookmarked) throw new Error("settings page gone");
  });
  await new Promise((r) => setTimeout(r, 400));
  await shot("08-import");

  await check("the extensions page lists, switches off and on", async () => {
    const result = await app.evaluate(async ({ webContents, session }, id) => {
      const wc = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("moon://settings"));
      await wc.loadURL("moon://extensions/");
      await new Promise((r) => setTimeout(r, 500));
      const list = await wc.executeJavaScript("window.moon.invoke('extensions.list')");
      await wc.executeJavaScript(`window.moon.invoke('extensions.setEnabled', '${id}', false)`);
      const off = !session.defaultSession.extensions.getExtension(id);
      await wc.executeJavaScript(`window.moon.invoke('extensions.setEnabled', '${id}', true)`);
      const on = !!session.defaultSession.extensions.getExtension(id);
      return { names: list.map((e) => e.name), errors: list[0]?.errors ?? [], off, on };
    }, EXTENSION_ID);
    if (result.names.join() !== "Moon Test Extension" || !result.off || !result.on)
      throw new Error(JSON.stringify(result));
    // The service worker's console.error is listed, like Chrome's "Errors".
    if (!result.errors.some((e) => e.includes("moon-test: an error")))
      throw new Error(`errors: ${JSON.stringify(result.errors)}`);
    // Starting the worker while it is still being registered isn't an error,
    // the chrome.* API preloads load (with --no-sandbox too), and a message
    // nobody listened for isn't listed outside developer mode.
    if (
      result.errors.some(
        (e) =>
          e.includes("service worker didn't start") ||
          e.includes("Unable to load preload") ||
          e.includes("Receiving end does not exist"),
      )
    )
      throw new Error(`errors: ${JSON.stringify(result.errors)}`);
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot("09-extensions");

  /** Calls a method of moon://extensions, which the settings tab shows now. */
  const extensionsPage = (method, ...args) =>
    app.evaluate(
      ({ webContents }, [name, params]) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith("moon://extensions"))
          .executeJavaScript(
            `window.moon.invoke(${JSON.stringify([name, ...params]).slice(1, -1)})`,
          ),
      [method, args],
    );
  const loadedIds = () =>
    app.evaluate(({ session }) =>
      session.defaultSession.extensions.getAllExtensions().map((e) => e.id),
    );

  await check("developer mode loads, reloads and removes an unpacked extension", async () => {
    const folder = join(profile, "my-extension");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name: "My Own Extension", version: "0.1" }),
    );
    // Only in developer mode.
    if ((await extensionsPage("extensions.loadUnpacked")) !== null) throw new Error("loaded");
    await extensionsPage("extensions.setDeveloperMode", true);
    // The folder picker and the confirmation, answered.
    await app.evaluate(({ dialog }, dir) => {
      globalThis.__dialogs = [dialog.showOpenDialog, dialog.showMessageBox];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    }, folder);
    const error = await extensionsPage("extensions.loadUnpacked");
    await app.evaluate(({ dialog }) => {
      [dialog.showOpenDialog, dialog.showMessageBox] = globalThis.__dialogs;
    });
    if (error !== null) throw new Error(error);
    const mine = (await extensionsPage("extensions.list")).find((e) => e.unpacked);
    if (mine?.name !== "My Own Extension" || mine.path !== folder || !mine.enabled)
      throw new Error(JSON.stringify(mine));
    if (!(await loadedIds()).includes(mine.id)) throw new Error("not loaded");
    await extensionsPage("extensions.reload", mine.id);
    if (!(await loadedIds()).includes(mine.id)) throw new Error("not loaded after reload");
    // Developer mode off: it stops; on again: it's back.
    await extensionsPage("extensions.setDeveloperMode", false);
    if ((await loadedIds()).includes(mine.id)) throw new Error("runs without developer mode");
    await extensionsPage("extensions.setDeveloperMode", true);
    if (!(await loadedIds()).includes(mine.id)) throw new Error("not back");
    await extensionsPage("extensions.remove", mine.id);
    if ((await loadedIds()).includes(mine.id)) throw new Error("still loaded");
    await access(join(folder, "manifest.json")); // the folder stays
    await extensionsPage("extensions.setDeveloperMode", false);
  });

  await check("a damaged extension is found and offered a repair", async () => {
    // A Web Store package whose service worker got cut off on disk.
    const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
      type: "spki",
      format: "der",
    });
    const id = [...createHash("sha256").update(key).digest("hex").slice(0, 32)]
      .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
      .join("");
    const dir = join(profile, "Extensions", id, "1.0.0_0");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Damaged Extension",
        version: "1.0.0",
        key: key.toString("base64"),
        background: { service_worker: "background.js" },
      }),
    );
    await writeFile(join(dir, "background.js"), "chrome.runtime.onInstalled.addListener(() => {\n");
    await extensionsPage("extensions.setEnabled", id, true);
    const damaged = await waitFor(
      async () => (await extensionsPage("extensions.list")).find((e) => e.id === id && e.damaged),
      "the extension to be found damaged",
      40_000,
    );
    if (!damaged.errors.some((e) => e.includes("files are damaged")))
      throw new Error(JSON.stringify(damaged.errors));
    await extensionsPage("extensions.remove", id);
  });

  await check("the menu opens above the page", async () => {
    await ui.getByRole("button", { name: "Menu" }).click();
    await waitFor(
      () => ui.getByRole("menu", { name: "Moon Browser menu" }).isVisible(),
      "the menu",
    );
    await new Promise((r) => setTimeout(r, 500));
    await shot("10-menu");
    await ui.keyboard.press("Escape");
  });

  await check("split view shows two pages side by side", async () => {
    await ui.getByRole("button", { name: "Split view" }).click();
    await waitFor(
      async () => (await ui.getByRole("button", { name: "Close split view" }).count()) > 0,
      "split view",
    );
    await new Promise((r) => setTimeout(r, 800));
    await shot("11-split");
    await ui.getByRole("button", { name: "Close split view" }).first().click();
  });

  await check("the window survives for a while without crashing", async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const alive = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    if (alive < 1) throw new Error("no window left");
  });

  await check("tabs and tab groups come back after a restart", async () => {
    // Two pages of the test server in a named group, and nothing else.
    const others = await stripIds();
    for (const path of ["/", "/second"])
      await ui.evaluate(
        (url) => window.moonUI.command({ type: "navigate", input: url, disposition: "background" }),
        `${base}${path}`,
      );
    await waitFor(async () => (await stripIds()).length === others.length + 2, "two more tabs");
    const kept = (await stripIds()).filter((id) => !others.includes(id)).map(Number);
    await ui.evaluate((id) => window.moonUI.command({ type: "groupTab", tabId: id }), kept[0]);
    const chip = ui.locator("[data-group-chip]");
    await waitFor(() => chip.count().then((n) => n === 1), "the group's label");
    const groupId = Number(await chip.getAttribute("data-group-chip"));
    await ui.evaluate(
      ([id, group]) => window.moonUI.command({ type: "groupTab", tabId: id, groupId: group }),
      [kept[1], groupId],
    );
    await ui.evaluate(
      (group) => window.moonUI.command({ type: "groupUpdate", groupId: group, title: "Kept" }),
      groupId,
    );
    for (const id of others)
      await ui.evaluate((tabId) => window.moonUI.command({ type: "close", tabId }), Number(id));
    await waitFor(
      async () =>
        [...(await stripOrder())].sort().join("|") === "Moon test page|Second page" &&
        (await chip.textContent()).includes("Kept"),
      "just the group's two pages",
    ).catch(async (err) => {
      throw new Error(
        `${err.message}: ${(await stripOrder()).join("|")}, groups: ${await ui.locator("[data-group-chip]").allTextContents()}`,
      );
    });
    const want = (await stripOrder()).join("|");
    await new Promise((r) => setTimeout(r, 2000));
    await app.close();

    const again = await electron.launch({
      executablePath: require("electron"),
      args,
      env: {
        ...process.env,
        MOON_BROWSER_PROFILE: profile,
        ...(process.platform === "win32" ? { LOCALAPPDATA: config } : { XDG_CONFIG_HOME: config }),
      },
    });
    try {
      const ui2 = await waitFor(
        () => again.windows().find((p) => p.url().startsWith("moon://ui")),
        "the UI after the restart",
      );
      // Restored tabs sleep until they're first shown.
      const shown = () =>
        ui2
          .locator('[role="tab"]')
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute("title").replace(/ \(asleep\)$/, "")),
          );
      await waitFor(async () => (await shown()).join("|") === want, "the two pages again").catch(
        async (err) => {
          throw new Error(`${err.message}; shown: ${(await shown()).join(", ")}`);
        },
      );
      const chip2 = ui2.locator("[data-group-chip]");
      await waitFor(() => chip2.textContent().then((t) => t.includes("Kept")), "the group again");
      if ((await chip2.getAttribute("aria-label"))?.includes("2 tabs") !== true)
        throw new Error(`the group has ${await chip2.getAttribute("aria-label")}`);
    } finally {
      await again.close().catch(() => undefined);
    }
  });
} finally {
  await app.close().catch(() => undefined);
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  await rm(config, { recursive: true, force: true }).catch(() => undefined);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
