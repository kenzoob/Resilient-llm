import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { anthropic } from "../../src/providers/anthropic";
import { LLMError } from "../../src/errors";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("anthropic provider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the expected request shape and returns the text", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "hello" }] }));

    const provider = anthropic({ apiKey: "key", model: "claude-sonnet-5" });
    const controller = new AbortController();
    const result = await provider.call({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });

    expect(result.text).toBe("hello");
    expect(result.provider).toBe("anthropic");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("joins multiple text blocks", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
      }),
    );
    const provider = anthropic({ apiKey: "key", model: "claude-sonnet-5" });
    const result = await provider.call({
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
    });
    expect(result.text).toBe("hello world");
  });

  it("maps a 429 to a retryable LLMError with Retry-After honored", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { message: "rate limited" } },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );
    const provider = anthropic({ apiKey: "key", model: "claude-sonnet-5" });

    await expect(
      provider.call({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 429, retryable: true, retryAfterMs: 2000 });
  });

  it("maps a 400 to a non-retryable LLMError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "bad request" } }, { status: 400 }),
    );
    const provider = anthropic({ apiKey: "key", model: "claude-sonnet-5" });

    await expect(
      provider.call({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 400, retryable: false });
  });

  it("wraps a network failure as a retryable LLMError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const provider = anthropic({ apiKey: "key", model: "claude-sonnet-5" });

    const promise = provider.call({
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
    });
    await expect(promise).rejects.toBeInstanceOf(LLMError);
    await expect(promise).rejects.toMatchObject({ retryable: true });
  });

  it("streams text deltas parsed from SSE content_block_delta events", async () => {
    const sse =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    fetchMock.mockResolvedValueOnce(
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const provider = anthropic({ apiKey: "key", model: "claude-sonnet-5" });
    if (!provider.stream) {
      throw new Error("provider.stream not implemented");
    }

    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(true);
  });
});
