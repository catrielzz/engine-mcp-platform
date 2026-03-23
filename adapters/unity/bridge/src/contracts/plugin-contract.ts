import { SESSION_SCOPES, type SessionScope } from "@engine-mcp/policy-engine";

export const UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION = "0.1.0";
export const UNITY_LOCAL_HTTP_DEFAULT_HOST = "127.0.0.1";
export const UNITY_LOCAL_HTTP_DEFAULT_PORT = 38123;
export const UNITY_LOCAL_HTTP_CALL_PATH = "/bridge/call";
export const UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER = "x-engine-mcp-session-token";
export const UNITY_LOCAL_SESSION_BOOTSTRAP_ENVIRONMENT_VARIABLE = "ENGINE_MCP_UNITY_BRIDGE_SESSION_FILE";
export const UNITY_LOCAL_SESSION_BOOTSTRAP_DIRECTORY = "engine-mcp-platform/unity-bridge";
export const UNITY_LOCAL_SESSION_BOOTSTRAP_FILE_NAME = "engine-mcp-unity-bridge-session.json";
export const UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_ENVIRONMENT_VARIABLE =
  "ENGINE_MCP_UNITY_PLUGIN_SESSION_FILE";
export const UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_DIRECTORY = "engine-mcp-platform/unity-plugin";
export const UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_FILE_NAME = "engine-mcp-unity-plugin-session.json";

export const UNITY_LOCAL_BRIDGE_CAPABILITIES = [
  "editor.state.read",
  "asset.search",
  "script.validate",
  "console.read",
  "scene.hierarchy.read",
  "scene.object.create",
  "scene.object.update",
  "scene.object.delete",
  "snapshot.restore",
  "test.run",
  "test.job.read"
] as const;

export const UNITY_LOCAL_BRIDGE_ERROR_CODES = [
  "validation_error",
  "policy_denied",
  "scope_missing",
  "target_not_found",
  "snapshot_failed",
  "bridge_transport_error"
] as const;

const UNITY_LOCAL_BRIDGE_LEGACY_ERROR_CODES = ["rollback_unavailable"] as const;

export type UnityLocalBridgeCapability = (typeof UNITY_LOCAL_BRIDGE_CAPABILITIES)[number];
export type UnityLocalBridgeErrorCode = (typeof UNITY_LOCAL_BRIDGE_ERROR_CODES)[number];
type UnityLocalBridgeLegacyErrorCode = (typeof UNITY_LOCAL_BRIDGE_LEGACY_ERROR_CODES)[number];
export type UnityLocalBridgeTransport = "local_http";

export interface UnityLocalBridgeError {
  code: UnityLocalBridgeErrorCode;
  message: string;
  details?: unknown;
}

export interface UnityLocalBridgeSessionBootstrap {
  protocolVersion: string;
  transport: UnityLocalBridgeTransport;
  endpointUrl: string;
  sessionToken: string;
  issuedAt: string;
  ownerProcessId: number;
}

export interface UnityLocalBridgeCallRequest {
  protocolVersion: string;
  requestId: string;
  capability: UnityLocalBridgeCapability;
  sessionScope: SessionScope;
  payload: unknown;
}

export interface UnityLocalBridgeCallResponse {
  protocolVersion: string;
  requestId: string;
  success: boolean;
  payload: unknown;
  snapshotId?: string;
  error?: UnityLocalBridgeError;
}

export interface CreateUnityLocalBridgeRequestOptions {
  requestId: string;
  capability: UnityLocalBridgeCapability;
  sessionScope: SessionScope;
  payload: unknown;
  protocolVersion?: string;
}

export interface CreateUnityLocalBridgeResponseOptions {
  protocolVersion?: string;
  snapshotId?: string;
}

export function isUnityLocalBridgeCapability(value: string): value is UnityLocalBridgeCapability {
  return UNITY_LOCAL_BRIDGE_CAPABILITIES.includes(value as UnityLocalBridgeCapability);
}

export function isUnityLocalBridgeErrorCode(value: string): value is UnityLocalBridgeErrorCode {
  return UNITY_LOCAL_BRIDGE_ERROR_CODES.includes(value as UnityLocalBridgeErrorCode);
}

