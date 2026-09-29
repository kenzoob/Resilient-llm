import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resilientCall } from "../src/fallback";
import { LLMError } from "../src/errors";
import type { Provider } from "../src/providers/shared";

function fakeProvider(name: string, call: Provider["call"]): Provider {
  return { name, call };
}

const baseOptions = {
  messages: [{ role: "user" as const, content: "hi" }],
  timeoutMs: 1000,
  retry: { retries: 2, baseDelayMs: 10, maxDelayMs: 100 },
  breaker: { failureThreshold: 3, resetTimeoutMs: 1000 },
};

describe("resilientCall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the text from the first provider on success", async () => {
    const provider = fakeProvider("p1", () =>
      Promise.resolve({ text: "hello", provider: "p1", raw: null }),
    );

    const result = await resilientCall({ ...baseOptions, providers: [provider] });
    expect(result).toEqual({ text: "hello", provider: "p1" });
  });

  it("retries a retryable failure on the same provider before succeeding", async () => {
    let calls = 0;
    const provider = fakeProvider("p1", () => {
      calls += 1;
      if (calls < 2) {
        return Promise.reject(new LLMError("server error", { status: 500, retryable: true }));
      }
      return Promise.resolve({ text: "ok", provider: "p1", raw: null });
    });

    const promise = resilientCall({ ...baseOptions, providers: [provider] });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ text: "ok", provider: "p1" });
    expect(calls).toBe(2);
  });

  it("falls back to the next provider once the first is exhausted", async () => {
    const p1 = fakeProvider("p1", () =>
      Promise.reject(new LLMError("down", { status: 500, retryable: true })),
    );
    const p2 = fakeProvider("p2", () =>
      Promise.resolve({ text: "from p2", provider: "p2", raw: null }),
    );
    const onFallback = vi.fn();

    const promise = resilientCall({
      ...baseOptions,
      providers: [p1, p2],
      hooks: { onFallback },
    });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ text: "from p2", provider: "p2" });
    expect(onFallback).toHaveBeenCalledWith({ from: "p1", to: "p2" });
  });

  it("does not fall back on a non-retryable error, but still rejects", async () => {
    const p1 = fakeProvider("p1", () =>
      Promise.reject(new LLMError("bad request", { status: 400, retryable: false })),
    );
    const p2Call = vi.fn<Provider["call"]>();
    const p2 = fakeProvider("p2", p2Call);

    await expect(
      resilientCall({ ...baseOptions, providers: [p1, p2] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(p2Call).not.toHaveBeenCalled();
  });

  it("skips a provider whose circuit is open and falls back", async () => {
    const p1 = fakeProvider("p1", () =>
      Promise.reject(new LLMError("down", { status: 500, retryable: true })),
    );
    const p2 = fakeProvider("p2", () =>
      Promise.resolve({ text: "from p2", provider: "p2", raw: null }),
    );

    const openBreakerOptions = {
      ...baseOptions,
      retry: { retries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      breaker: { failureThreshold: 1, resetTimeoutMs: 1000 },
    };

    await expect(
      resilientCall({ ...openBreakerOptions, providers: [p1, p2] }),
    ).resolves.toEqual({ text: "from p2", provider: "p2" });

    const p1CallSpy = vi.fn<Provider["call"]>(p1.call);
    p1.call = p1CallSpy;
    const secondResult = await resilientCall({
      ...openBreakerOptions,
      providers: [p1, p2],
    });
    expect(secondResult).toEqual({ text: "from p2", provider: "p2" });
    expect(p1CallSpy).not.toHaveBeenCalled();
  });

  it("calls onCircuitOpen when a provider's breaker trips", async () => {
    const onCircuitOpen = vi.fn();
    const p1 = fakeProvider("p1", () =>
      Promise.reject(new LLMError("down", { status: 500, retryable: true })),
    );
    const p2 = fakeProvider("p2", () =>
      Promise.resolve({ text: "from p2", provider: "p2", raw: null }),
    );

    await resilientCall({
      ...baseOptions,
      retry: { retries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      breaker: { failureThreshold: 1, resetTimeoutMs: 1000 },
      providers: [p1, p2],
      hooks: { onCircuitOpen },
    });

    expect(onCircuitOpen).toHaveBeenCalledWith({ provider: "p1" });
  });

  it("rejects with the last error when every provider is exhausted", async () => {
    const err1 = new LLMError("p1 down", { status: 500, retryable: true });
    const err2 = new LLMError("p2 down", { status: 500, retryable: true });
    const p1 = fakeProvider("p1", () => Promise.reject(err1));
    const p2 = fakeProvider("p2", () => Promise.reject(err2));

    const promise = resilientCall({ ...baseOptions, providers: [p1, p2] });
    const assertion = expect(promise).rejects.toBe(err2);
    await vi.runAllTimersAsync();
    await assertion;
  });
});
