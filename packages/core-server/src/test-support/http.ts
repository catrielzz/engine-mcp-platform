import { request as httpRequest } from "node:http";

import type { EventStore } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export async function readJson<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

export async function deleteRequest(
  url: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "DELETE",
    headers: {
      accept: "application/json",
      ...headers
    }
  });
}

export async function getJson(
  url: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...headers
    }
  });
}

export async function readTextStreamUntil(
  stream: ReadableStream<Uint8Array> | null,
  pattern: string,
  timeoutMs = 2_000
): Promise<string> {
  if (!stream) {
    throw new Error("Expected a readable response body.");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const timeout = setTimeout(() => {
    void reader.cancel("Timed out waiting for SSE payload.");
  }, timeoutMs);
  let collected = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        throw new Error(`Stream ended before receiving "${pattern}". Received: ${collected}`);
      }

      collected += decoder.decode(value, { stream: true });

      if (collected.includes(pattern)) {
        return collected;
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
}

export function createTextStreamReader(stream: ReadableStream<Uint8Array> | null): {
  readUntil(pattern: string, timeoutMs?: number, occurrence?: number): Promise<string>;
  close(): Promise<void>;
} {
  if (!stream) {
    throw new Error("Expected a readable response body.");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let collected = "";

  return {
    async readUntil(pattern: string, timeoutMs = 2_000, occurrence = 1): Promise<string> {
      if (countOccurrences(collected, pattern) >= occurrence) {
        return collected;
      }

      const timeout = setTimeout(() => {
        void reader.cancel("Timed out waiting for SSE payload.");
      }, timeoutMs);

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            throw new Error(
              `Stream ended before receiving "${pattern}". Received: ${collected}`
            );
          }

          collected += decoder.decode(value, { stream: true });

          if (countOccurrences(collected, pattern) >= occurrence) {
            return collected;
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    async close(): Promise<void> {
      await reader.cancel().catch(() => undefined);
    }
  };
}

export function extractSseRequestByMethod<TParams = any>(
  sseBody: string,
  method: string
): {
  id: number;
  method: string;
  params?: TParams;
} {
  const events = sseBody.split("\n\n");

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (!event.includes(`\"method\":\"${method}\"`)) {
      continue;
    }

    const dataLine = event
      .split("\n")
      .find((line) => line.startsWith("data: {") && line.includes(`\"method\":\"${method}\"`));

    if (!dataLine) {
      continue;
    }

    const message = JSON.parse(dataLine.slice(6)) as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
    };

    if (typeof message.id !== "number") {
      throw new Error(`Expected SSE request for ${method} to include a numeric id.`);
    }

    if (message.method !== method) {
      continue;
    }

    return {
      id: message.id,
      method,
      params:
        message.params && typeof message.params === "object" && !Array.isArray(message.params)
          ? (message.params as TParams)
          : undefined
    };
  }

  throw new Error(`Unable to find SSE request for ${method}. Body: ${sseBody}`);
}

export async function rawPostWithHostHeader(options: {
  host: string;
  port: number;
  path: string;
  hostHeader: string;
  origin?: string;
  authorization?: string;
  body: Record<string, unknown>;
}): Promise<{
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  const payload = JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method: "POST",
        host: options.host,
        port: options.port,
        path: options.path,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload).toString(),
          host: options.hostHeader,
          ...(options.origin ? { origin: options.origin } : {}),
          ...(options.authorization ? { authorization: options.authorization } : {})
        }
      },
      (res) => {
        let responseBody = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: responseBody,
            headers: res.headers
          });
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export function createRecordingEventStore() {
  const events = new Map<string, Array<{ eventId: string; message: unknown }>>();
  const streamIdByEventId = new Map<string, string>();
  const replayCalls: string[] = [];
  let counter = 0;

  const eventStore: EventStore = {
    async storeEvent(streamId, message) {
      counter += 1;
      const eventId = `event-${String(counter).padStart(4, "0")}`;
      const existing = events.get(streamId) ?? [];
      existing.push({ eventId, message });
      events.set(streamId, existing);
      streamIdByEventId.set(eventId, streamId);
      return eventId;
    },
    async getStreamIdForEventId(eventId) {
      return streamIdByEventId.get(eventId);
    },
    async replayEventsAfter(lastEventId, { send }) {
      replayCalls.push(lastEventId);
      const streamId = streamIdByEventId.get(lastEventId);

      if (!streamId) {
        throw new Error("Unknown event id");
      }

      const streamEvents = events.get(streamId) ?? [];
      const startIndex = streamEvents.findIndex(({ eventId }) => eventId === lastEventId);

      for (const event of streamEvents.slice(startIndex + 1)) {
        await send(event.eventId, event.message as never);
      }

      return streamId;
    }
  };

  return {
    eventStore,
    replayCalls
  };
}

export function readWwwAuthenticateParameter(
  headerValue: string | null,
  parameterName: string
): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const match = new RegExp(`${parameterName}=\"([^\"]+)\"`).exec(headerValue);
  return match?.[1];
}

export function countOccurrences(text: string, pattern: string): number {
  if (pattern.length === 0) {
    return 0;
  }

  let count = 0;
  let searchIndex = 0;

  while (true) {
    const matchIndex = text.indexOf(pattern, searchIndex);

    if (matchIndex === -1) {
      return count;
    }

    count += 1;
    searchIndex = matchIndex + pattern.length;
  }
}
