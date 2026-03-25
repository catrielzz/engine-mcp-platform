import { randomUUID } from "node:crypto";
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isInitializeRequest, type LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

import {
  getDefaultAllowedHostnames,
  matchesPath,
  matchesProtectedResourceMetadataPath,
  normalizeHttpPath,
  resolveStreamableHttpAuthorization,
  validateAuthorization,
  validateHostHeader,
  validateOriginHeader
} from "./http-auth.js";
import { createProtocolServer } from "./protocol-server.js";
import { resolveCoreServerBootstrap, createRuntimeAdapterController } from "./runtime-bootstrap.js";
import { createInMemoryJournalService } from "./journal-service.js";
import { createInMemoryEventStore, hasEventStoreCleanup } from "./tasks.js";
import {
  DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENT_AGE_MS,
  DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS,
  DEFAULT_STREAMABLE_HTTP_HEADERS_TIMEOUT_MS,
  DEFAULT_STREAMABLE_HTTP_HOST,
  DEFAULT_STREAMABLE_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_STREAMABLE_HTTP_MAX_REQUEST_BODY_BYTES,
  DEFAULT_STREAMABLE_HTTP_PATH,
  DEFAULT_STREAMABLE_HTTP_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAMABLE_HTTP_SESSION_IDLE_TTL_MS,
  DEFAULT_STREAMABLE_HTTP_SESSION_SWEEP_INTERVAL_MS,
  createCoreServerAdapterRegistry,
  type EngineMcpAdapterSwitchOptions,
  type EngineMcpCapabilityAdapter,
  type EngineMcpConformancePreflightResult,
  type EngineMcpCoreServerOptions,
  type EngineMcpCoreServerRuntime,
  type EngineMcpHttpSession,
  type EngineMcpProtocolServerRuntime,
  type EngineMcpStdioServerOptions,
  type EngineMcpStdioServerRuntime,
  type EngineMcpStreamableHttpServerOptions,
  type EngineMcpStreamableHttpServerRuntime,
  type ResolvedStreamableHttpAuthorization
} from "../shared.js";

const defaultCoreServerAdapterRegistry = createCoreServerAdapterRegistry();
type TrackedHttpSession = {
  session: EngineMcpHttpSession;
  lastActivityAt: number;
  activeRequests: number;
  cleanup?: () => void;
};

export async function createCoreServer(
  options: EngineMcpCoreServerOptions = {}
): Promise<EngineMcpCoreServerRuntime> {
  const bootstrap = await resolveCoreServerBootstrap(options, defaultCoreServerAdapterRegistry);
  const journalService = options.journalService ?? createInMemoryJournalService();
  let protocolRuntime!: EngineMcpProtocolServerRuntime;
  const controller = createRuntimeAdapterController({
    bootstrap,
    unityBridge: options.unityBridge,
    onToolListChanged: async () => {
      await protocolRuntime.sendToolListChanged();
    },
    onPromptListChanged: async () => {
      await protocolRuntime.sendPromptListChanged();
    },
    onAdapterStateChanged: async () => {
      await protocolRuntime.sendToolListChanged();
      await protocolRuntime.sendAdapterStateUpdated();
    }
  });
  protocolRuntime = createProtocolServer({
    getAdapter: () => controller.getAdapter(),
    getAdapterStateResource: () => controller.getAdapterStateResource(),
    journalService,
    serverInfo: bootstrap.serverInfo,
    instructions: bootstrap.instructions,
    experimentalTasks: bootstrap.experimentalTasks
  });
  const server = protocolRuntime.server;

  return {
    server,
    get adapter(): EngineMcpCapabilityAdapter {
      return controller.getAdapter();
    },
    get adapterName(): string | undefined {
      return controller.getAdapterName();
    },
    availableAdapterNames: bootstrap.availableAdapterNames,
    get preflight(): EngineMcpConformancePreflightResult | undefined {
      return controller.getPreflight();
    },
    sendLoggingMessage(
      params: LoggingMessageNotification["params"],
      sessionId?: string
    ): Promise<void> {
      return server.sendLoggingMessage(params, sessionId);
    },
    notifyToolListChanged(): Promise<void> {
      return controller.notifyToolListChanged();
    },
    notifyPromptListChanged(): Promise<void> {
      return controller.notifyPromptListChanged();
    },
    replaceAdapter(
      adapter: EngineMcpCapabilityAdapter,
      adapterSwitchOptions?: EngineMcpAdapterSwitchOptions
    ): Promise<void> {
      return controller.replaceAdapter(adapter, adapterSwitchOptions);
    },
    selectAdapter(
      adapterName: string,
      adapterSwitchOptions?: Omit<EngineMcpAdapterSwitchOptions, "adapterName">
    ): Promise<void> {
      return controller.selectAdapter(adapterName, adapterSwitchOptions);
    },
    async close(): Promise<void> {
      await server.close();
      bootstrap.cleanup();
    }
  };
}

