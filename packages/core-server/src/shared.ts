import { readFileSync } from "node:fs";
import type { IncomingMessage, Server as NodeHttpServer } from "node:http";
import type { Readable, Writable } from "node:stream";

import {
  createUnityBridgePreferredAdapter,
  type UnityBridgePreferredAdapterOptions
} from "@engine-mcp/unity-bridge";
import type { ConformanceCase, ConformanceReport } from "@engine-mcp/conformance-runner";
import { summarizeConformanceReport } from "@engine-mcp/conformance-runner";
import type {
  CapabilityName,
  JournalEntry,
  PolicyTargetDescriptor,
  PromptArgumentCompletionProvider,
  PromptDefinition,
  SnapshotMetadata
} from "@engine-mcp/contracts";
import type {
  TaskMessageQueue,
  TaskStore
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { EventStore } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  Implementation,
  LoggingMessageNotification,
  RequestId,
  ServerNotification,
  ServerRequest
} from "@modelcontextprotocol/sdk/types.js";

export const SUPPORTED_TRANSPORTS = ["streamable_http", "stdio"] as const;

export type SupportedTransport = (typeof SUPPORTED_TRANSPORTS)[number];

export type EngineMcpCoreRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type EngineMcpRelatedNotification = Parameters<
  EngineMcpCoreRequestExtra["sendNotification"]
>[0];
export type EngineMcpRelatedRequest = Parameters<EngineMcpCoreRequestExtra["sendRequest"]>[0];
export type EngineMcpRelatedRequestResultSchema = Parameters<
  EngineMcpCoreRequestExtra["sendRequest"]
>[1];
export type EngineMcpRelatedRequestOptions = Parameters<
  EngineMcpCoreRequestExtra["sendRequest"]
>[2];

export const MODEL_IMMEDIATE_RESPONSE_META_KEY =
  "io.modelcontextprotocol/model-immediate-response";

export interface BootstrapServerOptions {
  transport: SupportedTransport;
  capabilities: string[];
}

export interface EngineMcpCapabilityInvocation {
  capability: CapabilityName;
  input: unknown;
  context?: EngineMcpCapabilityInvocationContext;
}

export interface EngineMcpCapabilityInvocationContext {
  readonly requestId: RequestId;
  readonly sessionId?: string;
  readonly progressToken?: string | number;
  readonly cancellationSignal?: AbortSignal;
  isCancellationRequested(): boolean;
  throwIfCancelled(): void;
  sendProgress(update: {
    progress: number;
    total?: number;
    message?: string;
  }): Promise<void>;
  sendNotification(notification: EngineMcpRelatedNotification): Promise<void>;
  sendRequest<TResult = unknown>(
    request: EngineMcpRelatedRequest,
    resultSchema: EngineMcpRelatedRequestResultSchema,
    options?: EngineMcpRelatedRequestOptions
  ): Promise<TResult>;
  createElicitationCompletionNotifier(elicitationId: string): () => Promise<void>;
}

export interface EngineMcpPromptArgumentCompletionRequest {
  promptName: string;
  argumentName: string;
  provider: PromptArgumentCompletionProvider;
  value: string;
}

