import { parseSSE } from "../sse";
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

interface OpenAIStreamChunk {
  choices?: { delta?: { content?: string } }[];
}

const PROVIDER_NAME = "openai";

function buildRequestInit(
  config: OpenAIConfig,
  messages: ProviderCallOptions["messages"],
  signal: AbortSignal,
  stream: boolean,
): RequestInit {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    stream,
  };
  if (config.maxTokens !== undefined) {
    body.max_tokens = config.maxTokens;
  }

  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  };
}

export function openai(config: OpenAIConfig): Provider {
  const baseUrl = config.baseUrl ?? "https://api.openai.com";
  const url = `${baseUrl}/v1/chat/completions`;

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

      const data = (await response.json()) as OpenAIResponse;
      const text = data.choices[0]?.message.content ?? "";

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
        if (event.data.trim() === "[DONE]") {
          return;
        }
        let payload: OpenAIStreamChunk;
        try {
          payload = JSON.parse(event.data) as OpenAIStreamChunk;
        } catch {
          continue;
        }
        const text = payload.choices?.[0]?.delta?.content;
        if (text) {
          yield text;
        }
      }
    },
  };
}
