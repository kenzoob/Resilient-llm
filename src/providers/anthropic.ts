import { parseSSE } from "../sse";
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

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

const PROVIDER_NAME = "anthropic";

function buildRequestInit(
  config: AnthropicConfig,
  messages: ProviderCallOptions["messages"],
  signal: AbortSignal,
  stream: boolean,
): RequestInit {
  return {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens ?? 1024,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      stream,
    }),
    signal,
  };
}

export function anthropic(config: AnthropicConfig): Provider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com";
  const url = `${baseUrl}/v1/messages`;

  return {
    name: PROVIDER_NAME,
    async call({ messages, signal }: ProviderCallOptions) {
      const response = await fetchJson(
        url,
        buildRequestInit(config, messages, signal, false),
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

    async *stream({ messages, signal }: ProviderCallOptions) {
      const response = await fetchJson(
        url,
        buildRequestInit(config, messages, signal, true),
        PROVIDER_NAME,
      );

      if (!response.ok) {
        throw await mapHttpError(response, PROVIDER_NAME);
      }
      if (!response.body) {
        return;
      }

      for await (const event of parseSSE(response.body)) {
        let payload: AnthropicStreamEvent;
        try {
          payload = JSON.parse(event.data) as AnthropicStreamEvent;
        } catch {
          continue;
        }
        if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
          const text = payload.delta.text;
          if (text) {
            yield text;
          }
        }
      }
    },
  };
}
