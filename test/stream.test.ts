import { describe, it, expect } from "vitest";
import { streamText } from "../src/stream";
import { LLMError } from "../src/errors";
import type { Provider } from "../src/providers/shared";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe("streamText", () => {
  it("delegates to the provider's stream implementation", async () => {
    const provider: Provider = {
      name: "fake",
      call: () => Promise.reject(new Error("not used")),
      // eslint-disable-next-line @typescript-eslint/require-await -- async generator syntax requires the keyword even without an await
      async *stream() {
        yield "hel";
        yield "lo";
      },
    };

    const chunks = await collect(
      streamText({
        provider,
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      }),
    );

    expect(chunks).toEqual(["hel", "lo"]);
  });

  it("throws a non-retryable LLMError when the provider does not support streaming", async () => {
    const provider: Provider = {
      name: "fake",
      call: () => Promise.reject(new Error("not used")),
    };

    const iterator = streamText({
      provider,
      messages: [{ role: "user", content: "hi" }],
      signal: new AbortController().signal,
    });

    await expect(iterator.next()).rejects.toBeInstanceOf(LLMError);
    await expect(
      streamText({
        provider,
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      }).next(),
    ).rejects.toMatchObject({ retryable: false, provider: "fake" });
  });
});