export interface EngineMcpAdapterResourceDefinition {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface EngineMcpAdapterResourceContent {
  uri: string;
  mimeType?: string;
  text: string;
}

export interface EngineMcpCapabilityAdapter {
  readonly adapter: string;
  readonly capabilities: readonly CapabilityName[];
  readonly prompts?: readonly PromptDefinition[];
  listResources?():
    | Promise<readonly EngineMcpAdapterResourceDefinition[] | EngineMcpAdapterResourceDefinition[]>
    | readonly EngineMcpAdapterResourceDefinition[]
    | EngineMcpAdapterResourceDefinition[];
  readResource?(
    uri: string
  ):
    | Promise<EngineMcpAdapterResourceContent | undefined>
    | EngineMcpAdapterResourceContent
    | undefined;
  completePromptArgument?(
    request: EngineMcpPromptArgumentCompletionRequest
  ): Promise<readonly string[] | string[]> | readonly string[] | string[];
  invoke(request: EngineMcpCapabilityInvocation): Promise<unknown> | unknown;
}

export interface EngineMcpAdapterFactoryContext {
  unityBridge?: UnityBridgePreferredAdapterOptions;
}

export type EngineMcpAdapterFactory = (
  context: EngineMcpAdapterFactoryContext
) => Promise<EngineMcpCapabilityAdapter> | EngineMcpCapabilityAdapter;

export interface EngineMcpAdapterRegistryEntry {
  name: string;
  create: EngineMcpAdapterFactory;
}

export interface EngineMcpAdapterRegistry {
  readonly defaultAdapterName: string;
  list(): readonly string[];
  resolve(
    adapterName: string | undefined,
    context: EngineMcpAdapterFactoryContext
  ): Promise<EngineMcpCapabilityAdapter>;
}

export interface EngineMcpAdapterRegistryOptions {
  entries?: readonly EngineMcpAdapterRegistryEntry[];
  defaultAdapterName?: string;
}

export interface EngineMcpConformancePreflightOptions {
  requiredCapabilities?: readonly CapabilityName[];
  cases?: readonly ConformanceCase[];
  enforce?: boolean;
}

export interface EngineMcpConformancePreflightResult {
  passed: boolean;
  report: ConformanceReport;
}

export interface EngineMcpAdapterSwitchOptions {
  adapterName?: string;
  conformancePreflight?: EngineMcpConformancePreflightOptions;
}

export interface EngineMcpExperimentalTasksOptions {
  enabled?: boolean;
  defaultTtlMs?: number | null;
  defaultPollIntervalMs?: number;
  maxQueueSize?: number;
  taskMessageRetentionMs?: number;
  taskMessagePruneIntervalMs?: number;
  childRequestTimeoutMs?: number;
  taskStore?: TaskStore;
  taskMessageQueue?: TaskMessageQueue;
  modelImmediateResponse?: EngineMcpModelImmediateResponseResolver;
  samplingPolicy?: EngineMcpSamplingPolicyOptions;
}

export interface EngineMcpModelImmediateResponseContext {
  capability: CapabilityName;
  adapterId: string;
  input: unknown;
  taskId: string;
  requestId: RequestId;
  sessionId?: string;
}

export type EngineMcpModelImmediateResponseResolver =
  | string
  | ((context: EngineMcpModelImmediateResponseContext) => string | undefined);

export interface EngineMcpSamplingPolicyOptions {
  maxTurns?: number;
  forceToolChoiceNoneOnFinalTurn?: boolean;
}

export interface EngineMcpInMemoryEventStoreOptions {
  maxEventsPerStream?: number;
  maxEventAgeMs?: number;
  pruneIntervalMs?: number;
  now?: () => number;
}

export interface EngineMcpInMemoryTaskMessageQueueOptions {
  maxMessageAgeMs?: number;
  pruneIntervalMs?: number;
  now?: () => number;
}

export interface EngineMcpProtectedResourceMetadata {
  resource: string;
  authorization_servers: readonly string[];
  scopes_supported?: readonly string[];
}

export interface EngineMcpAccessTokenValidationContext {
  token?: string;
  request: IncomingMessage;
  resource: string;
  requiredScopes: readonly string[];
}

export type EngineMcpAccessTokenValidationResult =
  | {
      ok: true;
      scopes?: readonly string[];
      subject?: string;
    }
  | {
      ok: false;
      status: 401 | 403;
      error?: "invalid_request" | "invalid_token" | "insufficient_scope";
      errorDescription?: string;
      requiredScopes?: readonly string[];
    };

export interface EngineMcpHttpAuthorizationOptions {
  authorizationServers: readonly string[];
  resource?: string;
  scopesSupported?: readonly string[];
  requiredScopes?: readonly string[];
  validateAccessToken(
    context: EngineMcpAccessTokenValidationContext
  ): Promise<EngineMcpAccessTokenValidationResult> | EngineMcpAccessTokenValidationResult;
}

export interface EngineMcpStaticBearerAuthorizationOptions {
  token: string;
  authorizationServers: readonly string[];
  resource?: string;
  scopesSupported?: readonly string[];
  requiredScopes?: readonly string[];
  grantedScopes?: readonly string[];
}

export interface EngineMcpAdapterStateResource {
  selectedAdapter: string;
  adapterId: string;
  availableAdapters: readonly string[];
  capabilities: readonly CapabilityName[];
  toolCount: number;
  preflight:
    | {
        enabled: false;
      }
    | {
        enabled: true;
        passed: boolean;
        summary: string;
        passedCases: number;
        failedCases: number;
        skippedCases: number;
      };
  health:
    | {
        status: "ready";
      }
    | {
        status: "degraded";
        reason: "conformance_preflight_failed";
      };
  updatedAt: string;
}

export interface EngineMcpJournalService {
  append(entry: JournalEntry): Promise<void> | void;
  list(): Promise<readonly JournalEntry[]> | readonly JournalEntry[];
}

export interface EngineMcpSnapshotMetadataRecord {
  snapshot: SnapshotMetadata;
  rollbackAvailable: boolean;
  updatedAt: string;
  target?: PolicyTargetDescriptor;
}

export interface EngineMcpSnapshotMetadataStore {
  upsert(record: EngineMcpSnapshotMetadataRecord): Promise<void> | void;
  get(
    snapshotId: string
  ):
    | Promise<EngineMcpSnapshotMetadataRecord | undefined>
    | EngineMcpSnapshotMetadataRecord
    | undefined;
  list():
    | Promise<readonly EngineMcpSnapshotMetadataRecord[]>
    | readonly EngineMcpSnapshotMetadataRecord[];
}

export interface EngineMcpPersistenceOptions {
  rootDir?: string;
}

export interface EngineMcpCoreServerOptions {
  adapter?: EngineMcpCapabilityAdapter;
  adapterRegistry?: EngineMcpAdapterRegistry;
  adapterName?: string;
  conformancePreflight?: EngineMcpConformancePreflightOptions;
  experimentalTasks?: EngineMcpExperimentalTasksOptions;
  journalService?: EngineMcpJournalService;
  snapshotMetadataStore?: EngineMcpSnapshotMetadataStore;
  persistence?: false | EngineMcpPersistenceOptions;
  unityBridge?: UnityBridgePreferredAdapterOptions;
  serverInfo?: Implementation;
  instructions?: string;
}

export interface EngineMcpStdioServerOptions extends EngineMcpCoreServerOptions {
  stdin?: Readable;
  stdout?: Writable;
}

export interface EngineMcpStreamableHttpServerOptions extends EngineMcpCoreServerOptions {
  host?: string;
  port?: number;
  path?: string;
  maxRequestBodyBytes?: number;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  sessionIdleTtlMs?: number;
  sessionSweepIntervalMs?: number;
  authorization?: EngineMcpHttpAuthorizationOptions;
  /**
   * @deprecated Prefer `authorization` with MCP/OAuth protected-resource metadata.
   */
  authToken?: string;
  enableJsonResponse?: boolean;
  eventStoreFactory?: () => EventStore;
  eventStoreOptions?: EngineMcpInMemoryEventStoreOptions;
  retryIntervalMs?: number;
  allowedHosts?: string[];
  allowedOriginHosts?: string[];
}

export interface EngineMcpCoreServerRuntime {
  readonly server: Server;
  readonly adapter: EngineMcpCapabilityAdapter;
  readonly adapterName?: string;
  readonly availableAdapterNames: readonly string[];
  readonly preflight?: EngineMcpConformancePreflightResult;
  sendLoggingMessage(
    params: LoggingMessageNotification["params"],
    sessionId?: string
  ): Promise<void>;
  notifyToolListChanged(): Promise<void>;
  notifyPromptListChanged(): Promise<void>;
  replaceAdapter(
    adapter: EngineMcpCapabilityAdapter,
    options?: EngineMcpAdapterSwitchOptions
  ): Promise<void>;
  selectAdapter(
    adapterName: string,
    options?: Omit<EngineMcpAdapterSwitchOptions, "adapterName">
  ): Promise<void>;
  close(): Promise<void>;
}

export interface EngineMcpStdioServerRuntime extends EngineMcpCoreServerRuntime {
  readonly transport: StdioServerTransport;
}

export interface EngineMcpStreamableHttpServerAddress {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly endpointUrl: string;
}

export interface EngineMcpStreamableHttpServerRuntime {
  readonly adapter: EngineMcpCapabilityAdapter;
  readonly adapterName?: string;
  readonly availableAdapterNames: readonly string[];
  readonly preflight?: EngineMcpConformancePreflightResult;
  sendLoggingMessage(
    params: LoggingMessageNotification["params"],
    sessionId?: string
  ): Promise<void>;
  notifyToolListChanged(): Promise<void>;
  notifyPromptListChanged(): Promise<void>;
  replaceAdapter(
    adapter: EngineMcpCapabilityAdapter,
    options?: EngineMcpAdapterSwitchOptions
  ): Promise<void>;
  selectAdapter(
    adapterName: string,
    options?: Omit<EngineMcpAdapterSwitchOptions, "adapterName">
  ): Promise<void>;
  readonly httpServer: NodeHttpServer;
  readonly address: EngineMcpStreamableHttpServerAddress;
  close(): Promise<void>;
}

export interface EngineMcpToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface EngineMcpHttpSession {
  readonly runtime: EngineMcpProtocolServerRuntime;
  readonly transport: StreamableHTTPServerTransport;
  readonly server: Server;
  readonly eventStore?: EventStore;
}

export interface ResolvedCoreServerBootstrap {
  adapter: EngineMcpCapabilityAdapter;
  adapterName?: string;
  availableAdapterNames: readonly string[];
  adapterRegistry?: EngineMcpAdapterRegistry;
  preflightOptions?: EngineMcpConformancePreflightOptions;
  experimentalTasks?: ResolvedExperimentalTasksOptions;
  cleanup(): void;
  serverInfo: Implementation;
  instructions: string;
  preflight?: EngineMcpConformancePreflightResult;
}

export interface EngineMcpAdapterState {
  adapter: EngineMcpCapabilityAdapter;
  adapterName?: string;
  preflight?: EngineMcpConformancePreflightResult;
  updatedAt: string;
}

export interface ResolvedCoreServerAdapter {
  adapter: EngineMcpCapabilityAdapter;
  adapterName?: string;
  availableAdapterNames: readonly string[];
  adapterRegistry?: EngineMcpAdapterRegistry;
}

export interface EngineMcpRuntimeAdapterController {
  getAdapter(): EngineMcpCapabilityAdapter;
  getAdapterName(): string | undefined;
  getPreflight(): EngineMcpConformancePreflightResult | undefined;
  getAdapterStateResource(): EngineMcpAdapterStateResource;
  readonly availableAdapterNames: readonly string[];
  notifyToolListChanged(): Promise<void>;
  notifyPromptListChanged(): Promise<void>;
  replaceAdapter(
    adapter: EngineMcpCapabilityAdapter,
    options?: EngineMcpAdapterSwitchOptions
  ): Promise<void>;
  selectAdapter(
    adapterName: string,
    options?: Omit<EngineMcpAdapterSwitchOptions, "adapterName">
  ): Promise<void>;
}

export interface ResolvedExperimentalTasksOptions {
  taskStore: TaskStore;
  taskMessageQueue: TaskMessageQueue;
  cancellationRegistry: EngineMcpTaskCancellationRegistry;
  defaultTtlMs: number | null;
  defaultPollIntervalMs: number;
  maxQueueSize?: number;
  childRequestTimeoutMs: number;
  modelImmediateResponse?: EngineMcpModelImmediateResponseResolver;
  samplingPolicy?: EngineMcpSamplingPolicyOptions;
  cleanup(): void;
}

export interface EngineMcpTaskCancellationRegistry {
  register(taskId: string): AbortSignal;
  cancel(taskId: string, reason?: unknown): void;
  delete(taskId: string): void;
  clear(reason?: unknown): void;
}

export interface EngineMcpProtocolServerRuntime {
  readonly server: Server;
  sendToolListChanged(): Promise<void>;
  sendPromptListChanged(): Promise<void>;
  sendAdapterStateUpdated(): Promise<void>;
}

export interface EngineMcpRootsChangeState {
  version: number;
}

export interface EngineMcpInvocationRootsState {
  readonly changeState: EngineMcpRootsChangeState;
  cachedVersion?: number;
  cachedRoots?: EngineMcpRootsListResult;
}

export interface EngineMcpInvocationSamplingState {
  turnCount: number;
}

export interface EngineMcpRootsListResult {
  roots: Array<{
    uri: string;
    name?: string;
  }>;
}

export interface ResolvedStreamableHttpAuthorization {
  metadata: EngineMcpProtectedResourceMetadata;
  metadataUrls: {
    root: string;
    pathSpecific: string;
  };
  metadataPaths: {
    root: string;
    pathSpecific: string;
  };
  requiredScopes: readonly string[];
  validateAccessToken(
    context: EngineMcpAccessTokenValidationContext
  ): Promise<EngineMcpAccessTokenValidationResult>;
}

export interface EngineMcpAuthorizationFailure {
  httpStatus: 401 | 403;
  error: EngineMcpToolError;
  wwwAuthenticate: string;
}

const CORE_SERVER_PACKAGE_URL = new URL("../package.json", import.meta.url);

export const DEFAULT_STREAMABLE_HTTP_HOST = "127.0.0.1";
export const DEFAULT_STREAMABLE_HTTP_PATH = "/mcp";
export const DEFAULT_STREAMABLE_HTTP_MAX_REQUEST_BODY_BYTES = 1_048_576;
export const DEFAULT_STREAMABLE_HTTP_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_STREAMABLE_HTTP_HEADERS_TIMEOUT_MS = 30_000;
export const DEFAULT_STREAMABLE_HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const DEFAULT_STREAMABLE_HTTP_SESSION_IDLE_TTL_MS = 600_000;
export const DEFAULT_STREAMABLE_HTTP_SESSION_SWEEP_INTERVAL_MS = 60_000;
export const DEFAULT_CORE_SERVER_ADAPTER_NAME = "unity";
export const DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENTS_PER_STREAM = 256;
export const DEFAULT_IN_MEMORY_EVENT_STORE_MAX_EVENT_AGE_MS = 300_000;
export const DEFAULT_IN_MEMORY_EVENT_STORE_PRUNE_INTERVAL_MS = 60_000;
export const DEFAULT_EXPERIMENTAL_TASK_TTL_MS = 300_000;
export const DEFAULT_EXPERIMENTAL_TASK_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_EXPERIMENTAL_TASK_CHILD_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_IN_MEMORY_TASK_MESSAGE_RETENTION_MS = 300_000;
export const DEFAULT_IN_MEMORY_TASK_MESSAGE_PRUNE_INTERVAL_MS = 60_000;
export const CORE_SERVER_ADAPTER_STATE_RESOURCE_URI = "engine-mcp://runtime/adapter-state";
export const CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE = "application/json";
export const CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI = "engine-mcp://runtime/journal-index";
export const CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI =
  "engine-mcp://runtime/snapshot-metadata-index";
export const CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH =
  "/.well-known/oauth-protected-resource";

const coreServerPackage = readJsonFile<{
  name?: string;
  version?: string;
}>(CORE_SERVER_PACKAGE_URL);

export const DEFAULT_CORE_SERVER_INFO = Object.freeze({
  name: coreServerPackage.name ?? "@engine-mcp/core-server",
  version: coreServerPackage.version ?? "0.0.0"
} satisfies Implementation);

export const DEFAULT_CORE_SERVER_INSTRUCTIONS =
  "Universal Game Engine MCP bootstrap server. Exposes canonical engine-agnostic tools backed by the preferred Unity adapter.";

export class EngineMcpConformancePreflightError extends Error {
  readonly report: ConformanceReport;

