import { LLMError } from "./errors";

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LLMError(`Timed out after ${timeoutMs}ms`, { retryable: true, cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
