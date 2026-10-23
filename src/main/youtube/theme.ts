/**
 * YouTube in Moon Browser's night-sky look. The player wears it always (it
 * is dark in both of YouTube's themes): the played part of the progress bar
 * is a softly glowing lavender trail that ends in a small full moon, and the
 * volume slider fills with lavender up to a four-pointed sparkle. In dark
 * mode, the site itself takes Moon's night palette over a starry sky.
 *
 * YouTube names its colours twice: as `--yt-sys-color-baseline--*` custom
 * properties, and as hashed tokens (`--t…`) that most of its CSS reads. Both
 * are swapped here; the hashed names are those of YouTube's build at the time
 * of writing, and a later build that renames them merely loses part of the
 * palette, never the layout. The video picture itself is left alone.
 */

import { SKY, SKY_SIZE } from "../moon-sky";

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

/* The starry sky behind the page; its bars and menus stay solid night. */
html:root[dark] {
  background: ${SKY} !important;
  background-size: ${SKY_SIZE} !important;
  background-attachment: fixed !important;
  scrollbar-color: #4a3f8f transparent;
}
html:root[dark] ytd-app {
  background: transparent !important;
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

export const YOUTUBE_CSS = PLAYER_CSS + PAGE_CSS;

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
