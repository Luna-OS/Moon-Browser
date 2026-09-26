// Renders the app icon (src/renderer/public/moon.svg) to the PNG sizes the
// installers need: build/icon.png (Windows .ico is made from it by
// electron-builder) and build/icons/<size>x<size>.png for Linux.
//
// Usage: node scripts/render-icons.mjs   (needs a Chromium; set CHROMIUM_PATH
// or have Playwright's browsers installed)
import { chromium } from "playwright-core";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(resolve(root, "src/renderer/public/moon.svg"), "utf8");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
await mkdir(resolve(root, "build/icons"), { recursive: true });

async function render(size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({
    path: file,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}

for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await render(size, resolve(root, `build/icons/${size}x${size}.png`));
}
await render(1024, resolve(root, "build/icon.png"));
await browser.close();
console.log("icons written to build/");
