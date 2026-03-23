import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

import type { CapabilityName } from "@engine-mcp/contracts";

import {
  UNITY_LOCAL_HTTP_CALL_PATH,
  UNITY_LOCAL_HTTP_DEFAULT_HOST,
  UNITY_LOCAL_HTTP_DEFAULT_PORT,
  UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER,
  buildUnityLocalHttpCallUrl,
  createUnityLocalBridgeErrorResponse,
  createUnityLocalBridgeSuccessResponse,
  isUnityLocalBridgeErrorCode,
  parseUnityLocalBridgeRequest,
  type UnityLocalBridgeSessionBootstrap,
  type UnityLocalBridgeCallResponse,
  type UnityLocalBridgeError
} from "../contracts/plugin-contract.js";
import { UnityBridgeRemoteError } from "../errors.js";
import {
  deleteUnityBridgeSessionBootstrap,
  getDefaultUnityBridgeSessionBootstrapPath,
  writeUnityBridgeSessionBootstrapForLocalHttp
} from "../bootstrap/session-bootstrap.js";

export interface UnityBridgeLocalHttpInvocation {
  capability: CapabilityName;
  input: unknown;
}

export interface UnityBridgeInvocationContext {
  signal?: AbortSignal;
}

export interface UnityBridgeLocalHttpAdapter {
  invoke(
    request: UnityBridgeLocalHttpInvocation,
    context?: UnityBridgeInvocationContext
  ): Promise<unknown> | unknown;
}

export interface UnityBridgeLocalHttpServerOptions {
  adapter: UnityBridgeLocalHttpAdapter;
  sessionToken: string;
  host?: string;
  port?: number;
  path?: string;
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
  maxRequestsPerSocket?: number;
  invocationTimeoutMs?: number;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  sessionIdleTtlMs?: number;
  sessionSweepIntervalMs?: number;
  onSessionRevoked?: (reason: "idle_expired") => Promise<void> | void;
}

export interface UnityBridgeLocalHttpServerAddress {
  host: string;
  port: number;
  path: string;
  url: string;
}

export interface UnityBridgeLocalHttpServer {
  readonly address: UnityBridgeLocalHttpServerAddress | null;
  readonly httpServer: Server | null;
  start(): Promise<UnityBridgeLocalHttpServerAddress>;
  stop(): Promise<void>;
}

export interface ManagedUnityBridgeLocalHttpSessionOptions
  extends Omit<UnityBridgeLocalHttpServerOptions, "sessionToken"> {
  sessionToken?: string;
  bootstrapFilePath?: string;
  cleanupBootstrapFileOnStop?: boolean;
}

export interface ManagedUnityBridgeLocalHttpSessionState {
  address: UnityBridgeLocalHttpServerAddress;
  bootstrapFilePath: string;
  bootstrap: UnityLocalBridgeSessionBootstrap;
  sessionToken: string;
}

export interface ManagedUnityBridgeLocalHttpSession {
  readonly address: UnityBridgeLocalHttpServerAddress | null;
  readonly bootstrap: UnityLocalBridgeSessionBootstrap | null;
  readonly bootstrapFilePath: string;
  readonly sessionToken: string;
  start(): Promise<ManagedUnityBridgeLocalHttpSessionState>;
  stop(): Promise<void>;
}

export const DEFAULT_UNITY_LOCAL_HTTP_MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_UNITY_LOCAL_HTTP_MAX_CONCURRENT_REQUESTS = 16;
export const DEFAULT_UNITY_LOCAL_HTTP_MAX_REQUESTS_PER_SOCKET = 100;
export const DEFAULT_UNITY_LOCAL_HTTP_INVOCATION_TIMEOUT_MS = 30_000;
export const DEFAULT_UNITY_LOCAL_HTTP_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_UNITY_LOCAL_HTTP_HEADERS_TIMEOUT_MS = 30_000;
export const DEFAULT_UNITY_LOCAL_HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const DEFAULT_UNITY_LOCAL_HTTP_SESSION_IDLE_TTL_MS = 600_000;
export const DEFAULT_UNITY_LOCAL_HTTP_SESSION_SWEEP_INTERVAL_MS = 60_000;

export function createUnityBridgeSessionToken(byteLength: number = 24): string {
  return randomBytes(byteLength).toString("hex");
}

