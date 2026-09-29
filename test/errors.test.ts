import { describe, it, expect } from "vitest";
import { LLMError, isRetryable, parseRetryAfter } from "../src/errors";

describe("LLMError", () => {
  it("stores message, status and retryable flag", () => {
    const err = new LLMError("rate limited", { status: 429, retryable: true });
    expect(err.message).toBe("rate limited");
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults retryable to false when not provided", () => {
    const err = new LLMError("bad request", { status: 400 });
    expect(err.retryable).toBe(false);
  });

  it("carries an optional provider name", () => {
    const err = new LLMError("boom", { status: 500, retryable: true, provider: "anthropic" });
    expect(err.provider).toBe("anthropic");
  });
});

describe("isRetryable", () => {
  it("returns true for a 429", () => {
    expect(isRetryable(new LLMError("rate limited", { status: 429, retryable: true }))).toBe(true);
  });

  it("returns true for 500-599", () => {
    expect(isRetryable(new LLMError("server error", { status: 503, retryable: true }))).toBe(true);
    expect(isRetryable(new LLMError("server error", { status: 599, retryable: true }))).toBe(true);
  });

  it("returns false for a 400", () => {
    expect(isRetryable(new LLMError("bad request", { status: 400, retryable: false }))).toBe(false);
  });

  it("returns false for a 401", () => {
    expect(isRetryable(new LLMError("unauthorized", { status: 401, retryable: false }))).toBe(
      false,
    );
  });

  it("returns false for a plain Error", () => {
    expect(isRetryable(new Error("unknown"))).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("returns undefined for null header", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("parses a delay in seconds into milliseconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
  });

  it("parses an HTTP-date header into a millisecond delay", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it("returns undefined for an unparseable value", () => {
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });

  it("never returns a negative delay", () => {
    const past = new Date(Date.now() - 5000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });
});
