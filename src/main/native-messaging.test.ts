import { describe, expect, it } from "vitest";
import { frameMessage, HOST_NAME, parseHostManifest, readMessages } from "./native-messaging";

describe("native messaging", () => {
  it("frames messages as Chrome does: length, then UTF-8 JSON", () => {
    const framed = frameMessage({ text: "Grüße 🌙" });
    const body = Buffer.from(JSON.stringify({ text: "Grüße 🌙" }), "utf8");
    expect(framed.readUInt32LE(0)).toBe(body.length);
    expect(framed.subarray(4).equals(body)).toBe(true);
  });

  it("reads messages that arrive in pieces or together", () => {
    const both = Buffer.concat([frameMessage({ a: 1 }), frameMessage(["zwei"])]);
    const first = readMessages(both.subarray(0, 7));
    expect(first.messages).toEqual([]);
    const rest = readMessages(Buffer.concat([first.rest, both.subarray(7)]));
    expect(rest.messages).toEqual([{ a: 1 }, ["zwei"]]);
    expect(rest.rest.length).toBe(0);
  });

  it("refuses messages that are too large or not JSON", () => {
    const huge = Buffer.alloc(4);
    huge.writeUInt32LE(2 * 1024 * 1024);
    expect(readMessages(huge).error).toBe("too large");
    const bad = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from("{x}")]);
    expect(readMessages(bad).error).toBe("not JSON");
  });

  it("only runs stdio hosts with a usable path", () => {
    const ok = {
      name: "com.example.app",
      path: "/opt/app/host",
      type: "stdio",
      allowed_origins: [],
    };
    expect(parseHostManifest(ok, "/etc/x.json")?.path).toBe("/opt/app/host");
    expect(parseHostManifest({ ...ok, type: "pipe" }, "/etc/x.json")).toBeNull();
    expect(parseHostManifest({ ...ok, path: 3 }, "/etc/x.json")).toBeNull();
    if (process.platform !== "win32")
      expect(parseHostManifest({ ...ok, path: "host" }, "/etc/x.json")).toBeNull();
  });

  it("accepts host names as Chrome does", () => {
    expect(HOST_NAME.test("com.anthropic.claude_code_browser_extension")).toBe(true);
    expect(HOST_NAME.test("../evil")).toBe(false);
    expect(HOST_NAME.test("Com.Example")).toBe(false);
  });
});