export function createUnityBridgeLocalHttpServer(
  options: UnityBridgeLocalHttpServerOptions
): UnityBridgeLocalHttpServer {
  const host = options.host ?? UNITY_LOCAL_HTTP_DEFAULT_HOST;
  const port = options.port ?? UNITY_LOCAL_HTTP_DEFAULT_PORT;
  const path = options.path ?? UNITY_LOCAL_HTTP_CALL_PATH;
  const maxBodyBytes = resolvePositiveIntegerOption(
    options.maxBodyBytes,
    DEFAULT_UNITY_LOCAL_HTTP_MAX_BODY_BYTES
  );
  const maxConcurrentRequests = resolvePositiveIntegerOption(
    options.maxConcurrentRequests,
    DEFAULT_UNITY_LOCAL_HTTP_MAX_CONCURRENT_REQUESTS
  );
  const maxRequestsPerSocket = resolveNonNegativeIntegerOption(
    options.maxRequestsPerSocket,
    DEFAULT_UNITY_LOCAL_HTTP_MAX_REQUESTS_PER_SOCKET
  );
  const invocationTimeoutMs = resolvePositiveIntegerOption(
    options.invocationTimeoutMs,
    DEFAULT_UNITY_LOCAL_HTTP_INVOCATION_TIMEOUT_MS
  );
  const requestTimeoutMs = resolvePositiveIntegerOption(
    options.requestTimeoutMs,
    DEFAULT_UNITY_LOCAL_HTTP_REQUEST_TIMEOUT_MS
  );
  const headersTimeoutMs = Math.min(
    resolvePositiveIntegerOption(
      options.headersTimeoutMs,
      DEFAULT_UNITY_LOCAL_HTTP_HEADERS_TIMEOUT_MS
    ),
    requestTimeoutMs
  );
  const keepAliveTimeoutMs = resolvePositiveIntegerOption(
    options.keepAliveTimeoutMs,
    DEFAULT_UNITY_LOCAL_HTTP_KEEP_ALIVE_TIMEOUT_MS
  );
  const sessionIdleTtlMs = resolvePositiveIntegerOption(
    options.sessionIdleTtlMs,
    DEFAULT_UNITY_LOCAL_HTTP_SESSION_IDLE_TTL_MS
  );
  const sessionSweepIntervalMs = Math.min(
    resolvePositiveIntegerOption(
      options.sessionSweepIntervalMs,
      DEFAULT_UNITY_LOCAL_HTTP_SESSION_SWEEP_INTERVAL_MS
    ),
    sessionIdleTtlMs
  );
  const sessionToken = options.sessionToken.trim();

  if (sessionToken.length === 0) {
    throw new Error("Unity local HTTP server requires a non-empty session token.");
  }

  let currentAddress: UnityBridgeLocalHttpServerAddress | null = null;
  let server: Server | null = null;
  let lastActivityAt = Date.now();
  let revokedReason: "idle_expired" | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let revocationPromise: Promise<void> | null = null;
  let activeRequests = 0;

  function isIdleExpired(now: number = Date.now()): boolean {
    return now - lastActivityAt >= sessionIdleTtlMs;
  }

  function refreshActivity(now: number = Date.now()): void {
    if (revokedReason !== null) {
      return;
    }

    lastActivityAt = now;
  }

  function tryAcquireRequestSlot(): boolean {
    if (activeRequests >= maxConcurrentRequests) {
      return false;
    }

    activeRequests += 1;
    return true;
  }

  function releaseRequestSlot(): void {
    activeRequests = Math.max(0, activeRequests - 1);
  }

  async function revokeSession(reason: "idle_expired"): Promise<void> {
    if (revokedReason !== null) {
      await revocationPromise;
      return;
    }

    revokedReason = reason;
    const activeServer = server;
    revocationPromise = Promise.resolve(options.onSessionRevoked?.(reason))
      .catch(() => undefined)
      .finally(() => {
        activeServer?.closeIdleConnections?.();
      });
    await revocationPromise;
  }

  return {
    get address() {
      return currentAddress;
    },
    get httpServer() {
      return server;
    },
    async start() {
      if (server && currentAddress) {
        if (revokedReason === null) {
          refreshActivity();
        }

        return currentAddress;
      }

      revokedReason = null;
      revocationPromise = null;
      lastActivityAt = Date.now();
      server = createServer(async (request, response) => {
        try {
          await handleRequest(request, response, {
            adapter: options.adapter,
            sessionToken,
            path,
            maxBodyBytes,
            invocationTimeoutMs,
            tryAcquireRequestSlot,
            releaseRequestSlot,
            isSessionRevoked() {
              return revokedReason !== null;
            },
            isSessionExpired(now) {
              return isIdleExpired(now);
            },
            refreshSessionActivity(now) {
              refreshActivity(now);
            },
            revokeSession
          });
        } catch (error) {
          writeJson(response, 500, {
            error: normalizeTransportError(error)
          });
        }
      });
      server.requestTimeout = requestTimeoutMs;
      server.headersTimeout = headersTimeoutMs;
      server.keepAliveTimeout = keepAliveTimeoutMs;
      server.maxRequestsPerSocket = maxRequestsPerSocket;

      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(port, host, () => {
          server!.off("error", reject);
          resolve();
        });
      });

      const addressInfo = server.address();

      if (!addressInfo || typeof addressInfo === "string") {
        throw new Error("Unity local HTTP server failed to resolve a TCP address.");
      }

      currentAddress = {
        host,
        port: addressInfo.port,
        path,
        url: buildUnityLocalHttpCallUrl(host, addressInfo.port, path)
      };
      sweepTimer = setInterval(() => {
        if (!server || revokedReason !== null || activeRequests > 0 || !isIdleExpired()) {
          return;
        }

        void revokeSession("idle_expired");
      }, sessionSweepIntervalMs);
      sweepTimer.unref?.();

      return currentAddress;
    },
    async stop() {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }

      if (!server) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      server = null;
      currentAddress = null;
      revokedReason = null;
      revocationPromise = null;
      activeRequests = 0;
    }
  };
}

