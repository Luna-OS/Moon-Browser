/**
 * Perplexity in Moon Browser's night-sky look: Perplexity builds its colours
 * from two palettes of custom properties (odin: greys, shiva: the teal
 * accent), so swapping those for Moon's night and lavender recolours the
 * whole site without touching its layout. In dark mode, its base surfaces
 * become slightly translucent over a starry sky.
 */

/** Moon's night palette in place of Perplexity's dark greys and teal. */
const DARK = `
  --odin-dark-50: #0b0920 !important;
  --odin-dark-100: #110d29 !important;
  --odin-dark-200: #141030 !important;
  --odin-dark-300: #191438 !important;
  --odin-dark-400: #1d1742 !important;
  --odin-dark-500: #251d52 !important;
  --odin-dark-600: #2c2460 !important;
  --odin-dark-700: #352c6e !important;
  --odin-dark-1000: #f4f1ff !important;
  --shiva-dark-50: #f4f1ff !important;
  --shiva-dark-100: #e9e4fe !important;
  --shiva-dark-200: #d6cffd !important;
  --shiva-dark-300: #c7befc !important;
  --shiva-dark-400: #b9aefb !important;
  --shiva-dark-500: #9d8ff5 !important;
  --shiva-dark-600: #7f6fe0 !important;
  --shiva-dark-700: #5b4bc4 !important;
  --shiva-dark-800: #3a2f86 !important;
  --shiva-dark-900: #211a4f !important;
  --shiva-dark-1000: #0b0920 !important;
`;

/** In daylight: Moon's lavender accent and a faint lavender paper. */
const LIGHT = `
  --odin-light-100: #f7f4fd !important;
  --odin-light-300: #ece7f7 !important;
  --shiva-light-600: #5b4bc4 !important;
`;

const SKY = `
  radial-gradient(1.5px 1.5px at 23px 41px, rgb(255 255 255 / 0.8), transparent),
  radial-gradient(1.5px 1.5px at 142px 88px, rgb(255 255 255 / 0.6), transparent),
  radial-gradient(1.5px 1.5px at 251px 17px, rgb(214 207 253 / 0.9), transparent),
  radial-gradient(1.5px 1.5px at 67px 196px, rgb(255 255 255 / 0.55), transparent),
  radial-gradient(1.5px 1.5px at 199px 243px, rgb(255 255 255 / 0.7), transparent),
  radial-gradient(1.5px 1.5px at 297px 158px, rgb(154 215 245 / 0.7), transparent),
  radial-gradient(1.5px 1.5px at 111px 281px, rgb(255 255 255 / 0.5), transparent),
  radial-gradient(1.5px 1.5px at 309px 300px, rgb(214 207 253 / 0.6), transparent),
  radial-gradient(2px 2px at 60px 90px, rgb(255 255 255 / 0.95), transparent),
  radial-gradient(2.5px 2.5px at 380px 210px, rgb(214 207 253 / 0.95), transparent),
  radial-gradient(2px 2px at 250px 460px, rgb(255 255 255 / 0.9), transparent),
  radial-gradient(2.5px 2.5px at 470px 40px, rgb(255 255 255 / 0.95), transparent),
  radial-gradient(ellipse 80% 55% at 85% -5%, rgb(185 174 251 / 0.16), transparent 60%),
  radial-gradient(ellipse 70% 60% at 0% 0%, rgb(59 46 107 / 0.55), transparent 65%),
  radial-gradient(ellipse 90% 50% at 50% 115%, rgb(154 215 245 / 0.08), transparent 60%),
  linear-gradient(180deg, #141030 0%, #0b0920 70%)
`;
const SKY_SIZE =
  "320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 320px 320px, 540px 540px, 540px 540px, 540px 540px, 540px 540px, auto, auto, auto, auto";

/** Is Perplexity dark: chosen in its settings, or following the system. */
const DARK_SCOPE = [
  "html:root[data-color-scheme=dark]",
  "html:root:not([data-color-scheme=light]):not([data-color-scheme=dark])",
];

export const PERPLEXITY_CSS = `
html:root:root { ${DARK} ${LIGHT} }

@media (prefers-color-scheme: dark) {
  ${DARK_SCOPE[1]} { color-scheme: dark; }
}

/* The starry sky behind the page, seen through its base surfaces. */
${DARK_SCOPE[0]}:not(.moon-x),
${DARK_SCOPE[0]} body {
  background: ${SKY} !important;
  background-size: ${SKY_SIZE} !important;
  background-attachment: fixed !important;
}
${DARK_SCOPE[0]} {
  --bg-base: rgb(17 13 41 / 0.62) !important;
  --surface-base: rgb(17 13 41 / 0.62) !important;
  --bg-underlay: rgb(11 9 32 / 0.55) !important;
  --surface-underlay: rgb(11 9 32 / 0.55) !important;
}
@media (prefers-color-scheme: dark) {
  ${DARK_SCOPE[1]}:not(.moon-x),
  ${DARK_SCOPE[1]} body {
    background: ${SKY} !important;
    background-size: ${SKY_SIZE} !important;
    background-attachment: fixed !important;
  }
  ${DARK_SCOPE[1]} {
    --bg-base: rgb(17 13 41 / 0.62) !important;
    --surface-base: rgb(17 13 41 / 0.62) !important;
    --bg-underlay: rgb(11 9 32 / 0.55) !important;
    --surface-underlay: rgb(11 9 32 / 0.55) !important;
  }
}

::selection { background: rgb(185 174 251 / 0.35); }
`;

/** The sites that get the look (and Axo). */
export function isPerplexity(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" && (hostname === "perplexity.ai" || hostname === "www.perplexity.ai")
    );
  } catch {
    return false;
  }
}
