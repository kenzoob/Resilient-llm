# resilient-llm

![CI](https://github.com/kenzoob/Resilient-llm/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/@kenzoobryan27/resilient-llm)

Make LLM API calls production-ready: timeouts, retries with backoff and jitter, circuit breakers, provider fallback and SSE streaming. Zero runtime dependencies.

## Why

LLM APIs fail in predictable ways: rate limits (429), temporary outages (5xx) and hanging requests. Without protection, your app waits forever, crashes, or keeps hammering a service that is already down.

`resilient-llm` wraps any call and makes it robust, without depending on a specific provider.

## Install

```bash
npm install @kenzoobryan27/resilient-llm
```

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
  hooks: {
    onRetry: ({ attempt, delayMs, error }) => console.warn(`retry #${attempt} in ${delayMs}ms`, error.message),
    onFallback: ({ from, to }) => console.warn(`falling back from ${from} to ${to}`),
  },
});

console.log(result.text, result.provider);
```

Model names change often: keep them in environment variables, never hardcoded.

### Streaming

```ts
import { anthropic, streamText } from "@kenzoobryan27/resilient-llm";

const provider = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, model: process.env.ANTHROPIC_MODEL! });
const controller = new AbortController();

for await (const chunk of streamText({
  provider,
  messages: [{ role: "user", content: "Explain RAG in one sentence" }],
  signal: controller.signal,
})) {
  process.stdout.write(chunk);
}
```

Or from the CLI:

```bash
npx tsx examples/chat.ts "Explain RAG in one sentence"
```

## How it works

- **Timeout**: each attempt is aborted with `AbortController`.
- **Retry**: only transient errors (timeouts, 429, 5xx), exponential backoff with full jitter, honors `Retry-After`. Never retries a 400 or 401.
- **Circuit breaker**: closed → open after N failures → half-open trial → closed. One breaker per provider.
- **Fallback**: tries the next provider when one is exhausted (retries used up) or its circuit is open. Non-retryable errors fail fast without falling back.
- **Streaming**: an async generator parses SSE events (handling chunks split mid-event) and yields text deltas as they arrive.

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

## Design decisions

- **Why full jitter**: if many clients fail at the same time and retry after exactly the same delay, they all hit the server again together. Random jitter spreads the retries out.
- **Why one breaker per provider**: a failing provider should not block the others.
- **Why no SDK**: fewer dependencies, full control over errors and streaming, and `fetch` is all the Anthropic and OpenAI APIs need.

## API

- `resilientCall(options)` — orchestrates timeout, retry, circuit breaker and fallback across a list of providers.
- `anthropic(config)` / `openai(config)` — adapters built on `fetch`, no SDK.
- `streamText({ provider, messages, signal })` — async generator of text chunks for a single provider.
- `CircuitBreaker` — standalone state machine (`closed` → `open` → `half-open`), exposes `getState()`.
- `withRetry`, `withTimeout`, `parseSSE` — the individual building blocks, usable on their own.
- `LLMError`, `isRetryable`, `parseRetryAfter` — error type and helpers shared across the library.

See [SPEC.md](SPEC.md) for the full build spec, checklists and architecture notes.

## Development

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

## License

MIT
