import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts closed and allows attempts", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(breaker.getState().state).toBe("closed");
    expect(breaker.canAttempt()).toBe(true);
  });

  it("opens after the failure threshold is reached", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    breaker.failure();
    breaker.failure();
    expect(breaker.getState().state).toBe("closed");
    breaker.failure();
    expect(breaker.getState().state).toBe("open");
    expect(breaker.getState().failures).toBe(3);
  });

  it("fails fast while open, without allowing an attempt", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    breaker.failure();
    expect(breaker.getState().state).toBe("open");
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.canAttempt()).toBe(false);
  });

  it("moves to half-open after the reset timeout and allows exactly one trial call", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    breaker.failure();
    expect(breaker.canAttempt()).toBe(false);

    vi.advanceTimersByTime(1000);

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.getState().state).toBe("half-open");
    expect(breaker.canAttempt()).toBe(false);
  });

  it("closes after a successful half-open trial", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    breaker.failure();
    vi.advanceTimersByTime(1000);
    expect(breaker.canAttempt()).toBe(true);

    breaker.success();

    expect(breaker.getState().state).toBe("closed");
    expect(breaker.getState().failures).toBe(0);
    expect(breaker.canAttempt()).toBe(true);
  });

  it("reopens after a failed half-open trial", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    breaker.failure();
    vi.advanceTimersByTime(1000);
    expect(breaker.canAttempt()).toBe(true);

    breaker.failure();

    expect(breaker.getState().state).toBe("open");
    expect(breaker.canAttempt()).toBe(false);
  });

  it("resets the failure count on success while closed", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    breaker.failure();
    breaker.failure();
    breaker.success();
    expect(breaker.getState().failures).toBe(0);

    breaker.failure();
    breaker.failure();
    expect(breaker.getState().state).toBe("closed");
  });

  it("exposes the reopen date while open", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    const before = Date.now();
    breaker.failure();
    const state = breaker.getState();
    expect(state.nextAttemptAt).toBe(before + 5000);
  });

  it("calls onOpen when the circuit opens and onClose when it closes", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      onOpen,
      onClose,
    });

    breaker.failure();
    expect(onOpen).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    breaker.canAttempt();
    breaker.success();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
