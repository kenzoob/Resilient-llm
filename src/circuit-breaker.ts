export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  nextAttemptAt: number | undefined;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private nextAttemptAt: number | undefined;
  private halfOpenTrialInFlight = false;

  constructor(private readonly options: CircuitBreakerOptions) {}

  canAttempt(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      if (this.nextAttemptAt !== undefined && Date.now() >= this.nextAttemptAt) {
        this.state = "half-open";
        this.halfOpenTrialInFlight = true;
        return true;
      }
      return false;
    }

    if (this.halfOpenTrialInFlight) {
      return false;
    }
    this.halfOpenTrialInFlight = true;
    return true;
  }

  success(): void {
    const wasOpenOrHalfOpen = this.state !== "closed";
    this.state = "closed";
    this.failures = 0;
    this.nextAttemptAt = undefined;
    this.halfOpenTrialInFlight = false;
    if (wasOpenOrHalfOpen) {
      this.options.onClose?.();
    }
  }

  failure(): void {
    if (this.state === "half-open") {
      this.open();
      return;
    }

    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.open();
    }
  }

  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failures: this.failures,
      nextAttemptAt: this.nextAttemptAt,
    };
  }

  private open(): void {
    this.state = "open";
    this.halfOpenTrialInFlight = false;
    this.nextAttemptAt = Date.now() + this.options.resetTimeoutMs;
    this.options.onOpen?.();
  }
}
