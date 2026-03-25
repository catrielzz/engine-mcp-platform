import type {
  EngineMcpCoreServerOptions,
  EngineMcpStreamableHttpServerOptions,
  EngineMcpStdioServerOptions
} from "../index.js";

export const UNITY_LIVE_VALIDATION_ENABLE_ENV = "ENGINE_MCP_ENABLE_UNITY_LIVE_VALIDATION";
export const UNITY_LIVE_VALIDATION_BOOTSTRAP_PATH_ENV =
  "ENGINE_MCP_UNITY_LIVE_BOOTSTRAP_PATH";

export function isUnityLiveValidationEnabled(): boolean {
  return process.env[UNITY_LIVE_VALIDATION_ENABLE_ENV] === "true";
}

export function resolveUnityLiveBootstrapPath(): string | undefined {
  const value = process.env[UNITY_LIVE_VALIDATION_BOOTSTRAP_PATH_ENV]?.trim();
  return value ? value : undefined;
}

export function createUnityLiveValidationBridgeOptions():
  NonNullable<EngineMcpCoreServerOptions["unityBridge"]> {
  const bootstrapFilePath = resolveUnityLiveBootstrapPath();

  return {
    proxy: {
      ...(bootstrapFilePath ? { bootstrapFilePath } : {}),
      sessionScope: "dangerous_write"
    },
    fallbackToSandbox: false
  };
}

export function createUnityLiveValidationObjectName(prefix = "LiveRollbackProbeCube"): {
  objectName: string;
  logicalName: string;
} {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const objectName = `${prefix}-${suffix}`;

  return {
    objectName,
    logicalName: `SandboxRoot/MCP_E2E__${objectName}`
  };
}

export type UnityLiveValidationStdioOptions = Pick<
  EngineMcpStdioServerOptions,
  "persistence" | "unityBridge"
>;

export type UnityLiveValidationHttpOptions = Pick<
  EngineMcpStreamableHttpServerOptions,
  "persistence" | "unityBridge"
>;
