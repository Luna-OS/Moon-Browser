import { describe, expect, it } from "vitest";
import { isYouTube, youtubeLook, YOUTUBE_CSS, YOUTUBE_MUSIC_CSS } from "./theme";

describe("YouTube in Luma's look", () => {
  it("is only for YouTube, over HTTPS", () => {
    expect(isYouTube("https://youtube.com/watch?v=abc")).toBe(true);
    expect(isYouTube("https://www.youtube.com/")).toBe(true);
    expect(isYouTube("https://m.youtube.com/shorts/abc")).toBe(true);
    expect(isYouTube("https://music.youtube.com/")).toBe(true);
    expect(isYouTube("http://www.youtube.com/")).toBe(false);
    expect(isYouTube("https://youtube.com.example.com/")).toBe(false);
    expect(isYouTube("https://example.com/?youtube.com")).toBe(false);
    expect(isYouTube("https://www.youtube-nocookie.com/embed/abc")).toBe(false);
    expect(isYouTube("not a url")).toBe(false);
  });

  it("has a look for YouTube and one for YouTube Music", () => {
    expect(youtubeLook("https://www.youtube.com/watch?v=abc")).toBe(YOUTUBE_CSS);
    expect(youtubeLook("https://m.youtube.com/")).toBe(YOUTUBE_CSS);
    expect(youtubeLook("https://music.youtube.com/watch?v=abc")).toBe(YOUTUBE_MUSIC_CSS);
    expect(youtubeLook("https://example.com/")).toBeUndefined();
    expect(youtubeLook("not a url")).toBeUndefined();
    // Each site gets its own style, not the other's as well.
    expect(YOUTUBE_CSS).not.toContain("ytmusic");
    expect(YOUTUBE_MUSIC_CSS).not.toContain("ytd-");
  });

  it("gives the player a moonlit progress bar and a sparkling volume slider", () => {
    for (const selector of [
      ".ytp-play-progress",
      ".ytp-scrubber-button",
      ".ytp-volume-slider-handle::before",
      ".ytp-volume-slider-handle::after",
    ]) {
      expect(YOUTUBE_CSS).toContain(selector);
    }
    expect(YOUTUBE_CSS).toContain("#7f6fe0");
    expect(YOUTUBE_CSS).toContain("data:image/svg+xml,");
    // Ads keep YouTube's yellow.
    expect(YOUTUBE_CSS).toContain(".html5-video-player:not(.ad-interrupting)");
  });

  it("puts MoonTube's logo in place of YouTube's and YouTube Premium's", () => {
    // On the logo's link: what is inside it (<ytd-logo>, a doodle) changes.
    expect(YOUTUBE_CSS).toContain("ytd-topbar-logo-renderer > a#logo > *");
    expect(YOUTUBE_CSS).toContain('content: "MoonTube"');
    expect(YOUTUBE_CSS).toContain('[title*="Premium" i]');
  });

  it("paints one night colour, not a sky that shows through in patches", () => {
    expect(YOUTUBE_CSS).not.toContain("background-attachment: fixed");
    expect(YOUTUBE_CSS).toContain("html:root[dark] ytd-app");
    // No ambient glow as a dark block around the player.
    expect(YOUTUBE_CSS).toContain("html:root[dark] #cinematics");
  });

  it("recolours YouTube's dark palette only in dark mode", () => {
    expect(YOUTUBE_CSS).toContain("html:root[dark] [dark]");
    expect(YOUTUBE_CSS).toContain("--yt-sys-color-baseline--base-background: #0d0a23 !important");
  });
});

describe("YouTube Music in Luma's look", () => {
  it("wears the night always, in both of its palettes", () => {
    // It has no [dark] attribute: it is dark in every theme.
    expect(YOUTUBE_MUSIC_CSS).not.toContain("[dark]");
    // The paint, and the roles a newer build sets to plain colours.
    expect(YOUTUBE_MUSIC_CSS).toContain("--ytmusic-color-black4: #0d0a23 !important");
    expect(YOUTUBE_MUSIC_CSS).toContain("--ytmusic-background: #0d0a23 !important");
    expect(YOUTUBE_MUSIC_CSS).toContain("--ytmusic-player-bar-background: #1a1540 !important");
    expect(YOUTUBE_MUSIC_CSS).toContain("--ytmusic-text-primary: #f4f1ff !important");
    expect(YOUTUBE_MUSIC_CSS).toContain("--ytmusic-static-brand-red: #9d8ff5 !important");
    expect(YOUTUBE_MUSIC_CSS).toContain("ytmusic-nav-bar {");
  });

  it("gives the player bar a moonlit progress bar and a sparkling volume slider", () => {
    // Its sliders are built without shadow DOM, so their parts are styled straight.
    expect(YOUTUBE_MUSIC_CSS).toContain("#progress-bar #primaryProgress");
    expect(YOUTUBE_MUSIC_CSS).toContain("#progress-bar .slider-knob-inner");
    expect(YOUTUBE_MUSIC_CSS).toContain(
      ":is(#volume-slider, #expand-volume-slider) #primaryProgress",
    );
    expect(YOUTUBE_MUSIC_CSS).toContain(
      ":is(#volume-slider, #expand-volume-slider) .slider-knob-inner",
    );
    expect(YOUTUBE_MUSIC_CSS).toContain("ytmusic-player-controls");
    expect(YOUTUBE_MUSIC_CSS).toContain("#7f6fe0");
    expect(YOUTUBE_MUSIC_CSS).toContain("data:image/svg+xml,");
  });

  it("puts the emblem before Music in the logo", () => {
    expect(YOUTUBE_MUSIC_CSS).toContain("ytmusic-logo > a > *");
    expect(YOUTUBE_MUSIC_CSS).toContain('content: "Music"');
  });
});
