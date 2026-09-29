import { anthropic, openai, streamText, type ChatMessage, type Provider } from "../src/index";

function pickProvider(): Provider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return anthropic({
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return openai({ apiKey: openaiKey, model: process.env.OPENAI_MODEL ?? "gpt-4o" });
  }

  console.error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY (see .env.example).");
  process.exit(1);
}

async function main(): Promise<void> {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error('Usage: npx tsx examples/chat.ts "your prompt"');
    process.exit(1);
  }

  const provider = pickProvider();
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const controller = new AbortController();

  for await (const chunk of streamText({ provider, messages, signal: controller.signal })) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
