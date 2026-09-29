import { LLMError, isRetryable } from "./errors";

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: LLMError;
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (info: RetryInfo) => void;
}

export function calculateBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.random() * cap;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.retries || !isRetryable(error)) {
        throw error;
      }

      const llmError = error as LLMError;
      const rawDelay = llmError.retryAfterMs ?? calculateBackoffMs(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
      );
      const delayMs = Math.min(rawDelay, options.maxDelayMs);

      attempt += 1;
      options.onRetry?.({ attempt, delayMs, error: llmError });
      await sleep(delayMs);
    }
  }
}
