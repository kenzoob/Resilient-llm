export interface SSEEvent {
  event?: string | undefined;
  data: string;
}

function parseEventBlock(block: string): SSEEvent | undefined {
  const lines = block.split("\n");
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return { event, data: dataLines.join("\n") };
}

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEventBlock(rawEvent);
        if (parsed) {
          yield parsed;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim() !== "") {
      const parsed = parseEventBlock(buffer);
      if (parsed) {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
