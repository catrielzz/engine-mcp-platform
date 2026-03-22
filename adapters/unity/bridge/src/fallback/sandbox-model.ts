import type { CapabilityName } from "@engine-mcp/contracts";
import type { PolicyEvaluator, SessionScope } from "@engine-mcp/policy-engine";

import {
  UNITY_LOCAL_BRIDGE_CAPABILITIES,
  type UnityLocalBridgeCapability
} from "../contracts/plugin-contract.js";

export const UNITY_SANDBOX_ROOT_LOGICAL_NAME = "SandboxRoot";
export const UNITY_SANDBOX_OBJECT_NAME_PREFIX = "MCP_E2E__";
export const UNITY_BRIDGE_CAPABILITIES = UNITY_LOCAL_BRIDGE_CAPABILITIES;

export type UnityBridgeCapability = UnityLocalBridgeCapability;
export type UnityBridgeActivity =
  | "idle"
  | "busy"
  | "compiling"
  | "testing"
  | "playing"
  | "importing";
export type UnityBridgeAssetKind =
  | "scene"
  | "prefab"
  | "script"
  | "material"
  | "texture"
  | "shader"
  | "other";
export type UnityBridgeConsoleSeverity = "info" | "warning" | "error";

export interface UnityBridgeAdapterRequest {
  capability: CapabilityName;
  input: unknown;
}

export interface UnityBridgeTransformRecord {
  position?: [number, number, number];
  rotationEuler?: [number, number, number];
  scale?: [number, number, number];
}

export interface UnityBridgeObjectRecord {
  logicalName: string;
  displayName: string;
  active: boolean;
  components: string[];
  labels: string[];
  transform: UnityBridgeTransformRecord;
  children: UnityBridgeObjectRecord[];
}

export interface UnityBridgeEditorState {
  engineVersion: string;
  workspaceName: string;
  activity: UnityBridgeActivity;
  isReady: boolean;
}

export interface UnityBridgeSnapshotRecord {
  snapshotId: string;
  createdAt: string;
  label?: string;
  capability: "scene.object.delete";
  targetLogicalName: string;
  roots: UnityBridgeObjectRecord[];
}

export interface UnityBridgeSandboxAssetRecord {
  assetGuid: string;
  assetPath: string;
  displayName: string;
  kind: UnityBridgeAssetKind;
}

export interface UnityBridgeConsoleEntrySeed {
  severity: UnityBridgeConsoleSeverity;
  message: string;
  channel?: string;
  source?: string;
  sequence?: number;
  timestamp?: string;
}

export interface UnityBridgeConsoleEntryRecord {
  severity: UnityBridgeConsoleSeverity;
  message: string;
  channel: string;
  source: string;
  sequence: number;
  timestamp: string;
}

export interface UnityBridgeSandboxOptions {
  editorState?: Partial<UnityBridgeEditorState>;
  sceneName?: string;
  roots?: UnityBridgeObjectRecord[];
  assets?: UnityBridgeSandboxAssetRecord[];
  consoleEntries?: UnityBridgeConsoleEntrySeed[];
  canCaptureSnapshots?: boolean;
  sessionScope?: SessionScope;
  policyEvaluator?: PolicyEvaluator;
}

export interface EntityReferenceInput {
  logicalName?: string;
  enginePath?: string;
  displayName?: string;
}

export interface SceneHierarchyReadInput {
  includeComponents?: boolean;
}

export interface AssetSearchInput {
  query?: string;
  roots?: string[];
  kinds?: UnityBridgeAssetKind[];
  limit?: number;
}

export interface ScriptValidateInput {
  path?: string;
  assetGuid?: string;
  includeWarnings?: boolean;
}

export interface ConsoleReadInput {
  sinceSequence?: number;
  severities?: UnityBridgeConsoleSeverity[];
  limit?: number;
}

export interface SceneObjectCreateInput {
  name: string;
  parent?: EntityReferenceInput;
  components?: Array<{
    type: string;
  }>;
  labels?: string[];
  setActive?: boolean;
  transform?: UnityBridgeTransformRecord;
}

