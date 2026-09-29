import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openai } from "../../src/providers/openai";
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

describe("openai provider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the expected request shape and returns the text", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
    );

    const provider = openai({ apiKey: "key", model: "gpt-4o" });
    const result = await provider.call({
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
    });

    expect(result.text).toBe("hello");
    expect(result.provider).toBe("openai");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer key");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("maps a 500 to a retryable LLMError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "server error" } }, { status: 500 }),
    );
    const provider = openai({ apiKey: "key", model: "gpt-4o" });

    await expect(
      provider.call({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 500, retryable: true });
  });

  it("maps a 401 to a non-retryable LLMError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "unauthorized" } }, { status: 401 }),
    );
    const provider = openai({ apiKey: "key", model: "gpt-4o" });

    await expect(
      provider.call({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 401, retryable: false });
  });

  it("wraps a network failure as a retryable LLMError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const provider = openai({ apiKey: "key", model: "gpt-4o" });

    const promise = provider.call({
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
    });
    await expect(promise).rejects.toBeInstanceOf(LLMError);
    await expect(promise).rejects.toMatchObject({ retryable: true });
  });

  it("streams text deltas parsed from SSE chunks until [DONE]", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      "data: [DONE]\n\n";
    fetchMock.mockResolvedValueOnce(
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const provider = openai({ apiKey: "key", model: "gpt-4o" });
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
