# resilient-llm

![CI](https://github.com/kenzoob/Resilient-llm/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/@kenzoobryan27/resilient-llm)
![license](https://img.shields.io/npm/l/@kenzoobryan27/resilient-llm)
![types](https://img.shields.io/badge/types-included-blue)

**Make LLM API calls production-ready.** Timeouts, retries with backoff and jitter, circuit breakers, provider fallback, and SSE streaming — for Anthropic, OpenAI, or any HTTP-based LLM API. Zero runtime dependencies.

```bash
npm install @kenzoobryan27/resilient-llm
```

## The problem

LLM APIs fail in predictable ways:

- **Rate limits** — a 429 during a traffic spike.
- **Temporary outages** — a 5xx while the provider is degraded.
- **Hanging requests** — a request that never comes back.

Without protection, your app waits forever, crashes, or keeps hammering a service that is already down. `resilient-llm` wraps any call and makes it robust — without locking you into a specific provider or SDK.

## Features

- **Timeout** — every attempt is aborted with a real `AbortController`, not a race against a dangling promise.
- **Retry with backoff + full jitter** — only retries transient errors (timeouts, 429, 5xx). Never retries a 400 or 401. Honors the server's `Retry-After` header, in both delta-seconds and HTTP-date form.
- **Circuit breaker** — `closed → open → half-open → closed`, one breaker per provider, so a dead provider fails fast instead of eating your timeout budget on every request.
- **Fallback** — tries the next provider once one is exhausted or its circuit is open. A non-retryable error (bad request, bad auth) fails immediately instead of masking the problem by hitting a different provider.
- **SSE streaming** — an async generator that parses Server-Sent Events byte-by-byte, correctly handling chunks split mid-event over the wire.
- **Observability hooks** — `onRetry`, `onCircuitOpen`, `onCircuitClose`, `onFallback` to plug in your own logs or metrics.
- **No SDK** — built on `fetch`, so there is nothing to update when a provider ships a new SDK major version, and full control over error mapping and streaming.
- **Fully typed, zero runtime dependencies** — the whole library is under 15 kB, ships ESM + CJS + `.d.ts`.

## Quick start

```ts
import { resilientCall, anthropic, openai } from "@kenzoobryan27/resilient-llm";

const result = await resilientCall({
  providers: [
    anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, model: process.env.ANTHROPIC_MODEL! }),
    openai({ apiKey: process.env.OPENAI_API_KEY!, model: process.env.OPENAI_MODEL! }),
  ],
  messages: [{ role: "user", content: "Summarize this notice in one sentence: ..." }],
  timeoutMs: 20_000,
  retry: { retries: 3, baseDelayMs: 500, maxDelayMs: 8_000 },
  breaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
});

console.log(result.text, result.provider); // e.g. "...", "anthropic"
```

If Anthropic times out or rate-limits, `resilientCall` retries it with backoff. If it keeps failing, it falls back to OpenAI. If Anthropic is down for a while, its circuit opens and later calls skip straight to OpenAI without wasting a timeout on a provider you already know is unhealthy.

Model names change often — keep them in environment variables, never hardcoded. See [`.env.example`](.env.example).

## Streaming

Stream tokens from a single provider as they arrive, instead of waiting for the full response:

```ts
import { anthropic, streamText } from "@kenzoobryan27/resilient-llm";

const provider = anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: process.env.ANTHROPIC_MODEL!,
});
const controller = new AbortController();

for await (const chunk of streamText({
  provider,
  messages: [{ role: "user", content: "Explain RAG in one sentence" }],
  signal: controller.signal,
})) {
  process.stdout.write(chunk);
}
```

Try it from the CLI:

```bash
npx tsx examples/chat.ts "Explain RAG in one sentence"
```

(`examples/chat.ts` reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from your environment and streams the reply to stdout.)

## Observability

Every stage of the resilience pipeline has a hook, so you can wire in your own logger or metrics without forking the library:

```ts
await resilientCall({
  providers: [anthropic({ apiKey, model }), openai({ apiKey, model })],
  messages,
  timeoutMs: 20_000,
  retry: { retries: 3, baseDelayMs: 500, maxDelayMs: 8_000 },
  breaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
  hooks: {
    onRetry: ({ attempt, delayMs, error, provider }) =>
      console.warn(`[${provider}] retry #${attempt} in ${delayMs}ms: ${error.message}`),
    onCircuitOpen: ({ provider }) => console.error(`[${provider}] circuit opened`),
    onCircuitClose: ({ provider }) => console.info(`[${provider}] circuit closed`),
    onFallback: ({ from, to }) => console.warn(`falling back from ${from} to ${to}`),
  },
});
```

## Configuration reference

`resilientCall(options)`:

| Option                     | Type                 | Description                                                             |
| -------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `providers`                | `Provider[]`         | Tried in order. The first success wins.                                 |
| `messages`                 | `ChatMessage[]`      | `{ role: "user" \| "assistant" \| "system", content: string }[]`        |
| `timeoutMs`                | `number`             | Per-attempt timeout, enforced with `AbortController`.                   |
| `retry.retries`            | `number`             | Max retries per provider, after the first attempt.                      |
| `retry.baseDelayMs`        | `number`             | Base delay for exponential backoff.                                     |
| `retry.maxDelayMs`         | `number`             | Hard cap on any single delay, including `Retry-After`.                  |
| `breaker.failureThreshold` | `number`             | Consecutive failures before a provider's circuit opens.                 |
| `breaker.resetTimeoutMs`   | `number`             | How long a circuit stays open before a half-open trial is allowed.      |
| `hooks`                    | `ResilientCallHooks` | Optional `onRetry` / `onCircuitOpen` / `onCircuitClose` / `onFallback`. |

Returns `{ text: string, provider: string }` — `provider` tells you which one actually answered.

## Error handling

Every failure — HTTP error, timeout, or network failure — surfaces as an `LLMError`:

```ts
import { LLMError, isRetryable } from "@kenzoobryan27/resilient-llm";

