// Renders the Windows installer images (build/installer/*.svg) to the 24-bit
// BMP files NSIS needs: the 100 % images electron-builder hands to MUI, and
// the 125–250 % versions theme.nsh swaps in on high-DPI screens.
//
// Usage: node scripts/render-installer-art.mjs  (needs a Chromium and the
// "URW Gothic" font; set CHROMIUM_PATH or have Playwright's browsers)
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "build", "installer");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();

/** A bottom-up, 24-bit uncompressed Windows bitmap. */
function bmp(width, height, rgba) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * height);
  out.write("BM", 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * height, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const target = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[target + x * 3] = rgba[i + 2];
      out[target + x * 3 + 1] = rgba[i + 1];
      out[target + x * 3 + 2] = rgba[i];
    }
  }
  return out;
}

async function render(name, width, height, scale) {
  const svg = await readFile(resolve(dir, `${name}.svg`), "utf8");
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<html><body style="margin:0">${svg.replace(/<svg [^>]*>/, (tag) => tag.replace(/width="[^"]*"/, `width="${w}"`).replace(/height="[^"]*"/, `height="${h}"`))}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  // Decode the screenshot in the page itself and hand back raw pixels.
  const pixels = await page.evaluate(
    async ({ data, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    { data: png.toString("base64"), w, h },
  );
  const file = scale === 1 ? `${name}.bmp` : `hidpi/${name}-${Math.round(scale * 100)}.bmp`;
  await writeFile(resolve(dir, file), bmp(w, h, pixels));
  console.log(`${file}  ${w}×${h}`);
}

for (const [name, width, height] of [
  ["sidebar", 164, 314],
  ["header", 150, 57],
]) {
  for (const scale of [1, 1.25, 1.5, 2, 2.5]) await render(name, width, height, scale);
}
await browser.close();
