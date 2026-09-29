import { fetchJson, mapHttpError, type Provider, type ProviderCallOptions } from "./shared";

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  baseUrl?: string;
}

interface OpenAIChoice {
  message: { role: string; content: string | null };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

const PROVIDER_NAME = "openai";

export function openai(config: OpenAIConfig): Provider {
  const baseUrl = config.baseUrl ?? "https://api.openai.com";

  return {
    name: PROVIDER_NAME,
    async call({ messages, signal }: ProviderCallOptions) {
      const body: Record<string, unknown> = {
        model: config.model,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      };
      if (config.maxTokens !== undefined) {
        body.max_tokens = config.maxTokens;
      }

      const response = await fetchJson(
        `${baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        },
        PROVIDER_NAME,
      );

      if (!response.ok) {
        throw await mapHttpError(response, PROVIDER_NAME);
      }

      const data = (await response.json()) as OpenAIResponse;
      const text = data.choices[0]?.message.content ?? "";

      return { text, provider: PROVIDER_NAME, raw: data };
    },
  };
}