try {
  await resilientCall({/* ... */});
} catch (error) {
  if (error instanceof LLMError) {
    console.error(error.status, error.provider, error.retryable, error.message);
  }
}
```

| Field          | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| `status`       | HTTP status code, if the failure came from a response.     |
| `provider`     | Which provider raised it (`"anthropic"`, `"openai"`, ...). |
| `retryable`    | Whether the library would retry this on its own.           |
| `retryAfterMs` | Parsed `Retry-After` delay, if the server sent one.        |

`isRetryable(error)` and `parseRetryAfter(header)` are exported too, in case you're wiring resilience into your own code path.

## The building blocks

`resilientCall` is composed from smaller pieces, and every one of them is exported and usable on its own.

**`withTimeout`** — abort any async function after a deadline:

```ts
import { withTimeout } from "@kenzoobryan27/resilient-llm";

const data = await withTimeout((signal) => fetch(url, { signal }).then((r) => r.json()), 5_000);
```

**`withRetry`** — retry any function on a retryable `LLMError`, with exponential backoff and full jitter:

```ts
import { withRetry } from "@kenzoobryan27/resilient-llm";

const result = await withRetry(() => riskyCall(), {
  retries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  onRetry: ({ attempt, delayMs }) => console.warn(`retry #${attempt} in ${delayMs}ms`),
});
```

**`CircuitBreaker`** — a standalone `closed → open → half-open` state machine:

```ts
import { CircuitBreaker } from "@kenzoobryan27/resilient-llm";

const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });

if (breaker.canAttempt()) {
  try {
    await call();
    breaker.success();
  } catch {
    breaker.failure();
  }
}

breaker.getState(); // { state: "closed" | "open" | "half-open", failures, nextAttemptAt }
```

**`parseSSE`** — turn a raw SSE `ReadableStream` into parsed `{ event?, data }` events, chunk-boundary-safe:

```ts
import { parseSSE } from "@kenzoobryan27/resilient-llm";