export function createManagedUnityBridgeLocalHttpSession(
  options: ManagedUnityBridgeLocalHttpSessionOptions
): ManagedUnityBridgeLocalHttpSession {
  const sessionToken = options.sessionToken?.trim() || createUnityBridgeSessionToken();
  const bootstrapFilePath = options.bootstrapFilePath ?? getDefaultUnityBridgeSessionBootstrapPath();
  const cleanupBootstrapFileOnStop = options.cleanupBootstrapFileOnStop ?? true;
  let bootstrapCleanupPromise: Promise<void> | null = null;

  async function cleanupBootstrap(): Promise<void> {
    if (bootstrapCleanupPromise) {
      await bootstrapCleanupPromise;
      return;
    }

    bootstrapCleanupPromise = (async () => {
      if (cleanupBootstrapFileOnStop) {
        await deleteUnityBridgeSessionBootstrap(bootstrapFilePath);
      }

      bootstrap = null;
    })();
    await bootstrapCleanupPromise;
  }

  const server = createUnityBridgeLocalHttpServer({
    ...options,
    sessionToken,
    onSessionRevoked: async (reason) => {
      if (reason === "idle_expired") {
        await cleanupBootstrap();
      }
    }
  });
  let bootstrap: UnityLocalBridgeSessionBootstrap | null = null;

  return {
    get address() {
      return server.address;
    },
    get bootstrap() {
      return bootstrap;
    },
    bootstrapFilePath,
    sessionToken,
    async start() {
      const address = await server.start();
      const bootstrapState = await writeUnityBridgeSessionBootstrapForLocalHttp(
        address.url,
        sessionToken,
        bootstrapFilePath
      );
      bootstrapCleanupPromise = null;
      bootstrap = bootstrapState.bootstrap;

      return {
        address,
        bootstrapFilePath: bootstrapState.filePath,
        bootstrap: bootstrapState.bootstrap,
        sessionToken
      };
    },
    async stop() {
      await server.stop();
      await cleanupBootstrap();
    }
  };
}

