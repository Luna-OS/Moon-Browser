import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: true } }));

const { echoContent, errorNotice } = await import("./chat");

type Block = Anthropic.Beta.BetaContentBlock;
const block = (value: object) => value as Block;

describe("what the chat says when a request fails", () => {
  const failure = (status: number, type: string, message: string, headers = new Headers()) =>
    Anthropic.APIError.generate(
      status,
      { type: "error", error: { type, message } },
      message,
      headers,
    );

  it("asks for the key again when Anthropic doesn't accept it", () => {
    const notice = errorNotice(failure(401, "authentication_error", "invalid x-api-key"), "m");
    expect(notice.needsKey).toBe(true);
    expect(notice.text).toMatch(/did not accept this API key/);
  });

  it("tells rate limits, with the time to wait when Anthropic gives one", () => {
    expect(errorNotice(failure(429, "rate_limit_error", "slow down"), "m").text).toMatch(
      /rate limit.*Wait a moment/,
    );
    const wait = new Headers({ "retry-after": "12.4" });
    expect(errorNotice(failure(429, "rate_limit_error", "slow down", wait), "m").text).toMatch(
      /about 13 seconds/,
    );
  });

  it("names the model when the key may not use it", () => {
    expect(errorNotice(failure(403, "permission_error", "no"), "claude-opus-5-5").text).toMatch(
      /may not use claude-opus-5-5/,
    );
    expect(errorNotice(failure(404, "not_found_error", "no"), "claude-opus-5-5").text).toMatch(
      /claude-opus-5-5 is not available/,
    );
  });

  it("passes on what Anthropic says about a request it turns down", () => {
    const notice = errorNotice(
      failure(400, "invalid_request_error", "Your credit balance is too low"),
      "m",
    );
    expect(notice.text).toBe("Anthropic turned the request down: Your credit balance is too low");
    expect(notice.needsKey).toBeUndefined();
  });

  it("tells a busy service and a missing connection apart", () => {
    expect(errorNotice(failure(529, "overloaded_error", "overloaded"), "m").text).toMatch(/busy/);
    expect(errorNotice(failure(500, "api_error", "oops"), "m").text).toMatch(/busy/);
    expect(errorNotice(new Anthropic.APIConnectionError({ message: "offline" }), "m").text).toMatch(
      /could not be reached/,
    );
    expect(errorNotice(new Anthropic.APIConnectionTimeoutError(), "m").text).toMatch(/too long/);
    expect(errorNotice(new Error("something else"), "m").text).toMatch(/went wrong/);
  });
});

describe("an assistant turn going back into the conversation", () => {
  it("is kept as it came, thinking and all", () => {
    const content = [
      block({ type: "thinking", thinking: "", signature: "s" }),
      block({ type: "text", text: "Reading." }),
      block({ type: "tool_use", id: "t1", name: "read_page", input: {} }),
    ];
    expect(echoContent(content)).toBe(content);
  });

  it("drops the first model's thinking and tool calls after a switch of models", () => {
    const fallback = block({
      type: "fallback",
      from: { model: "claude-opus-5-5" },
      to: { model: "claude-opus-5" },
    });
    const kept = echoContent([
      block({ type: "thinking", thinking: "", signature: "a" }),
      block({ type: "text", text: "Let me" }),
      block({ type: "tool_use", id: "t0", name: "click", input: {} }),
      fallback,
      block({ type: "thinking", thinking: "", signature: "b" }),
      block({ type: "text", text: "Here it is." }),
      block({ type: "tool_use", id: "t1", name: "read_page", input: {} }),
    ]);
    expect(kept.map((b) => b.type)).toEqual(["text", "fallback", "thinking", "text", "tool_use"]);
    expect(kept[1]).toBe(fallback);
  });
});