export interface SceneObjectUpdateInput {
  target: EntityReferenceInput;
  newName?: string;
  newParent?: EntityReferenceInput;
  transform?: UnityBridgeTransformRecord;
  components?: Array<{
    type: string;
  }>;
  labels?: string[];
  active?: boolean;
}

export interface SceneObjectDeleteInput {
  target: EntityReferenceInput;
  allowMissing?: boolean;
  snapshotLabel?: string;
}

export interface SnapshotRestoreInput {
  snapshotId: string;
}

export interface TestRunInput {
  filter?: {
    namePattern?: string;
    paths?: string[];
    tags?: string[];
  };
  executionTarget?: "editor" | "runtime" | "all";
  waitForCompletion?: boolean;
  timeoutMs?: number;
}

export interface TestJobReadInput {
  jobId: string;
  maxResults?: number;
}

export interface UnityBridgeTestCaseResultRecord {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  message?: string;
}

export interface UnityBridgeTestJobRecord {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  acceptedFilter?: TestRunInput["filter"];
  progress: number;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
  };
  results: UnityBridgeTestCaseResultRecord[];
}

export interface UnityBridgeNodeReference {
  record: UnityBridgeObjectRecord;
  siblings: UnityBridgeObjectRecord[];
  index: number;
  parent?: UnityBridgeObjectRecord;
}

export function cloneRecords(records: readonly UnityBridgeObjectRecord[]): UnityBridgeObjectRecord[] {
  return records.map((record) => ({
    logicalName: record.logicalName,
    displayName: record.displayName,
    active: record.active,
    components: [...record.components],
    labels: [...record.labels],
    transform: cloneTransform(record.transform),
    children: cloneRecords(record.children)
  }));
}

export function cloneTransform(transform: UnityBridgeTransformRecord): UnityBridgeTransformRecord {
  return {
    ...(transform.position ? { position: [...transform.position] as [number, number, number] } : {}),
    ...(transform.rotationEuler
      ? { rotationEuler: [...transform.rotationEuler] as [number, number, number] }
      : {}),
    ...(transform.scale ? { scale: [...transform.scale] as [number, number, number] } : {})
  };
}

export function mergeTransforms(
  current: UnityBridgeTransformRecord,
  patch: UnityBridgeTransformRecord
): UnityBridgeTransformRecord {
  return {
    ...cloneTransform(current),
    ...cloneTransform(patch)
  };
}

export function rewriteLogicalNames(record: UnityBridgeObjectRecord, logicalName: string): void {
  record.logicalName = logicalName;

  for (const child of record.children) {
    rewriteLogicalNames(child, `${logicalName}/${child.displayName}`);
  }
}

export function matchesReference(
  record: UnityBridgeObjectRecord,
  reference: EntityReferenceInput
): boolean {
  if (reference.logicalName && record.logicalName === reference.logicalName) {
    return true;
  }

  if (reference.displayName && record.displayName === reference.displayName) {
    return true;
  }

  return false;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function ensureUnitySandboxObjectName(name: string): string {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return trimmed;
  }

  if (
    trimmed === UNITY_SANDBOX_ROOT_LOGICAL_NAME ||
    trimmed.startsWith(UNITY_SANDBOX_OBJECT_NAME_PREFIX)
  ) {
    return trimmed;
  }

  return `${UNITY_SANDBOX_OBJECT_NAME_PREFIX}${trimmed}`;
}

export function normalizeTestFilter(
  filter: TestRunInput["filter"]
): TestRunInput["filter"] | undefined {
  if (!filter) {
    return undefined;
  }

  return {
    ...(filter.namePattern ? { namePattern: filter.namePattern } : {}),
    ...(filter.paths && filter.paths.length > 0 ? { paths: [...filter.paths] } : {}),
    ...(filter.tags && filter.tags.length > 0 ? { tags: [...filter.tags] } : {})
  };
}

export function createDefaultTestJobRecord(jobId: string): UnityBridgeTestJobRecord {
  return {
    jobId,
    status: "completed",
    progress: 1,
    summary: {
      passed: 1,
      failed: 0,
      skipped: 0
    },
    results: [
      {
        name: "Sandbox.EditMode.GeneratedTest",
        status: "passed"
      }
    ]
  };
}
