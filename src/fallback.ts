import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker";
import { LLMError, isRetryable } from "./errors";
import { withRetry, type RetryInfo, type RetryOptions } from "./retry";
import { withTimeout } from "./timeout";
import type { ChatMessage, Provider } from "./providers/shared";

export interface ResilientCallHooks {
  onRetry?: (info: RetryInfo & { provider: string }) => void;
  onCircuitOpen?: (info: { provider: string }) => void;
  onCircuitClose?: (info: { provider: string }) => void;
  onFallback?: (info: { from: string; to: string }) => void;
}

export interface ResilientCallOptions {
  providers: Provider[];
  messages: ChatMessage[];
  timeoutMs: number;
  retry: Pick<RetryOptions, "retries" | "baseDelayMs" | "maxDelayMs">;
  breaker: Pick<CircuitBreakerOptions, "failureThreshold" | "resetTimeoutMs">;
  hooks?: ResilientCallHooks;
}

export interface ResilientCallResult {
  text: string;
  provider: string;
}

const breakers = new WeakMap<Provider, CircuitBreaker>();

function getBreaker(
  provider: Provider,
  options: ResilientCallOptions["breaker"],
  hooks: ResilientCallHooks | undefined,
): CircuitBreaker {
  let breaker = breakers.get(provider);
  if (!breaker) {
    breaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold,
      resetTimeoutMs: options.resetTimeoutMs,
      onOpen: () => hooks?.onCircuitOpen?.({ provider: provider.name }),
      onClose: () => hooks?.onCircuitClose?.({ provider: provider.name }),
    });
    breakers.set(provider, breaker);
  }
  return breaker;
}

export async function resilientCall(options: ResilientCallOptions): Promise<ResilientCallResult> {
  let lastError: unknown = new LLMError("No providers configured", { retryable: false });

  for (let i = 0; i < options.providers.length; i++) {
    const provider = options.providers[i];
    if (!provider) {
      continue;
    }
    const breaker = getBreaker(provider, options.breaker, options.hooks);

    if (!breaker.canAttempt()) {
      lastError = new LLMError(`Circuit open for provider "${provider.name}"`, {
        retryable: true,
        provider: provider.name,
      });
      notifyFallback(options, provider, i);
      continue;
    }

    try {
      const result = await withRetry(
        () =>
          withTimeout(
            (signal) => provider.call({ messages: options.messages, signal }),
            options.timeoutMs,
          ),
        {
          retries: options.retry.retries,
          baseDelayMs: options.retry.baseDelayMs,
          maxDelayMs: options.retry.maxDelayMs,
          onRetry: (info) => {
            breaker.failure();
            options.hooks?.onRetry?.({ ...info, provider: provider.name });
          },
        },
      );
      breaker.success();
      return { text: result.text, provider: provider.name };
    } catch (error) {
      breaker.failure();
      if (!isRetryable(error)) {
        throw error;
      }
      lastError = error;
      notifyFallback(options, provider, i);
    }
  }

  throw lastError;
}

function notifyFallback(
  options: ResilientCallOptions,
  current: Provider,
  currentIndex: number,
): void {
  const next = options.providers[currentIndex + 1];
  if (next) {
    options.hooks?.onFallback?.({ from: current.name, to: next.name });
  }
}