function isUnityLocalBridgeLegacyErrorCode(value: string): value is UnityLocalBridgeLegacyErrorCode {
  return UNITY_LOCAL_BRIDGE_LEGACY_ERROR_CODES.includes(value as UnityLocalBridgeLegacyErrorCode);
}

export function createUnityLocalBridgeRequest(
  options: CreateUnityLocalBridgeRequestOptions
): UnityLocalBridgeCallRequest {
  return {
    protocolVersion: options.protocolVersion ?? UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
    requestId: options.requestId,
    capability: options.capability,
    sessionScope: options.sessionScope,
    payload: options.payload
  };
}

export function createUnityLocalBridgeSuccessResponse(
  requestId: string,
  payload: unknown,
  options: CreateUnityLocalBridgeResponseOptions = {}
): UnityLocalBridgeCallResponse {
  return {
    protocolVersion: options.protocolVersion ?? UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
    requestId,
    success: true,
    payload,
    ...(options.snapshotId ? { snapshotId: options.snapshotId } : {})
  };
}

export function createUnityLocalBridgeErrorResponse(
  requestId: string,
  error: UnityLocalBridgeError,
  payload: unknown = null,
  options: CreateUnityLocalBridgeResponseOptions = {}
): UnityLocalBridgeCallResponse {
  return {
    protocolVersion: options.protocolVersion ?? UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
    requestId,
    success: false,
    payload,
    ...(options.snapshotId ? { snapshotId: options.snapshotId } : {}),
    error
  };
}

export function buildUnityLocalHttpCallUrl(
  host: string = UNITY_LOCAL_HTTP_DEFAULT_HOST,
  port: number = UNITY_LOCAL_HTTP_DEFAULT_PORT,
  path: string = UNITY_LOCAL_HTTP_CALL_PATH
): string {
  return `http://${host}:${port}${path}`;
}

export function createUnityLocalBridgeSessionBootstrap(
  endpointUrl: string,
  sessionToken: string,
  issuedAt: string = new Date().toISOString(),
  ownerProcessId: number = process.pid
): UnityLocalBridgeSessionBootstrap {
  return {
    protocolVersion: UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
    transport: "local_http",
    endpointUrl,
    sessionToken,
    issuedAt,
    ownerProcessId
  };
}

export function parseUnityLocalBridgeSessionBootstrap(json: string): UnityLocalBridgeSessionBootstrap {
  const value = parseJsonRecord(json, "local bridge session bootstrap");
  const protocolVersion = expectProtocolVersion(value, "local bridge session bootstrap");
  const transport = expectNonEmptyStringField(value, "transport", "local bridge session bootstrap");
  const endpointUrl = expectNonEmptyStringField(value, "endpointUrl", "local bridge session bootstrap");
  const sessionToken = expectNonEmptyStringField(value, "sessionToken", "local bridge session bootstrap");
  const issuedAt = expectNonEmptyStringField(value, "issuedAt", "local bridge session bootstrap");
  const ownerProcessId = expectPositiveIntegerField(
    value,
    "ownerProcessId",
    "local bridge session bootstrap"
  );

  if (transport !== "local_http") {
    throw new Error(
      `Invalid local bridge session bootstrap. Unsupported transport: ${transport}.`
    );
  }

  return {
    protocolVersion,
    transport,
    endpointUrl,
    sessionToken,
    issuedAt,
    ownerProcessId
  };
}

export function parseUnityLocalBridgeRequest(json: string): UnityLocalBridgeCallRequest {
  const value = parseJsonRecord(json, "local bridge request");
  const protocolVersion = expectProtocolVersion(value, "local bridge request");
  const requestId = expectNonEmptyStringField(value, "requestId", "local bridge request");
  const capability = expectNonEmptyStringField(value, "capability", "local bridge request");
  const sessionScope = expectNonEmptyStringField(value, "sessionScope", "local bridge request");

  if (!isUnityLocalBridgeCapability(capability)) {
    throw new Error(`Invalid local bridge request. Unsupported capability: ${capability}.`);
  }

  if (!isSessionScope(sessionScope)) {
    throw new Error(`Invalid local bridge request. Unsupported sessionScope: ${sessionScope}.`);
  }

  if (!("payload" in value)) {
    throw new Error("Invalid local bridge request. Missing payload.");
  }

  return {
    protocolVersion,
    requestId,
    capability,
    sessionScope,
    payload: value.payload
  };
}