  constructor(report: ConformanceReport) {
    super(`Conformance preflight failed. ${summarizeConformanceReport(report)}`);
    this.name = "EngineMcpConformancePreflightError";
    this.report = report;
  }
}

export function createStaticBearerAuthorization(
  options: EngineMcpStaticBearerAuthorizationOptions
): EngineMcpHttpAuthorizationOptions {
  const grantedScopes = Object.freeze([
    ...(options.grantedScopes ?? options.requiredScopes ?? options.scopesSupported ?? [])
  ]);
  const requiredScopes = Object.freeze([...(options.requiredScopes ?? [])]);

  return {
    authorizationServers: options.authorizationServers,
    ...(options.resource ? { resource: options.resource } : {}),
    ...(options.scopesSupported ? { scopesSupported: options.scopesSupported } : {}),
    ...(requiredScopes.length > 0 ? { requiredScopes } : {}),
    async validateAccessToken({
      token
    }: EngineMcpAccessTokenValidationContext): Promise<EngineMcpAccessTokenValidationResult> {
      if (!token || token !== options.token) {
        return {
          ok: false,
          status: 401,
          error: "invalid_token",
          ...(requiredScopes.length > 0 ? { requiredScopes } : {})
        };
      }

      if (requiredScopes.some((scope) => !grantedScopes.includes(scope))) {
        return {
          ok: false,
          status: 403,
          error: "insufficient_scope",
          requiredScopes
        };
      }

      return {
        ok: true,
        ...(grantedScopes.length > 0 ? { scopes: grantedScopes } : {})
      };
    }
  };
}

export function createCoreServerAdapterRegistry(
  options: EngineMcpAdapterRegistryOptions = {}
): EngineMcpAdapterRegistry {
  const factories = new Map<string, EngineMcpAdapterFactory>([
    [
      DEFAULT_CORE_SERVER_ADAPTER_NAME,
      ({ unityBridge }) => createUnityBridgePreferredAdapter(unityBridge)
    ]
  ]);

  for (const entry of options.entries ?? []) {
    factories.set(entry.name, entry.create);
  }

  const defaultAdapterName = options.defaultAdapterName ?? DEFAULT_CORE_SERVER_ADAPTER_NAME;

  if (!factories.has(defaultAdapterName)) {
    throw new Error(
      `Default adapter "${defaultAdapterName}" is not registered. Known adapters: ${formatKnownAdapters(
        factories.keys()
      )}`
    );
  }

  return {
    defaultAdapterName,
    list(): readonly string[] {
      return Object.freeze([...factories.keys()]);
    },
    async resolve(
      adapterName: string | undefined,
      context: EngineMcpAdapterFactoryContext
    ): Promise<EngineMcpCapabilityAdapter> {
      const selectedAdapterName = adapterName ?? defaultAdapterName;
      const factory = factories.get(selectedAdapterName);

      if (!factory) {
        throw new Error(
          `Unknown adapter "${selectedAdapterName}". Known adapters: ${formatKnownAdapters(
            factories.keys()
          )}`
        );
      }

      return factory(context);
    }
  };
}

function readJsonFile<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function formatKnownAdapters(adapterNames: Iterable<string>): string {
  const knownAdapters = [...adapterNames];
  return knownAdapters.length > 0 ? knownAdapters.join(", ") : "(none)";
}
