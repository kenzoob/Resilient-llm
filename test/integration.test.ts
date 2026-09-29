import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect } from "vitest";
import { anthropic } from "../src/providers/anthropic";
import { openai } from "../src/providers/openai";
import { resilientCall } from "../src/fallback";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

function startServer(handler: Handler): Promise<TestServer> {
  const server: Server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
  });
}

describe("integration: real HTTP, no mocked fetch", () => {
  it("anthropic provider gets text back from a real server", async () => {
    const server = await startServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: "hello from real server" }] }));
      });
    });
    try {
      const provider = anthropic({ apiKey: "test-key", model: "m", baseUrl: server.url });
      const result = await provider.call({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      });
      expect(result.text).toBe("hello from real server");
    } finally {
      await server.close();
    }
  });

  it("openai provider gets text back from a real server", async () => {
    const server = await startServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi there" } }] }),
        );
      });
    });
    try {
      const provider = openai({ apiKey: "test-key", model: "m", baseUrl: server.url });
      const result = await provider.call({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      });
      expect(result.text).toBe("hi there");
    } finally {
      await server.close();
    }
  });

  it("aborts a genuinely slow request and retries to success", async () => {
    let requestCount = 0;
    const server = await startServer((req, res) => {
      requestCount += 1;
      void readBody(req).then(() => {
        if (requestCount === 1) {
          setTimeout(() => {
            try {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify({ content: [{ type: "text", text: "too late" }] }));
            } catch {
              // client already disconnected after the real timeout fired; ignore
            }
          }, 500);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
      });
    });
    try {
      const provider = anthropic({ apiKey: "k", model: "m", baseUrl: server.url });
      const result = await resilientCall({
        providers: [provider],
        messages: [{ role: "user", content: "hi" }],
        timeoutMs: 80,
        retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 100 },
        breaker: { failureThreshold: 5, resetTimeoutMs: 1000 },
      });
      expect(result.text).toBe("ok");
      expect(requestCount).toBe(2);
    } finally {
      await server.close();
    }
  }, 10_000);

  it("retries a real 500 response and then succeeds", async () => {
    let count = 0;
    const server = await startServer((req, res) => {
      count += 1;
      void readBody(req).then(() => {
        if (count === 1) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "server error" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
      });
    });
    try {
      const provider = openai({ apiKey: "k", model: "m", baseUrl: server.url });
      const result = await resilientCall({
        providers: [provider],
        messages: [{ role: "user", content: "hi" }],
        timeoutMs: 1000,
        retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 50 },
        breaker: { failureThreshold: 5, resetTimeoutMs: 1000 },
      });
      expect(result.text).toBe("ok");
      expect(count).toBe(2);
    } finally {
      await server.close();
    }
  });

  it("honors a real Retry-After header (delta-seconds) before retrying", async () => {
    let count = 0;
    const server = await startServer((req, res) => {
      count += 1;
      void readBody(req).then(() => {
        if (count === 1) {
          res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
          res.end(JSON.stringify({ error: { message: "rate limited" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
      });
    });
    try {
      const provider = anthropic({ apiKey: "k", model: "m", baseUrl: server.url });
      const start = Date.now();
      const result = await resilientCall({
        providers: [provider],
        messages: [{ role: "user", content: "hi" }],
        timeoutMs: 5000,
        retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 5000 },
        breaker: { failureThreshold: 5, resetTimeoutMs: 1000 },
      });
      const elapsed = Date.now() - start;
      expect(result.text).toBe("ok");
      expect(elapsed).toBeGreaterThanOrEqual(900);
    } finally {
      await server.close();
    }
  }, 10_000);

  it("fails fast on a real 400 without retrying", async () => {
    let count = 0;
    const server = await startServer((req, res) => {
      count += 1;
      void readBody(req).then(() => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad request" } }));
      });
    });
    try {
      const provider = openai({ apiKey: "k", model: "m", baseUrl: server.url });
      await expect(
        resilientCall({
          providers: [provider],
          messages: [{ role: "user", content: "hi" }],
          timeoutMs: 1000,
          retry: { retries: 3, baseDelayMs: 10, maxDelayMs: 50 },
          breaker: { failureThreshold: 5, resetTimeoutMs: 1000 },
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(count).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("opens the circuit on a real failing provider and falls back to a real healthy one", async () => {
    const down = await startServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "down" } }));
      });
    });
    const up = await startServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "healthy" } }] }),
        );
      });
    });
    try {
      const p1 = openai({ apiKey: "k", model: "m", baseUrl: down.url });
      const p2 = openai({ apiKey: "k", model: "m", baseUrl: up.url });
      const result = await resilientCall({
        providers: [p1, p2],
        messages: [{ role: "user", content: "hi" }],
        timeoutMs: 1000,
        retry: { retries: 0, baseDelayMs: 10, maxDelayMs: 50 },
        breaker: { failureThreshold: 1, resetTimeoutMs: 10_000 },
      });
      expect(result.text).toBe("healthy");
    } finally {
      await down.close();
      await up.close();
    }
  });

  it("treats a real connection-refused error as retryable and falls back", async () => {
    const deadServer = await startServer((_req, res) => res.end());
    const deadUrl = deadServer.url;
    await deadServer.close();

    const up = await startServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
      });
    });
    try {
      const p1 = anthropic({ apiKey: "k", model: "m", baseUrl: deadUrl });
      const p2 = anthropic({ apiKey: "k", model: "m", baseUrl: up.url });
      const result = await resilientCall({
        providers: [p1, p2],
        messages: [{ role: "user", content: "hi" }],
        timeoutMs: 2000,
        retry: { retries: 0, baseDelayMs: 10, maxDelayMs: 50 },
        breaker: { failureThreshold: 5, resetTimeoutMs: 1000 },
      });
      expect(result.text).toBe("ok");
    } finally {
      await up.close();
    }
  });

  it("streams real chunked SSE bytes split mid-event across writes", async () => {
    const server = await startServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunks = [
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel',
          'lo "}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}\n\n',
        ];
        let i = 0;
        const interval = setInterval(() => {
          if (i >= chunks.length) {
            clearInterval(interval);
            res.end();
            return;
          }
          res.write(chunks[i]);
          i += 1;
        }, 10);
      });
    });
    try {
      const provider = anthropic({ apiKey: "k", model: "m", baseUrl: server.url });
      if (!provider.stream) {
        throw new Error("provider.stream not implemented");
      }
      const textChunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: "user", content: "hi" }],
        signal: new AbortController().signal,
      })) {
        textChunks.push(chunk);
      }
      expect(textChunks.join("")).toBe("Hello world");
    } finally {
      await server.close();
    }
  }, 10_000);
});
