/**
 * YouTube in Moon Browser's night-sky look. The player wears it always (it
 * is dark in both of YouTube's themes): the played part of the progress bar
 * is a softly glowing lavender trail that ends in a small full moon, and the
 * volume slider fills with lavender up to a four-pointed sparkle. The logo
 * becomes MoonTube's: a crescent moon in a lavender play button. In dark
 * mode, the site itself takes Moon's night palette, with stars in its top bar.
 *
 * YouTube names its colours twice: as `--yt-sys-color-baseline--*` custom
 * properties, and as hashed tokens (`--t…`) that most of its CSS reads. Both
 * are swapped here; the hashed names are those of YouTube's build at the time
 * of writing, and a later build that renames them merely loses part of the
 * palette, never the layout. The video picture itself is left alone.
 */

/** An SVG as a CSS url(). */
const svg = (markup: string) => `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;

/** The four-pointed sparkle that replaces the volume slider's round handle. */
const SPARKLE = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/>` +
    `<stop offset="0.55" stop-color="#fbfaff"/><stop offset="1" stop-color="#e9e4fe"/></radialGradient></defs>` +
    `<path fill="url(#g)" d="M12 0.5C12.9 8 16 11.1 23.5 12C16 12.9 12.9 16 12 23.5C11.1 16 8 12.9 0.5 12C8 11.1 11.1 8 12 0.5Z"/>` +
    `</svg>`,
);

/**
 * MoonTube's emblem: a lavender play button with a crescent moon in it and
 * a sparkle beside the moon.
 */
