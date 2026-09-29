import { LLMError, parseRetryAfter } from "../errors";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ProviderCallOptions {
  messages: ChatMessage[];
  signal: AbortSignal;
}

export interface ProviderResult {
  text: string;
  provider: string;
  raw: unknown;
}

export interface Provider {
  name: string;
  call: (options: ProviderCallOptions) => Promise<ProviderResult>;
  stream?: (options: ProviderCallOptions) => AsyncGenerator<string, void, unknown>;
}

interface ErrorBody {
  error?: { message?: string };
}

export async function mapHttpError(response: Response, provider: string): Promise<LLMError> {
  const status = response.status;
  const retryable = status === 429 || (status >= 500 && status <= 599);
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));

  let message = `${provider} request failed with status ${status}`;
  try {
    const body = (await response.json()) as ErrorBody;
    if (body.error?.message) {
      message = body.error.message;
    }
  } catch {
    // response body is not JSON or already consumed; keep the default message
  }

  return new LLMError(message, { status, retryable, provider, retryAfterMs });
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  provider: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const signal = init.signal;
    if (signal instanceof AbortSignal && signal.aborted) {
      throw error;
    }
    throw new LLMError(`${provider} request failed: network error`, {
      retryable: true,
      provider,
      cause: error,
    });
  }
}
