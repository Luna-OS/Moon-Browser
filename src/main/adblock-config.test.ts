import { FiltersEngine, Request } from "@ghostery/adblocker";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG, MOON_FIXES } from "./adblock-config";

// Rules from uBlock Origin's and EasyPrivacy's lists that block Netflix's logging.
const LISTS = [
  "||netflix.com/log/",
  "||logs.netflix.com^",
  "||netflix.com/ichnaea/log",
  "||netflix.com/msl/playapi/cadmium/logblob/",
  "||doubleclick.net^",
].join("\n");

const blocked = (engine: FiltersEngine, url: string, type: string) =>
  engine.match(
    Request.fromRawDetails({
      url,
      sourceUrl: "https://www.netflix.com/watch/1",
      type: type as never,
    }),
  ).match;

describe("Moon Browser's own blocker fixes", () => {
  const engine = FiltersEngine.parse(`${LISTS}\n${MOON_FIXES}`, ENGINE_CONFIG);

  it("let Netflix's player log, so it doesn't stop with NSES-UHX", () => {
    expect(blocked(engine, "https://www.netflix.com/log/www/cl/2", "xmlhttprequest")).toBe(false);
    expect(blocked(engine, "https://logs.netflix.com/log/wwwhead/cl/2", "xmlhttprequest")).toBe(
      false,
    );
    expect(blocked(engine, "https://www.netflix.com/ichnaea/log/x", "ping")).toBe(false);
    expect(
      blocked(engine, "https://www.netflix.com/msl/playapi/cadmium/logblob/1", "xmlhttprequest"),
    ).toBe(false);
  });

  it("still block everything else", () => {
    expect(blocked(engine, "https://ad.doubleclick.net/x.js", "script")).toBe(true);
    // Without the fixes, the same lists block Netflix's logging.
    const plain = FiltersEngine.parse(LISTS, ENGINE_CONFIG);
    expect(blocked(plain, "https://logs.netflix.com/log/wwwhead/cl/2", "xmlhttprequest")).toBe(
      true,
    );
  });
});
