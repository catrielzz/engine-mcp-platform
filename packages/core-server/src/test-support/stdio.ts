import { PassThrough } from "node:stream";

import type {
  JSONRPCMessage,
  LoggingMessageNotification
} from "@modelcontextprotocol/sdk/types.js";

import {
  createInMemoryJournalService,
  startCoreServerStdio,
  type EngineMcpJournalService,
  type EngineMcpAdapterRegistry,
  type EngineMcpCapabilityAdapter,
  type EngineMcpStdioServerOptions
} from "../index.js";

export class JsonRpcMessageCollector {
  readonly messages: JSONRPCMessage[] = [];

  private buffer = "";
  private readonly waiters: Array<{
    label: string;
    predicate: (message: any) => boolean;
    resolve: (message: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  constructor(stream: PassThrough) {
    stream.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString();

      while (true) {
        const newlineIndex = this.buffer.indexOf("\n");

        if (newlineIndex === -1) {
          break;
        }

        const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newlineIndex + 1);

        if (line.length === 0) {
          continue;
        }

        const message = JSON.parse(line) as JSONRPCMessage;
        this.messages.push(message);
        this.resolveWaiters(message);
      }
    });
  }

  waitFor<TMessage = any>(
    label: string,
    predicate: (message: any) => boolean,
    timeoutMs = 2_000
  ): Promise<TMessage> {
    const existingMessage = this.messages.find(predicate);

    if (existingMessage) {
      return Promise.resolve(existingMessage as TMessage);
    }

    return new Promise<TMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Timed out waiting for ${label}. Messages seen: ${JSON.stringify(this.messages, null, 2)}`
          )
        );
      }, timeoutMs);

      this.waiters.push({
        label,
        predicate,
        resolve: resolve as any,
        reject,
        timeout
      });
    });
  }

  private resolveWaiters(message: JSONRPCMessage): void {
    const resolvedWaiters = this.waiters.filter(({ predicate }) => predicate(message));
    this.waiters.splice(
      0,
      this.waiters.length,
      ...this.waiters.filter(({ predicate }) => !predicate(message))
    );

    for (const waiter of resolvedWaiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    }
  }
}

export interface StdioHarness {
  readonly collector: JsonRpcMessageCollector;
  initialize(): Promise<JSONRPCMessage>;
  request(method: string, params?: Record<string, unknown>, id?: string): Promise<JSONRPCMessage>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  respond(
    id: string | number | null,
    response: {
      result?: unknown;
      error?: {
        code: number;
        message: string;
        data?: unknown;
      };
    }
  ): Promise<void>;
  selectAdapter(adapterName: string): Promise<void>;
  sendLoggingMessage(params: LoggingMessageNotification["params"]): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(
  options: {
    adapter?: EngineMcpCapabilityAdapter;
    adapterRegistry?: EngineMcpAdapterRegistry;
    adapterName?: string;
    clientCapabilities?: Record<string, unknown>;
    conformancePreflight?: EngineMcpStdioServerOptions["conformancePreflight"];
    experimentalTasks?: EngineMcpStdioServerOptions["experimentalTasks"];
    journalService?: EngineMcpJournalService;
    unityBridge?: EngineMcpStdioServerOptions["unityBridge"];
  } = {}
): Promise<StdioHarness> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const collector = new JsonRpcMessageCollector(stdout);
  const runtime = await startCoreServerStdio({
    stdin,
    stdout,
    adapter: options.adapter,
    adapterRegistry: options.adapterRegistry,
    adapterName: options.adapterName,
    conformancePreflight: options.conformancePreflight,
    experimentalTasks: options.experimentalTasks,
    journalService: options.journalService ?? createInMemoryJournalService(),
    unityBridge: options.unityBridge
  });

  let requestCounter = 0;

  async function send(message: Record<string, unknown>): Promise<void> {
    stdin.write(`${JSON.stringify(message)}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return {
    collector,
    async initialize(): Promise<JSONRPCMessage> {
      const responsePromise = collector.waitFor(
        "initialize response",
        (message) => "id" in message && message.id === "init-1" && "result" in message
      );

      await send({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: options.clientCapabilities ?? {},
          clientInfo: {
            name: "vitest",
            version: "1.0.0"
          }
        }
      });

      const response = await responsePromise;

      await send({
        jsonrpc: "2.0",
        method: "notifications/initialized"
      });

      return response;
    },
    async request(
      method: string,
      params: Record<string, unknown> = {},
      id = `req-${String(++requestCounter).padStart(4, "0")}`
    ): Promise<JSONRPCMessage> {
      const responsePromise = collector.waitFor(
        `${method} response`,
        (message) => "id" in message && message.id === id && ("result" in message || "error" in message)
      );

      await send({
        jsonrpc: "2.0",
        id,
        method,
        params
      });

      return responsePromise;
    },
    async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
      await send({
        jsonrpc: "2.0",
        method,
        params
      });
    },
    async respond(id, response): Promise<void> {
      await send({
        jsonrpc: "2.0",
        id,
        ...(response.error !== undefined
          ? {
              error: response.error
            }
          : {
              result: response.result ?? {}
            })
      });
    },
    async selectAdapter(adapterName: string): Promise<void> {
      await runtime.selectAdapter(adapterName);
    },
    async sendLoggingMessage(params: LoggingMessageNotification["params"]): Promise<void> {
      await runtime.sendLoggingMessage(params);
    },
    async close(): Promise<void> {
      stdin.end();
      stdout.end();
      await runtime.close();
    }
  };
}

export function expectResultMessage<T = any>(
  message: JSONRPCMessage
): {
  result: T;
} {
  if (!("result" in message)) {
    throw new Error("Expected a JSON-RPC result response.");
  }

  return message as {
    result: T;
  };
}

export function expectErrorMessage(
  message: JSONRPCMessage
): {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
} {
  if (!("error" in message)) {
    throw new Error("Expected a JSON-RPC error response.");
  }

  return message as {
    error: {
      code: number;
      message: string;
      data?: unknown;
    };
  };
}