const response = await fetch(url, { headers: { accept: "text/event-stream" } });
for await (const { event, data } of parseSSE(response.body!)) {
  console.log(event, data);
}
```

## Bringing your own provider

`anthropic()` and `openai()` are just implementations of one small interface. Point them at a proxy with `baseUrl`, or implement `Provider` yourself for any other API:

```ts
import type { Provider } from "@kenzoobryan27/resilient-llm";
import { resilientCall, LLMError } from "@kenzoobryan27/resilient-llm";

const mistral: Provider = {
  name: "mistral",
  async call({ messages, signal }) {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "mistral-large-latest", messages }),
      signal,
    });
    if (!res.ok) {
      throw new LLMError(`mistral failed with ${res.status}`, {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
        provider: "mistral",
      });
    }
    const data = await res.json();
    return { text: data.choices[0].message.content, provider: "mistral", raw: data };
  },
};

await resilientCall({ providers: [mistral], messages: [...], timeoutMs: 20_000, retry: {...}, breaker: {...} });
```

Point either built-in adapter at a self-hosted or proxied endpoint with `baseUrl`:

```ts
anthropic({ apiKey, model, baseUrl: "https://my-proxy.internal" });
```

## How it works

```
            ┌───────────────────────────────────────────────┐
 call ────► │ resilientCall(options)                         │
            │                                               │
            │  for each provider (fallback):                │
            │    ├─ circuit open? ──► skip to next           │
            │    └─ retry loop:                              │
            │         ├─ timeout (AbortController)           │
            │         ├─ success ──► breaker.success()       │
            │         └─ failure ──► breaker.failure()       │
            │               ├─ retryable: wait               │
            │               │  (backoff + jitter), retry     │
            │               └─ non-retryable: stop            │
            └───────────────────────────────────────────────┘
```

- **Timeout**: each attempt is aborted with `AbortController`.
- **Retry**: only transient errors (timeouts, 429, 5xx), exponential backoff with full jitter, honors `Retry-After`.
- **Circuit breaker**: closed → open after N consecutive failures → half-open trial → closed on success, or open again on failure. One breaker per provider instance.
- **Fallback**: tries the next provider when one is exhausted (retries used up) or its circuit is open. A non-retryable error fails immediately without falling back.
- **Streaming**: `parseSSE` reads a `ReadableStream` byte-by-byte and yields complete events, even when the network splits an event across multiple chunks.

## Design decisions

- **Why full jitter, not fixed backoff** — if many clients fail at the same moment and retry after exactly the same delay, they all hit the server again together (a "retry storm"). Random jitter spreads retries out over time.
- **Why one circuit breaker per provider** — a failing provider should not block requests to a healthy one. The breaker is keyed by the provider object's identity, so it persists across calls as long as you reuse the same `anthropic(...)` / `openai(...)` instance.
- **Why no official SDK** — fewer dependencies to audit and update, full control over error mapping and streaming, and both APIs only need `fetch` and a JSON body.
- **Why a non-retryable error skips fallback** — a 400 or 401 usually means the request itself (or the credentials) is wrong, not that the provider is down. Retrying it on a different provider would just fail again and hide the real bug.

See [SPEC.md](SPEC.md) for the original build spec, checklists and step-by-step plan this library was built from.

## Testing this library

Two layers of tests back this package:

- **Unit tests** (`test/*.test.ts`) — every module in isolation, with mocked `fetch` and Vitest fake timers for the timing-sensitive parts (backoff, circuit breaker, retries).
- **Integration tests** (`test/integration.test.ts`) — the same behavior verified against a real `node:http` server on localhost: real timeouts and aborts, real retries, a real `Retry-After` wait, real circuit-breaker-open-then-fallback, real connection-refused errors, and real chunked SSE bytes split mid-event.

```bash
npm install
npm test          # unit + integration, 70+ tests
npm run lint
npm run typecheck
npm run build
```

No test ever calls a real LLM API — everything is mocked or served locally.

## What's next

- Metrics export (Prometheus/OpenTelemetry) instead of just hooks.
- A token/cost budget per call.
- Idempotency keys for operations that must not run twice.

## License

MIT — see [LICENSE](LICENSE).
