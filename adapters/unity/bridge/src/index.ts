import { FIRST_CAPABILITY_SLICE } from "@engine-mcp/contracts";

export {
  UNITY_LOCAL_HTTP_CALL_PATH,
  UNITY_LOCAL_HTTP_DEFAULT_HOST,
  UNITY_LOCAL_HTTP_DEFAULT_PORT,
  UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER,
  UNITY_LOCAL_BRIDGE_CAPABILITIES,
  UNITY_LOCAL_BRIDGE_ERROR_CODES,
  UNITY_LOCAL_BRIDGE_PROTOCOL_VERSION,
  UNITY_LOCAL_SESSION_BOOTSTRAP_DIRECTORY,
  UNITY_LOCAL_SESSION_BOOTSTRAP_ENVIRONMENT_VARIABLE,
  UNITY_LOCAL_SESSION_BOOTSTRAP_FILE_NAME,
  UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_DIRECTORY,
  UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_ENVIRONMENT_VARIABLE,
  UNITY_PLUGIN_LOCAL_SESSION_BOOTSTRAP_FILE_NAME,
  buildUnityLocalHttpCallUrl,
  createUnityLocalBridgeSessionBootstrap,
  createUnityLocalBridgeErrorResponse,
  createUnityLocalBridgeRequest,
  createUnityLocalBridgeSuccessResponse,
  isUnityLocalBridgeCapability,
  isUnityLocalBridgeErrorCode,
  parseUnityLocalBridgeRequest,
  parseUnityLocalBridgeResponse,
  parseUnityLocalBridgeSessionBootstrap,
  type UnityLocalBridgeCallRequest,
  type UnityLocalBridgeCallResponse,
  type UnityLocalBridgeCapability,
  type UnityLocalBridgeError,
  type UnityLocalBridgeErrorCode,
  type UnityLocalBridgeSessionBootstrap,
  type UnityLocalBridgeTransport
} from "./contracts/plugin-contract.js";
export {
  UnityBridgePluginBootstrapError,
  UnityBridgePolicyError,
  UnityBridgeRemoteError,
  UnityBridgeValidationError
} from "./errors.js";
export {
  createManagedUnityBridgeLocalHttpSession,
  createUnityBridgeLocalHttpServer,
  createUnityBridgeSessionToken,
  DEFAULT_UNITY_LOCAL_HTTP_INVOCATION_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_MAX_CONCURRENT_REQUESTS,
  DEFAULT_UNITY_LOCAL_HTTP_HEADERS_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_MAX_BODY_BYTES,
  DEFAULT_UNITY_LOCAL_HTTP_MAX_REQUESTS_PER_SOCKET,
  DEFAULT_UNITY_LOCAL_HTTP_REQUEST_TIMEOUT_MS,
  DEFAULT_UNITY_LOCAL_HTTP_SESSION_IDLE_TTL_MS,
  DEFAULT_UNITY_LOCAL_HTTP_SESSION_SWEEP_INTERVAL_MS,
  type ManagedUnityBridgeLocalHttpSession,
  type ManagedUnityBridgeLocalHttpSessionOptions,
  type ManagedUnityBridgeLocalHttpSessionState,
  type UnityBridgeLocalHttpAdapter,
  type UnityBridgeInvocationContext,
  type UnityBridgeLocalHttpInvocation,
  type UnityBridgeLocalHttpServer,
  type UnityBridgeLocalHttpServerAddress,
  type UnityBridgeLocalHttpServerOptions
} from "./transport/local-http.js";
export {
  deleteUnityBridgeSessionBootstrap,
  getDefaultUnityBridgeSessionBootstrapPath,
  readUnityBridgeSessionBootstrap,
  writeUnityBridgeSessionBootstrap,
  writeUnityBridgeSessionBootstrapForLocalHttp
} from "./bootstrap/session-bootstrap.js";
export {
  deleteUnityPluginSessionBootstrap,
  getDefaultUnityPluginSessionBootstrapPath,
  readUnityPluginSessionBootstrap,
  writeUnityPluginSessionBootstrap,
  writeUnityPluginSessionBootstrapForLocalHttp
} from "./bootstrap/plugin-session-bootstrap.js";
export {
  createUnityBridgePluginProxyAdapter,
  UnityBridgePluginProxyAdapter,
  type UnityBridgePluginProxyOptions
} from "./proxy/plugin-proxy.js";
export {
  createUnityBridgePreferredAdapter,
  UnityBridgePreferredAdapter,
  type UnityBridgePreferredAdapterOptions
} from "./proxy/preferred-adapter.js";
export {
  createUnityBridgeSandboxAdapter,
  UnityBridgeSandboxAdapter
} from "./fallback/sandbox-adapter.js";
export {
  UNITY_BRIDGE_CAPABILITIES,
  UNITY_SANDBOX_OBJECT_NAME_PREFIX,
  UNITY_SANDBOX_ROOT_LOGICAL_NAME,
  type UnityBridgeActivity,
  type UnityBridgeAdapterRequest,
  type UnityBridgeAssetKind,
  type UnityBridgeCapability,
  type UnityBridgeConsoleEntryRecord,
  type UnityBridgeConsoleEntrySeed,
  type UnityBridgeConsoleSeverity,
  type UnityBridgeEditorState,
  type UnityBridgeObjectRecord,
  type UnityBridgeSandboxAssetRecord,
  type UnityBridgeSandboxOptions,
  type UnityBridgeSnapshotRecord,
  type UnityBridgeTransformRecord
} from "./fallback/sandbox-model.js";

export const UNITY_BRIDGE_P0_CAPABILITIES = FIRST_CAPABILITY_SLICE;
