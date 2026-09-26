// End-to-end smoke test: starts the built Moon Browser (npm run build first)
// with a fresh profile, drives it like a user and checks the results in the
// main process. Needs a display (xvfb-run on Linux CI).
//
//   node scripts/e2e.mjs [--screenshots dir]
import { _electron as electron } from "playwright-core";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

const args = [root];
if (process.platform === "linux") args.push("--no-sandbox");
const app = await electron.launch({
  executablePath: require("electron"),
  args,
  env: {
    ...process.env,
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

  await check("the extension's toolbar button opens its pop-up", async () => {
    const button = await waitFor(
      () =>
        ui.evaluate(() => {
          const action = document
            .querySelector("browser-action-list")
            ?.shadowRoot?.querySelector(".action");
          if (!action) return null;
          const r = action.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      "the extension button",
    );
    await ui.mouse.click(button.x, button.y);
    // The pop-up asks chrome.tabs which tab is active and shows its title.
    await waitFor(
      () =>
        app
          .evaluate(({ webContents }) => {
            const popup = webContents
              .getAllWebContents()
              .find((w) => w.getURL().endsWith("/popup.html"));
            return popup?.executeJavaScript("document.getElementById('tab').textContent");
          })
          .then((title) => title === "Moon test page"),
      "the pop-up to name the active tab",
    );
    // Extension pages get chrome.* functions, never the raw IPC bridge
    // behind them (it would let them act with another extension's ID).
    const bridge = await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getURL().endsWith("/popup.html"))
        .executeJavaScript("typeof globalThis.electron + '/' + typeof chrome.tabs.query"),
    );
    if (bridge !== "undefined/function") throw new Error(`the pop-up sees ${bridge}`);
    await ui.mouse.click(button.x, button.y);
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
  await shot("03-settings");

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
  await shot("04-history");

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
  await shot("05-import");

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
      return { names: list.map((e) => e.name), off, on };
    }, EXTENSION_ID);
    if (result.names.join() !== "Moon Test Extension" || !result.off || !result.on)
      throw new Error(JSON.stringify(result));
  });
  await new Promise((r) => setTimeout(r, 500));
  await shot("06-extensions");

  await check("the menu opens above the page", async () => {
    await ui.getByRole("button", { name: "Menu" }).click();
    await waitFor(
      () => ui.getByRole("menu", { name: "Moon Browser menu" }).isVisible(),
      "the menu",
    );
    await new Promise((r) => setTimeout(r, 500));
    await shot("07-menu");
    await ui.keyboard.press("Escape");
  });

  await check("split view shows two pages side by side", async () => {
    await ui.getByRole("button", { name: "Split view" }).click();
    await waitFor(
      async () => (await ui.getByRole("button", { name: "Close split view" }).count()) > 0,
      "split view",
    );
    await new Promise((r) => setTimeout(r, 800));
    await shot("08-split");
    await ui.getByRole("button", { name: "Close split view" }).first().click();
  });

  await check("the window survives for a while without crashing", async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const alive = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    if (alive < 1) throw new Error("no window left");
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
