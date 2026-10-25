/**
 * Perplexity in Luma's night-sky look: Perplexity builds its colours
 * from two palettes of custom properties (odin: greys, shiva: the teal
 * accent), so swapping those for Moon's night and lavender recolours the
 * whole site without touching its layout. In dark mode, its base surfaces
 * become slightly translucent over a starry sky.
 */

import { SKY, SKY_SIZE } from "../moon-sky";

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

/*
 * The answer Axo says (axo.ts marks it): a soft lavender speech bubble
 * around it, its tail drawn by Axo. Outline and shadows only, so the page's
 * layout stays as it is; "off" fades it out when Axo moves on.
 */
[data-moon-axo] {
  border-radius: 14px !important;
  outline: 1px solid transparent !important;
  outline-offset: 10px !important;
  transition: outline-color 0.4s, box-shadow 0.4s, background-color 0.4s !important;
}
[data-moon-axo="left"],
[data-moon-axo="right"] {
  outline-color: rgb(185 174 251 / 0.42) !important;
  /* One tint inside and around it (the shadow is the bubble's padding),
     fading out into a halo past the outline. */
  background-color: rgb(185 174 251 / 0.05) !important;
  box-shadow: 0 0 28px 36px rgb(185 174 251 / 0.05) !important;
}
[data-moon-axo][data-moon-axo-talking] {
  outline-color: rgb(185 174 251 / 0.75) !important;
  background-color: rgb(185 174 251 / 0.065) !important;
  box-shadow: 0 0 34px 40px rgb(185 174 251 / 0.065) !important;
}
@media (prefers-reduced-motion: reduce) {
  [data-moon-axo] { transition: none !important; }
}
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
