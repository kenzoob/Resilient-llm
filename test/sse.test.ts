import { describe, it, expect } from "vitest";
import { parseSSE } from "../src/sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe("parseSSE", () => {
  it("parses a single complete event", async () => {
    const stream = streamFromChunks(['event: message\ndata: {"text":"hi"}\n\n']);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([{ event: "message", data: '{"text":"hi"}' }]);
  });

  it("parses multiple events in one chunk", async () => {
    const stream = streamFromChunks(["data: one\n\ndata: two\n\n"]);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([
      { event: undefined, data: "one" },
      { event: undefined, data: "two" },
    ]);
  });

  it("handles an event split across two chunks, cut mid-line", async () => {
    const stream = streamFromChunks(['data: {"text":"he', 'llo"}\n\n']);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([{ event: undefined, data: '{"text":"hello"}' }]);
  });

  it("handles an event split right at the blank-line boundary", async () => {
    const stream = streamFromChunks(["data: hello\n", "\ndata: world\n\n"]);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([
      { event: undefined, data: "hello" },
      { event: undefined, data: "world" },
    ]);
  });

  it("joins multi-line data fields with newlines", async () => {
    const stream = streamFromChunks(["data: line1\ndata: line2\n\n"]);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([{ event: undefined, data: "line1\nline2" }]);
  });

  it("yields a trailing event even without a final blank line", async () => {
    const stream = streamFromChunks(["data: trailing"]);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([{ event: undefined, data: "trailing" }]);
  });

  it("ignores blocks with no data field", async () => {
    const stream = streamFromChunks([": this is a comment\n\ndata: real\n\n"]);
    const events = await collect(parseSSE(stream));
    expect(events).toEqual([{ event: undefined, data: "real" }]);
  });
});