interface HandleRequestOptions {
  adapter: UnityBridgeLocalHttpAdapter;
  sessionToken: string;
  path: string;
  maxBodyBytes: number;
  invocationTimeoutMs: number;
  tryAcquireRequestSlot(): boolean;
  releaseRequestSlot(): void;
  isSessionRevoked(): boolean;
  isSessionExpired(now: number): boolean;
  refreshSessionActivity(now: number): void;
  revokeSession(reason: "idle_expired"): Promise<void>;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HandleRequestOptions
): Promise<void> {
  if (request.method !== "POST") {
    writeJson(response, 405, {
      error: "Method not allowed."
    });
    return;
  }

  if (request.url !== options.path) {
    writeJson(response, 404, {
      error: "Not found."
    });
    return;
  }

  const now = Date.now();
  if (options.isSessionRevoked() || options.isSessionExpired(now)) {
    await options.revokeSession("idle_expired");
    writeJson(response, 401, {
      error: "Session token expired or revoked."
    });
    return;
  }

  const presentedToken = request.headers[UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER];

  if (presentedToken !== options.sessionToken) {
    writeJson(response, 401, {
      error: "Missing or invalid session token."
    });
    return;
  }

  options.refreshSessionActivity(now);
  if (!options.tryAcquireRequestSlot()) {
    writeJson(response, 503, {
      error: "Too many concurrent bridge requests."
    });
    return;
  }

  try {
    const body = await readRequestBody(request, options.maxBodyBytes);
    const parsedRequest = parseUnityLocalBridgeRequest(body);
    const requestAbortController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(options.invocationTimeoutMs);
    const invocationSignal = AbortSignal.any([requestAbortController.signal, timeoutSignal]);
    const abortOnDisconnect = () => {
      if (!response.writableEnded) {
        requestAbortController.abort(
          new UnityBridgeInvocationAbortedError("Client disconnected during bridge invocation.")
        );
      }
    };

    request.once("close", abortOnDisconnect);
    response.once("close", abortOnDisconnect);

    try {
      const payload = await invokeAdapterWithSignal(
        options.adapter,
        {
          capability: parsedRequest.capability,
          input: parsedRequest.payload
        },
        {
          signal: invocationSignal,
          timeoutSignal,
          requestAbortSignal: requestAbortController.signal,
          timeoutMs: options.invocationTimeoutMs
        }
      );
      const envelope = createUnityLocalBridgeSuccessResponse(parsedRequest.requestId, payload, {
        ...(hasSnapshotId(payload) ? { snapshotId: payload.snapshotId } : {})
      });

      writeJson(response, 200, envelope);
    } catch (error) {
      if (error instanceof UnityBridgeInvocationAbortedError) {
        return;
      }

      if (error instanceof UnityBridgeInvocationTimeoutError) {
        const envelope: UnityLocalBridgeCallResponse = createUnityLocalBridgeErrorResponse(
          parsedRequest.requestId,
          {
            code: "bridge_transport_error",
            message: "Bridge invocation timed out.",
            details: {
              capability: parsedRequest.capability,
              timeoutMs: error.timeoutMs
            }
          }
        );

        writeJson(response, 200, envelope);
        return;
      }

      const mappedError = mapAdapterError(error);
      const envelope: UnityLocalBridgeCallResponse = createUnityLocalBridgeErrorResponse(
        parsedRequest.requestId,
        mappedError
      );

      writeJson(response, 200, envelope);
    } finally {
      request.off("close", abortOnDisconnect);
      response.off("close", abortOnDisconnect);
    }
  } finally {
    options.releaseRequestSlot();
  }
}

async function invokeAdapterWithSignal(
  adapter: UnityBridgeLocalHttpAdapter,
  request: UnityBridgeLocalHttpInvocation,
  options: {
    signal: AbortSignal;
    timeoutSignal: AbortSignal;
    requestAbortSignal: AbortSignal;
    timeoutMs: number;
  }
): Promise<unknown> {
  if (options.signal.aborted) {
    throw toInvocationAbortError(request.capability, options);
  }

  return new Promise<unknown>((resolve, reject) => {
    const onAbort = () => {
      reject(toInvocationAbortError(request.capability, options));
    };

    options.signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(adapter.invoke(request, { signal: options.signal }))
      .then(resolve, reject)
      .finally(() => {
        options.signal.removeEventListener("abort", onAbort);
      });
  });
}

function toInvocationAbortError(
  capability: CapabilityName,
  options: {
    timeoutSignal: AbortSignal;
    requestAbortSignal: AbortSignal;
    timeoutMs: number;
  }
): Error {
  if (options.timeoutSignal.aborted) {
    return new UnityBridgeInvocationTimeoutError(capability, options.timeoutMs);
  }

  if (options.requestAbortSignal.aborted) {
    const reason = options.requestAbortSignal.reason;

    if (reason instanceof Error) {
      return reason;
    }

    return new UnityBridgeInvocationAbortedError("Client disconnected during bridge invocation.");
  }

  return new UnityBridgeInvocationAbortedError("Bridge invocation was aborted.");
}

