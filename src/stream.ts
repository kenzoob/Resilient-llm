import { LLMError } from "./errors";
import type { ChatMessage, Provider } from "./providers/shared";

export interface StreamTextOptions {
  provider: Provider;
  messages: ChatMessage[];
  signal: AbortSignal;
}

export async function* streamText(
  options: StreamTextOptions,
): AsyncGenerator<string, void, unknown> {
  if (!options.provider.stream) {
    throw new LLMError(`Provider "${options.provider.name}" does not support streaming`, {
      retryable: false,
      provider: options.provider.name,
    });
  }

  yield* options.provider.stream({ messages: options.messages, signal: options.signal });
}