const EMBLEM = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 21">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#a497f7"/><stop offset="1" stop-color="#6a5ad6"/></linearGradient>` +
    `<mask id="m"><rect width="30" height="21" fill="#fff"/><circle cx="16.6" cy="8.6" r="5.6" fill="#000"/></mask></defs>` +
    `<rect width="30" height="21" rx="6" fill="url(#b)"/>` +
    `<circle cx="13.6" cy="10.5" r="6" fill="#fff" mask="url(#m)"/>` +
    `<path fill="#fff" d="M21.5 4.2C21.8 6.2 22.6 7 24.6 7.3C22.6 7.6 21.8 8.4 21.5 10.4C21.2 8.4 20.4 7.6 18.4 7.3C20.4 7 21.2 6.2 21.5 4.2Z"/>` +
    `</svg>`,
);

/** The lavender of the played part, darkest where it starts. */
const TRAIL = "linear-gradient(90deg, #7f6fe0 0%, #9d8ff5 45%, #b9aefb 80%, #d6cffd 100%)";

/**
 * The moon: a grey-silver disc lit from the upper left, with a few faint
 * craters, inside a white halo that fades into lavender.
 */
const MOON_FACE = `
  radial-gradient(circle at 63% 36%, rgb(122 118 146 / 0.55) 0 10%, transparent 15%),
  radial-gradient(circle at 38% 64%, rgb(122 118 146 / 0.45) 0 12%, transparent 17%),
  radial-gradient(circle at 70% 70%, rgb(122 118 146 / 0.35) 0 7%, transparent 11%),
  radial-gradient(circle at 34% 30%, #f7f6fb 0%, #dcdae6 38%, #b4b1c4 78%, #9895ab 100%)
`;
const MOON_GLOW = `
  0 0 0 1px rgb(255 255 255 / 0.9),
  0 0 4px 1px rgb(255 255 255 / 0.75),
  0 0 10px 3px rgb(214 207 253 / 0.5)
`;

/** Everything in the player but its ads, which keep YouTube's yellow. */
const PLAYER = ".html5-video-player:not(.ad-interrupting)";

const PLAYER_CSS = `
/* The track, what is loaded, and the played trail. */
${PLAYER} .ytp-progress-list {
  background: rgb(200 190 255 / 0.2) !important;
}
${PLAYER} .ytp-load-progress {
  background: rgb(214 207 253 / 0.38) !important;
}
${PLAYER} .ytp-play-progress,
${PLAYER} .ytp-play-progress.ytp-swatch-background-color {
  background: ${TRAIL} !important;
  box-shadow: 0 0 6px rgb(185 174 251 / 0.65);
}
${PLAYER} .ytp-swatch-background-color {
  background-color: #9d8ff5 !important;
}
${PLAYER} .ytp-swatch-color {
  color: #b9aefb !important;
}

/* The scrubber is a small glowing full moon; YouTube still scales it on hover. */
${PLAYER} .ytp-scrubber-container:not(.ytp-decorated-scrubber-container) .ytp-scrubber-button {
  background-color: #c9c7d4 !important;
  background-image: ${MOON_FACE} !important;
  box-shadow: ${MOON_GLOW} !important;
}

/* The volume slider: a lavender fill up to a sparkle. */
${PLAYER} .ytp-volume-slider-handle {
  background: ${SPARKLE} center / 100% 100% no-repeat !important;
  border-radius: 0 !important;
  transform: scale(1.5);
  filter: drop-shadow(0 0 1.5px rgb(255 255 255 / 0.9)) drop-shadow(0 0 3px rgb(185 174 251 / 0.85)) !important;
}
${PLAYER} .ytp-volume-slider-handle::before,
${PLAYER} .ytp-volume-slider-handle::after {
  height: 2px !important;
  margin-top: -1px !important;
  border-radius: 1px;
}
${PLAYER} .ytp-volume-slider-handle::before {
  background: ${TRAIL} !important;
}
${PLAYER} .ytp-volume-slider-handle::after {
  background: rgb(214 207 253 / 0.25) !important;
}
/* The newer player's upright volume slider is a range input. */
${PLAYER} .ytp-volume-popover .ytp-input-slider::-webkit-slider-runnable-track {
  background: linear-gradient(to top, #7f6fe0 0, #d6cffd var(--yt-slider-shape-gradient-percent), rgb(214 207 253 / 0.25) var(--yt-slider-shape-gradient-percent)) !important;
}
${PLAYER} .ytp-volume-popover .ytp-input-slider::-webkit-slider-thumb {
  width: 16px !important;
  height: 16px !important;
  margin-right: -7px !important;
  border-radius: 0 !important;
  background: ${SPARKLE} center / 100% 100% no-repeat !important;
  box-shadow: none !important;
  filter: drop-shadow(0 0 1.5px rgb(255 255 255 / 0.9)) drop-shadow(0 0 3px rgb(185 174 251 / 0.85));
}

/* Shorts, the page's loading bar, and what was watched of a video. */
.ytProgressBarLineProgressBarPlayed,
.ytFocusedChapterProgressBarLineProgressBarPlayed,
.ytChapteredProgressBarChapteredPlayerBarFill,
.ytChapteredProgressBarChapteredPlayerBarChapterSeen,
#progress.yt-page-navigation-progress,
.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment,
.ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress,
ytd-thumbnail-overlay-resume-playback-renderer #progress {
  background: ${TRAIL} !important;
}
.ytProgressBarPlayheadProgressBarPlayheadDot {
  background-color: #c9c7d4 !important;
  background-image: ${MOON_FACE} !important;
  box-shadow: ${MOON_GLOW} !important;
}

/* YouTube Music's player bar. */
ytmusic-player-bar {
  --paper-slider-active-color: #b9aefb !important;
  --paper-slider-knob-color: #dcdae6 !important;
}
`;

/**
 * The logo, YouTube's or YouTube Premium's: MoonTube in its place, written
 * in YouTube's own font next to the emblem. Premium members get a sparkle.
 */
const LOGO = "ytd-topbar-logo-renderer #logo-icon";
const LOGO_CSS = `
${LOGO} {
  display: inline-flex !important;
  align-items: center;
  gap: 5px;
  width: auto !important;
  height: 24px !important;
}
${LOGO} > * {
  display: none !important;
}
${LOGO}::before {
  content: "";
  flex: none;
  width: 30px;
  height: 21px;
  background: ${EMBLEM} center / contain no-repeat;
  filter: drop-shadow(0 0 6px rgb(157 143 245 / 0.45));
}
${LOGO}::after {
  content: "MoonTube";
  font: 700 19px / 24px "YouTube Sans", Roboto, Arial, sans-serif;
  letter-spacing: -0.6px;
  white-space: nowrap;
  color: #1d1742;
}
html:root[dark] ${LOGO}::after {
  color: #f4f1ff;
}
ytd-topbar-logo-renderer:has(a[title*="Premium" i], a[aria-label*="Premium" i]) #logo-icon::after {
  content: "MoonTube ✦";
  background: linear-gradient(90deg, currentColor 0 78%, #b9aefb 86%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
`;

/** A few stars in the top bar, over the night. */
const TOP_BAR_STARS = `
  radial-gradient(1.5px 1.5px at 8% 30%, rgb(255 255 255 / 0.7), transparent),
  radial-gradient(1px 1px at 19% 72%, rgb(214 207 253 / 0.8), transparent),
  radial-gradient(1.5px 1.5px at 34% 22%, rgb(255 255 255 / 0.5), transparent),
  radial-gradient(1px 1px at 61% 78%, rgb(255 255 255 / 0.6), transparent),
  radial-gradient(1.5px 1.5px at 73% 26%, rgb(214 207 253 / 0.85), transparent),
  radial-gradient(1px 1px at 88% 64%, rgb(255 255 255 / 0.6), transparent),
  radial-gradient(2px 2px at 95% 20%, rgb(255 255 255 / 0.8), transparent),
  linear-gradient(180deg, #141030, #0d0a23)
`;

/** Moon's night palette in place of YouTube's dark greys and blue. */
const DARK = `
  --yt-sys-color-baseline--base-background: #0d0a23 !important;
  --yt-sys-color-baseline--raised-background: #1a1540 !important;
  --yt-sys-color-baseline--menu-background: #211a4c !important;
  --yt-sys-color-baseline--additive-background: rgb(185 174 251 / 0.12) !important;
  --yt-sys-color-baseline--tonal-background: rgb(185 174 251 / 0.12) !important;
  --yt-sys-color-baseline--mono-tonal-hover: rgb(185 174 251 / 0.22) !important;
  --yt-sys-color-baseline--outline: rgb(185 174 251 / 0.2) !important;
  --yt-sys-color-baseline--outline-opaque: #352c6e !important;
  --yt-sys-color-baseline--text-primary: #f4f1ff !important;
  --yt-sys-color-baseline--text-secondary: #b3abd6 !important;
  --yt-sys-color-baseline--text-disabled: #786f9e !important;
  --yt-sys-color-baseline--call-to-action: #b9aefb !important;
  --yt-sys-color-baseline--call-to-action-hover: #d6cffd !important;
  --yt-sys-color-baseline--suggested-action: #2c2460 !important;
  --yt-sys-color-baseline--suggested-action-hover: #3a2f86 !important;

  /* Older builds' names for the same. */
  --yt-spec-base-background: #0d0a23 !important;
  --yt-spec-raised-background: #1a1540 !important;
  --yt-spec-menu-background: #211a4c !important;
  --yt-spec-general-background-a: #0d0a23 !important;
  --yt-spec-general-background-b: #0d0a23 !important;
  --yt-spec-general-background-c: #0d0a23 !important;
  --yt-spec-10-percent-layer: rgb(185 174 251 / 0.2) !important;
  --yt-spec-badge-chip-background: rgb(185 174 251 / 0.12) !important;
  --yt-spec-text-primary: #f4f1ff !important;
  --yt-spec-text-secondary: #b3abd6 !important;
  --yt-spec-call-to-action: #b9aefb !important;
  --yt-spec-brand-button-background: #7f6fe0 !important;
  --yt-spec-static-brand-red: #9d8ff5 !important;

  /* The hashed tokens: backgrounds, surfaces, lines, text, links. */
  --t3e41d7b17b187f69: #0d0a23 !important;
  --t6216186c28b3834b: #0d0a23 !important;
  --t518e925f61bdcb91: #1a1540 !important;
  --t08a7c6c176cbc5c2: #211a4c !important;
  --ta889dfda9605a358: rgb(13 10 35 / 0.82) !important;
  --t7f4f2c6d54836ce0: rgb(185 174 251 / 0.12) !important;
  --tf3fc855af2285f5f: rgb(185 174 251 / 0.2) !important;
  --td8562cdc203bc683: #352c6e !important;
  --tffc2fd3a644f6275: #f4f1ff !important;
  --t1405e70a39276293: #f4f1ff !important;
  --t4a6da19e16bf221a: #b3abd6 !important;
  --t7e34d5baa4ea6277: #786f9e !important;
  --t2d807bb79e75606d: #b9aefb !important;
  --t617db776af0de196: #d6cffd !important;
  --tfa3475c508f5dfef: #2c2460 !important;
  --t9bc0b740242da017: #3a2f86 !important;
`;

/** In daylight, only the links and buttons take Moon's lavender. */
const LIGHT = `
  --yt-sys-color-baseline--call-to-action: #5b4bc4 !important;
  --yt-spec-call-to-action: #5b4bc4 !important;
  --t2d807bb79e75606d: #5b4bc4 !important;
`;

const PAGE_CSS = `
html:root:not([dark]) { ${LIGHT} }

/* Nested [dark] elements redefine the palette, so they get it too. */
html:root[dark],
html:root[dark] [dark] { ${DARK} }

/*
 * One night colour behind the whole page. (A sky behind it would only show
 * through where YouTube happens to leave a part transparent: in patches.)
 * The stars live in the top bar, which is one piece.
 */
html:root[dark],
html:root[dark] ytd-app {
  background: #0d0a23 !important;
  scrollbar-color: #4a3f8f transparent;
}
html:root[dark] #masthead-container ytd-masthead {
  background: ${TOP_BAR_STARS} !important;
}

/* The search box has colours of its own. */
html:root[dark] .ytSearchboxComponentInputBoxDark {
  background-color: #0d0a23 !important;
  border-color: #352c6e !important;
}
html:root[dark] .ytSearchboxComponentInputBoxDark.ytSearchboxComponentInputBoxHasFocus {
  border-color: #9d8ff5 !important;
}
html:root[dark] .ytSearchboxComponentSearchButtonDark {
  background-color: rgb(185 174 251 / 0.12) !important;
  border-color: #352c6e !important;
}

::selection {
  background: rgb(185 174 251 / 0.35);
}
`;

export const YOUTUBE_CSS = PLAYER_CSS + LOGO_CSS + PAGE_CSS;

/** The sites that get the look. */
export function isYouTube(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      (hostname === "youtube.com" ||
        hostname === "www.youtube.com" ||
        hostname === "m.youtube.com" ||
        hostname === "music.youtube.com")
    );
  } catch {
    return false;
  }
}
