import { describe, expect, it } from "vitest";
import { LaunchQueue, linkFromOtherApp } from "./launch";

describe("links from other apps", () => {
  it("opens web addresses and local files only", () => {
    expect(linkFromOtherApp("https://example.com/a")).toBe("https://example.com/a");
    expect(linkFromOtherApp("http://example.com/")).toBe("http://example.com/");
    expect(linkFromOtherApp("file:///Users/luna/page.html")).toBe("file:///Users/luna/page.html");
    expect(linkFromOtherApp("moon://settings/")).toBeNull();
    expect(linkFromOtherApp("javascript:alert(1)")).toBeNull();
    expect(linkFromOtherApp("not a url")).toBeNull();
  });

  it("holds links until the browser is ready, then hands them on", () => {
    const queue = new LaunchQueue();
    queue.add("https://first.example/");
    queue.add("moon://settings/");
    queue.add("https://second.example/");
    const opened: string[][] = [];
    expect(queue.ready((urls) => opened.push(urls))).toEqual([
      "https://first.example/",
      "https://second.example/",
    ]);
    expect(opened).toEqual([]);
    queue.add("https://later.example/");
    expect(opened).toEqual([["https://later.example/"]]);
  });
});
