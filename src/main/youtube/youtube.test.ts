import { describe, expect, it } from "vitest";
import { isYouTube, YOUTUBE_CSS } from "./theme";

describe("YouTube in Moon's look", () => {
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
