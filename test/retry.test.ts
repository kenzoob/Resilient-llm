import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, type RetryInfo } from "../src/retry";
import { LLMError } from "../src/errors";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result immediately on first success, no retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 100, maxDelayMs: 1000 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds after 2 failures", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LLMError("server error", { status: 503, retryable: true }))
      .mockRejectedValueOnce(new LLMError("server error", { status: 503, retryable: true }))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { retries: 3, baseDelayMs: 100, maxDelayMs: 1000 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400", async () => {
    const err = new LLMError("bad request", { status: 400, retryable: false });
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, { retries: 3, baseDelayMs: 100, maxDelayMs: 1000 });
    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after the max number of retries and rejects with the last error", async () => {
    const err = new LLMError("server error", { status: 500, retryable: true });
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, { retries: 2, baseDelayMs: 10, maxDelayMs: 100 });
    const assertion = expect(promise).rejects.toBe(err);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects Retry-After on the error instead of computing backoff", async () => {
    const err = new LLMError("rate limited", {
      status: 429,
      retryable: true,
      retryAfterMs: 2000,
    });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    const promise = withRetry(fn, {
      retries: 3,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, delayMs: 2000, error: err }),
    );
  });

  it("caps the Retry-After delay at maxDelayMs", async () => {
    const err = new LLMError("rate limited", {
      status: 429,
      retryable: true,
      retryAfterMs: 10_000,
    });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    const promise = withRetry(fn, { retries: 3, baseDelayMs: 100, maxDelayMs: 3000, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 3000 }));
  });

  it("calls onRetry with attempt number and delay before each retry", async () => {
    const err = new LLMError("server error", { status: 500, retryable: true });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    const promise = withRetry(fn, { retries: 3, baseDelayMs: 50, maxDelayMs: 1000, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    const call = onRetry.mock.calls[0]?.[0] as RetryInfo;
    expect(call.attempt).toBe(1);
    expect(call.delayMs).toBeGreaterThanOrEqual(0);
    expect(call.delayMs).toBeLessThanOrEqual(50);
  });
});
