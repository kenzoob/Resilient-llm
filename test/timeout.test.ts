import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withTimeout } from "../src/timeout";
import { LLMError } from "../src/errors";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when the function finishes before the timeout", async () => {
    const promise = withTimeout((signal) => {
      expect(signal.aborted).toBe(false);
      return Promise.resolve("ok");
    }, 1000);
    await expect(promise).resolves.toBe("ok");
  });

  it("rejects with a retryable LLMError when the function does not finish in time", async () => {
    const promise = withTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      1000,
    );

    const assertion = expect(promise).rejects.toBeInstanceOf(LLMError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("aborts the signal passed to the function once the timeout elapses", async () => {
    let sawAbort = false;
    const promise = withTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(new Error("aborted"));
          });
        }),
      500,
    );
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(500);
    expect(sawAbort).toBe(true);
  });

  it("marks the timeout error as retryable", async () => {
    const promise = withTimeout(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      100,
    );
    promise.catch(() => undefined);

    const assertion = promise.catch((err: unknown) => err as LLMError);
    await vi.advanceTimersByTimeAsync(100);
    const err = await assertion;
    expect(err.retryable).toBe(true);
  });

  it("propagates a rejection from the function itself, not a timeout", async () => {
    const promise = withTimeout(() => Promise.reject(new Error("boom")), 1000);
    await expect(promise).rejects.toThrow("boom");
  });
});