export async function startCoreServerStdio(
  options: EngineMcpStdioServerOptions = {}
): Promise<EngineMcpStdioServerRuntime> {
  const runtime = await createCoreServer(options);
  const transport = new StdioServerTransport(options.stdin, options.stdout);

  await runtime.server.connect(transport);

  return {
    ...runtime,
    transport
  };
}

export async function startCoreServerStreamableHttp(
  options: EngineMcpStreamableHttpServerOptions = {}
): Promise<EngineMcpStreamableHttpServerRuntime> {
  const bootstrap = await resolveCoreServerBootstrap(options, defaultCoreServerAdapterRegistry);
  const journalService = options.journalService ?? createInMemoryJournalService();
  const now = () => Date.now();
  const host = options.host ?? DEFAULT_STREAMABLE_HTTP_HOST;
  const path = normalizeHttpPath(options.path ?? DEFAULT_STREAMABLE_HTTP_PATH);
  const requestTimeoutMs = resolvePositiveIntegerOption(
    options.requestTimeoutMs,
    DEFAULT_STREAMABLE_HTTP_REQUEST_TIMEOUT_MS
  );
  const headersTimeoutMs = Math.min(
    resolvePositiveIntegerOption(
      options.headersTimeoutMs,
      DEFAULT_STREAMABLE_HTTP_HEADERS_TIMEOUT_MS
    ),
    requestTimeoutMs
  );
  const keepAliveTimeoutMs = resolvePositiveIntegerOption(
    options.keepAliveTimeoutMs,
    DEFAULT_STREAMABLE_HTTP_KEEP_ALIVE_TIMEOUT_MS
  );
  const sessionIdleTtlMs = resolvePositiveIntegerOption(
    options.sessionIdleTtlMs,
    DEFAULT_STREAMABLE_HTTP_SESSION_IDLE_TTL_MS
  );
  const sessionSweepIntervalMs = Math.min(
    resolvePositiveIntegerOption(
      options.sessionSweepIntervalMs,
      DEFAULT_STREAMABLE_HTTP_SESSION_SWEEP_INTERVAL_MS
    ),
    sessionIdleTtlMs
  );
  const maxRequestBodyBytes = resolvePositiveIntegerOption(
    options.maxRequestBodyBytes,
    DEFAULT_STREAMABLE_HTTP_MAX_REQUEST_BODY_BYTES
  );
  const allowedHosts = options.allowedHosts ?? getDefaultAllowedHostnames(host);
  const allowedOriginHosts = options.allowedOriginHosts ?? getDefaultAllowedHostnames(host);
  const sessions = new Map<string, TrackedHttpSession>();
  let authorization: ResolvedStreamableHttpAuthorization | undefined;
  const controller = createRuntimeAdapterController({
    bootstrap,
    unityBridge: options.unityBridge,
    onToolListChanged: async () => {
      await Promise.all(
        [...sessions.values()].map((trackedSession) =>
          trackedSession.session.runtime.sendToolListChanged().catch(() => undefined)
        )
      );
    },
    onPromptListChanged: async () => {
      await Promise.all(
        [...sessions.values()].map((trackedSession) =>
          trackedSession.session.runtime.sendPromptListChanged().catch(() => undefined)
        )
      );
    },
    onAdapterStateChanged: async () => {
      await Promise.all(
        [...sessions.values()].flatMap((trackedSession) => [
          trackedSession.session.runtime.sendToolListChanged().catch(() => undefined),
          trackedSession.session.runtime.sendAdapterStateUpdated().catch(() => undefined)
        ])
      );
    }
  });

  async function closeSession(sessionId: string): Promise<void> {
    const trackedSession = sessions.get(sessionId);

    if (!trackedSession) {
      return;
    }

    sessions.delete(sessionId);
    try {
      await trackedSession.session.transport.close().catch(() => undefined);
    } finally {
      trackedSession.cleanup?.();
    }
  }

  async function sweepIdleSessions(): Promise<void> {
    const cutoff = now() - sessionIdleTtlMs;
    const expiredSessionIds = [...sessions.entries()]
      .filter(([, trackedSession]) => {
        return trackedSession.activeRequests === 0 && trackedSession.lastActivityAt <= cutoff;
      })
      .map(([sessionId]) => sessionId);

    await Promise.all(expiredSessionIds.map((sessionId) => closeSession(sessionId)));
  }

  const sessionSweepTimer = setInterval(() => {
    void sweepIdleSessions();
  }, sessionSweepIntervalMs);
  sessionSweepTimer.unref();

  const httpServer = createNodeHttpServer(async (request, response) => {
    try {
      const hostValidationError = validateHostHeader(request, allowedHosts);

      if (hostValidationError) {
        writeJsonRpcError(response, 403, "Forbidden", hostValidationError);
        return;
      }

      const originValidationError = validateOriginHeader(request, allowedOriginHosts);

      if (originValidationError) {
        writeJsonRpcError(response, 403, "Forbidden", originValidationError);
        return;
      }

      if (
        authorization &&
        matchesProtectedResourceMetadataPath(request.url, authorization.metadataPaths)
      ) {
        if ((request.method ?? "GET") !== "GET") {
          response.statusCode = 405;
          response.setHeader("allow", "GET");
          response.end();
          return;
        }

        writeJson(response, 200, authorization.metadata);
        return;
      }

      if (!matchesPath(request.url, path)) {
        writeJsonRpcError(response, 404, "Not Found", {
          code: -32000,
          message: `Unknown MCP endpoint: ${request.url ?? "/"}`
        });
        return;
      }

      const authenticationError = await validateAuthorization(request, authorization);

      if (authenticationError) {
        writeJsonRpcError(
          response,
          authenticationError.httpStatus,
          authenticationError.httpStatus === 401 ? "Unauthorized" : "Forbidden",
          authenticationError.error,
          {
            "www-authenticate": authenticationError.wwwAuthenticate
          }
        );
        return;
      }

      switch (request.method ?? "GET") {
        case "POST": {
          const parsedBody = await readJsonRequestBody(request, maxRequestBodyBytes);
          const sessionId = readHeaderValue(request.headers["mcp-session-id"]);

          if (sessionId) {
            const trackedSession = sessions.get(sessionId);

            if (!trackedSession) {
              writeJsonRpcError(response, 404, "Not Found", {
                code: -32001,
                message: "Session not found"
              });
              return;
            }

            trackedSession.activeRequests += 1;
            trackedSession.lastActivityAt = now();

            try {
              await trackedSession.session.transport.handleRequest(request, response, parsedBody);
            } finally {
              if (sessions.get(sessionId) === trackedSession) {
                trackedSession.activeRequests = Math.max(0, trackedSession.activeRequests - 1);
                trackedSession.lastActivityAt = now();
              }
            }
            return;
          }

          if (!isInitializeRequest(parsedBody)) {
            writeJsonRpcError(response, 400, "Bad Request", {
              code: -32000,
              message: "Bad Request: Mcp-Session-Id header is required"
            });
            return;
          }

          const runtime = createProtocolServer({
            getAdapter: () => controller.getAdapter(),
            getAdapterStateResource: () => controller.getAdapterStateResource(),
            journalService,
            serverInfo: bootstrap.serverInfo,
            instructions: bootstrap.instructions,
            experimentalTasks: bootstrap.experimentalTasks
          });
          const server = runtime.server;
          const eventStore =
            options.eventStoreFactory?.() ??
            (options.enableJsonResponse === false
              ? createInMemoryEventStore({
                  ...options.eventStoreOptions,
                  maxEventAgeMs:
                    options.eventStoreOptions?.maxEventAgeMs ??
                    DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENT_AGE_MS,
                  pruneIntervalMs:
                    options.eventStoreOptions?.pruneIntervalMs ??
                    DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS
                })
              : undefined);
          const eventStoreCleanup =
            eventStore &&
            hasEventStoreCleanup(eventStore)
              ? () => eventStore.cleanup()
              : undefined;
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: options.enableJsonResponse ?? true,
            eventStore,
            retryInterval: options.retryIntervalMs,
            onsessioninitialized: (newSessionId) => {
              sessions.set(newSessionId, {
                session: {
                  runtime,
                  server,
                  transport,
                  ...(eventStore ? { eventStore } : {})
                },
                lastActivityAt: now(),
                activeRequests: 0,
                ...(eventStoreCleanup ? { cleanup: eventStoreCleanup } : {})
              });
            },
            onsessionclosed: (closedSessionId) => {
              const trackedSession = sessions.get(closedSessionId);
              sessions.delete(closedSessionId);
              trackedSession?.cleanup?.();
            }
          });

          await server.connect(transport);
          await transport.handleRequest(request, response, parsedBody);
          return;
        }
        case "DELETE": {
          const sessionId = readHeaderValue(request.headers["mcp-session-id"]);

          if (!sessionId) {
            writeJsonRpcError(response, 400, "Bad Request", {
              code: -32000,
              message: "Bad Request: Mcp-Session-Id header is required"
            });
            return;
          }

          const trackedSession = sessions.get(sessionId);

          if (!trackedSession) {
            writeJsonRpcError(response, 404, "Not Found", {
              code: -32001,
              message: "Session not found"
            });
            return;
          }

          trackedSession.activeRequests += 1;
          trackedSession.lastActivityAt = now();

          try {
            await trackedSession.session.transport.handleRequest(request, response);
          } finally {
            if (sessions.get(sessionId) === trackedSession) {
              trackedSession.activeRequests = Math.max(0, trackedSession.activeRequests - 1);
              trackedSession.lastActivityAt = now();
            }
          }
          return;
        }
        case "GET": {
          const sessionId = readHeaderValue(request.headers["mcp-session-id"]);

          if (!sessionId) {
            writeJsonRpcError(response, 400, "Bad Request", {
              code: -32000,
              message: "Bad Request: Mcp-Session-Id header is required"
            });
            return;
          }

          const trackedSession = sessions.get(sessionId);

          if (!trackedSession) {
            writeJsonRpcError(response, 404, "Not Found", {
              code: -32001,
              message: "Session not found"
            });
            return;
          }

          trackedSession.activeRequests += 1;
          trackedSession.lastActivityAt = now();

          try {
            await trackedSession.session.transport.handleRequest(request, response);
          } finally {
            if (sessions.get(sessionId) === trackedSession) {
              trackedSession.activeRequests = Math.max(0, trackedSession.activeRequests - 1);
              trackedSession.lastActivityAt = now();
            }
          }
          return;
        }
        default:
          response.statusCode = 405;
          response.setHeader("allow", "GET, POST, DELETE");
          response.end();
      }
    } catch (error) {
      if (error instanceof HttpRequestBodyError) {
        writeJsonRpcError(
          response,
          error.statusCode,
          error.statusMessage,
          {
            code: -32000,
            message: error.message,
            ...(error.details !== undefined ? { details: error.details } : {})
          },
          error.headers
        );
        return;
      }

      const message = error instanceof Error ? error.message : "Internal server error";
      writeJsonRpcError(response, 500, "Internal Server Error", {
        code: -32603,
        message
      });
    }
  });
  httpServer.requestTimeout = requestTimeoutMs;
  httpServer.headersTimeout = headersTimeoutMs;
  httpServer.keepAliveTimeout = keepAliveTimeoutMs;

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const boundAddress = httpServer.address();

  if (!boundAddress || typeof boundAddress === "string") {
    throw new Error("Failed to resolve Streamable HTTP server address.");
  }

  const address = {
    host,
    port: (boundAddress as AddressInfo).port,
    path,
    endpointUrl: `http://${host}:${(boundAddress as AddressInfo).port}${path}`
  };
  authorization = resolveStreamableHttpAuthorization({
    authorization: options.authorization,
    authToken: options.authToken,
    endpointUrl: address.endpointUrl,
    path
  });

  return {
    get adapter(): EngineMcpCapabilityAdapter {
      return controller.getAdapter();
    },
    get adapterName(): string | undefined {
      return controller.getAdapterName();
    },
    availableAdapterNames: bootstrap.availableAdapterNames,
    get preflight(): EngineMcpConformancePreflightResult | undefined {
      return controller.getPreflight();
    },
    async sendLoggingMessage(
      params: LoggingMessageNotification["params"],
      sessionId?: string
    ): Promise<void> {
      if (sessionId) {
        const trackedSession = sessions.get(sessionId);

        if (!trackedSession) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        trackedSession.lastActivityAt = now();
        await trackedSession.session.server.sendLoggingMessage(params, sessionId);
        return;
      }

      await Promise.all(
        [...sessions.values()].map((trackedSession) =>
          trackedSession.session.server.sendLoggingMessage(params).catch(() => undefined)
        )
      );
    },
    notifyToolListChanged(): Promise<void> {
      return controller.notifyToolListChanged();
    },
    notifyPromptListChanged(): Promise<void> {
      return controller.notifyPromptListChanged();
    },
    replaceAdapter(
      adapter: EngineMcpCapabilityAdapter,
      adapterSwitchOptions?: EngineMcpAdapterSwitchOptions
    ): Promise<void> {
      return controller.replaceAdapter(adapter, adapterSwitchOptions);
    },
    selectAdapter(
      adapterName: string,
      adapterSwitchOptions?: Omit<EngineMcpAdapterSwitchOptions, "adapterName">
    ): Promise<void> {
      return controller.selectAdapter(adapterName, adapterSwitchOptions);
    },
    httpServer,
    address,
    async close(): Promise<void> {
      clearInterval(sessionSweepTimer);

      for (const sessionId of [...sessions.keys()]) {
        await closeSession(sessionId);
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      bootstrap.cleanup();
    }
  };
}

