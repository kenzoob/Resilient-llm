import { fetchJson, mapHttpError, type Provider, type ProviderCallOptions } from "./shared";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
}

const PROVIDER_NAME = "anthropic";

export function anthropic(config: AnthropicConfig): Provider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com";

  return {
    name: PROVIDER_NAME,
    async call({ messages, signal }: ProviderCallOptions) {
      const response = await fetchJson(
        `${baseUrl}/v1/messages`,
        {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxTokens ?? 1024,
            messages: messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
          signal,
        },
        PROVIDER_NAME,
      );

      if (!response.ok) {
        throw await mapHttpError(response, PROVIDER_NAME);
      }

      const data = (await response.json()) as AnthropicResponse;
      const text = data.content
        .filter((block) => block.type === "text" && block.text !== undefined)
        .map((block) => block.text)
        .join("");

      return { text, provider: PROVIDER_NAME, raw: data };
    },
  };
}
