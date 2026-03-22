import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type PluginHostResponder = (
  request: IncomingMessage,
  body: string
) => Promise<unknown> | unknown;

export interface PluginHostHarness {
  start(responder: PluginHostResponder): Promise<{
    endpointUrl: string;
    server: Server;
  }>;
  cleanup(): Promise<void>;
}

export function createPluginHostHarness(): PluginHostHarness {
  const servers: Server[] = [];

  return {
    async start(responder) {
      const server = createServer(async (request, response) => {
        await handleJsonRequest(request, response, async (body) => responder(request, body));
      });
      servers.push(server);

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });

      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected a TCP address from the fake plugin server.");
      }

      return {
        server,
        endpointUrl: `http://127.0.0.1:${address.port}/bridge/call`
      };
    },
    async cleanup() {
      while (servers.length > 0) {
        await closeServer(servers.pop()!);
      }
    }
  };
}

export async function handleJsonRequest(
  request: IncomingMessage,
  response: ServerResponse,
  responder: (body: string) => Promise<unknown>
): Promise<void> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const payload = await responder(Buffer.concat(chunks).toString("utf8"));

  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