async function readJsonRequestBody(
  request: IncomingMessage,
  maxRequestBodyBytes: number
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;

    if (totalBytes > maxRequestBodyBytes) {
      throw new HttpRequestBodyError(
        413,
        "Payload Too Large",
        `Request body exceeds the ${maxRequestBodyBytes}-byte limit.`,
        {
          maxRequestBodyBytes
        },
        {
          connection: "close"
        }
      );
    }

    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (rawBody.length === 0) {
    throw new HttpRequestBodyError(400, "Bad Request", "Missing JSON request body.");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpRequestBodyError(400, "Bad Request", "Malformed JSON request body.");
  }
}

class HttpRequestBodyError extends Error {
  constructor(
    readonly statusCode: 400 | 413,
    readonly statusMessage: "Bad Request" | "Payload Too Large",
    message: string,
    readonly details?: unknown,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "HttpRequestBodyError";
  }
}

function resolvePositiveIntegerOption(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer option value, received: ${value}`);
  }

  return value;
}

function writeJsonRpcError(
  response: ServerResponse,
  statusCode: number,
  statusMessage: string,
  error: {
    code: number | string;
    message: string;
    details?: unknown;
  },
  headers: Record<string, string> = {}
): void {
  if (response.headersSent) {
    return;
  }

  response.statusCode = statusCode;
  response.statusMessage = statusMessage;
  response.setHeader("content-type", "application/json");

  for (const [headerName, headerValue] of Object.entries(headers)) {
    response.setHeader(headerName, headerValue);
  }

  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: typeof error.code === "number" ? error.code : -32000,
        message: error.message,
        ...(error.details !== undefined ? { data: error.details } : {})
      },
      id: null
    })
  );
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {}
): void {
  if (response.headersSent) {
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");

  for (const [headerName, headerValue] of Object.entries(headers)) {
    response.setHeader(headerName, headerValue);
  }

  response.end(JSON.stringify(payload));
}

function readHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}