export function parseUnityLocalBridgeResponse(json: string): UnityLocalBridgeCallResponse {
  const value = parseJsonRecord(json, "local bridge response");
  const protocolVersion = expectProtocolVersion(value, "local bridge response");
  const requestId = expectNonEmptyStringField(value, "requestId", "local bridge response");
  const success = expectBooleanField(value, "success", "local bridge response");

  if (!("payload" in value)) {
    throw new Error("Invalid local bridge response. Missing payload.");
  }

  const snapshotId = readOptionalStringField(value, "snapshotId", "local bridge response");
  const error = readOptionalErrorField(value, "local bridge response");

  if (success && error) {
    throw new Error("Invalid local bridge response. Successful responses cannot include error.");
  }

  if (!success && !error) {
    throw new Error("Invalid local bridge response. Failed responses must include error.");
  }

  return {
    protocolVersion,
    requestId,
    success,
    payload: value.payload,
    ...(snapshotId ? { snapshotId } : {}),
    ...(error ? { error } : {})
  };
}

function isSessionScope(value: string): value is SessionScope {
  return SESSION_SCOPES.includes(value as SessionScope);
}

function parseJsonRecord(json: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Invalid ${label}. Expected valid JSON.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label}. Expected a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function expectProtocolVersion(record: Record<string, unknown>, label: string): string {
  const protocolVersion = expectNonEmptyStringField(record, "protocolVersion", label);

  if (protocolVersion !== UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION) {
    throw new Error(
      `Invalid ${label}. Unsupported protocolVersion: ${protocolVersion}. Expected ${UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION}.`
    );
  }

  return protocolVersion;
}

function expectNonEmptyStringField(
  record: Record<string, unknown>,
  fieldName: string,
  label: string
): string {
  const value = record[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}. Field ${fieldName} must be a non-empty string.`);
  }

  return value;
}

function expectBooleanField(record: Record<string, unknown>, fieldName: string, label: string): boolean {
  const value = record[fieldName];

  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${label}. Field ${fieldName} must be a boolean.`);
  }

  return value;
}

function expectPositiveIntegerField(
  record: Record<string, unknown>,
  fieldName: string,
  label: string
): number {
  const value = record[fieldName];

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}. Field ${fieldName} must be a positive integer.`);
  }

  return value;
}

function readOptionalStringField(
  record: Record<string, unknown>,
  fieldName: string,
  label: string
): string | undefined {
  const value = record[fieldName];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}. Field ${fieldName} must be a non-empty string when present.`);
  }

  return value;
}

function readOptionalErrorField(
  record: Record<string, unknown>,
  label: string
): UnityLocalBridgeError | undefined {
  const value = record.error;

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}. Field error must be an object when present.`);
  }

  const errorRecord = value as Record<string, unknown>;
  const code = expectNonEmptyStringField(errorRecord, "code", `${label} error`);
  const message = expectNonEmptyStringField(errorRecord, "message", `${label} error`);

  if (isUnityLocalBridgeErrorCode(code)) {
    return {
      code,
      message,
      ...(errorRecord.details !== undefined ? { details: errorRecord.details } : {})
    };
  }

  if (isUnityLocalBridgeLegacyErrorCode(code)) {
    return {
      code: "policy_denied",
      message: "rollback_unavailable",
      ...(errorRecord.details !== undefined ? { details: errorRecord.details } : {})
    };
  }

  if (!isUnityLocalBridgeErrorCode(code)) {
    throw new Error(`Invalid ${label}. Unsupported error code: ${code}.`);
  }

  throw new Error(`Invalid ${label}. Unsupported error code: ${code}.`);
}