async function readRequestBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;

    if (totalBytes > maxBodyBytes) {
      throw new Error(`Unity local HTTP request exceeded ${maxBodyBytes} bytes.`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function hasSnapshotId(value: unknown): value is { snapshotId: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "snapshotId" in value &&
    typeof value.snapshotId === "string"
  );
}

function mapAdapterError(error: unknown): UnityLocalBridgeError {
  if (isPolicyError(error)) {
    const code = error.decision.code ?? "policy_denied";

    return {
      code: isUnityLocalBridgeErrorCode(code) ? code : "policy_denied",
      message: error.decision.reason ?? "Bridge policy denied the request.",
      ...(typeof error.decision.details !== "undefined" ? { details: error.decision.details } : {})
    };
  }

  if (isValidationError(error)) {
    return {
      code: "validation_error",
      message: error.message,
      details: {
        capability: error.capability,
        issues: error.issues
      }
    };
  }

  if (isRemoteError(error)) {
    const remoteCode = error.code as string;

    if (remoteCode === "rollback_unavailable") {
      return {
        code: "policy_denied",
        message: "rollback_unavailable",
        ...(typeof error.details !== "undefined" ? { details: error.details } : {})
      };
    }

    return {
      code: error.code,
      message: error.message,
      ...(typeof error.details !== "undefined" ? { details: error.details } : {})
    };
  }

  if (error instanceof Error && /not found/i.test(error.message)) {
    return {
      code: "target_not_found",
      message: error.message
    };
  }

  if (error instanceof Error) {
    const prefixedError = tryMapPrefixedError(error.message, [
      "rollback_unavailable",
      "snapshot_failed",
      "target_not_found",
      "validation_error",
      "policy_denied"
    ]);

    if (prefixedError) {
      return prefixedError;
    }
  }

  if (error instanceof Error) {
    return {
      code: "bridge_transport_error",
      message: error.message
    };
  }

  return {
    code: "bridge_transport_error",
    message: "Bridge invocation failed with a non-Error value.",
    details: error
  };
}

function normalizeTransportError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected transport failure.";
}

class UnityBridgeInvocationTimeoutError extends Error {
  constructor(
    readonly capability: CapabilityName,
    readonly timeoutMs: number
  ) {
    super(`Bridge invocation for ${capability} timed out after ${timeoutMs}ms.`);
    this.name = "UnityBridgeInvocationTimeoutError";
  }
}

class UnityBridgeInvocationAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnityBridgeInvocationAbortedError";
  }
}

function tryMapPrefixedError(
  message: string,
  errorCodes: ReadonlyArray<
    "rollback_unavailable" | "snapshot_failed" | "target_not_found" | "validation_error" | "policy_denied"
  >
): UnityLocalBridgeError | undefined {
  for (const errorCode of errorCodes) {
    const prefix = `${errorCode}:`;

    if (!message.startsWith(prefix)) {
      continue;
    }

    const normalizedMessage = message.slice(prefix.length).trim();

    if (errorCode === "rollback_unavailable") {
      return {
        code: "policy_denied",
        message: "rollback_unavailable"
      };
    }

    return {
      code: errorCode,
      message: normalizedMessage.length > 0 ? normalizedMessage : errorCode
    };
  }

  return undefined;
}

function isPolicyError(
  error: unknown
): error is { decision: { code?: string; reason?: string; details?: unknown } } & Error {
  return (
    error instanceof Error &&
    error.name === "UnityBridgePolicyError" &&
    "decision" in error &&
    !!error.decision &&
    typeof error.decision === "object"
  );
}

function isValidationError(
  error: unknown
): error is { capability: CapabilityName; issues: unknown } & Error {
  return (
    error instanceof Error &&
    error.name === "UnityBridgeValidationError" &&
    "capability" in error &&
    "issues" in error
  );
}

function isRemoteError(error: unknown): error is UnityBridgeRemoteError {
  return error instanceof UnityBridgeRemoteError;
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

function resolveNonNegativeIntegerOption(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer option value, received: ${value}`);
  }

  return value;
}
