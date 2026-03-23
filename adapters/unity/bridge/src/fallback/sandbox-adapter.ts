import {
  getCapabilityDescriptor,
  validateCapabilityInput,
  validateCapabilityOutput,
  type CapabilityName
} from "@engine-mcp/contracts";
import {
  createSnapshotAvailabilityPolicyDetails,
  createSnapshotAvailabilityPolicyEvaluator,
  createSandboxBoundaryPolicyEvaluator,
  defaultPolicyEvaluator,
  denyRollbackUnavailable,
  resolvePolicyDecision,
  type PolicyEvaluator,
  type SessionScope
} from "@engine-mcp/policy-engine";

import {
  UnityBridgePolicyError,
  UnityBridgeRemoteError,
  UnityBridgeValidationError
} from "../errors.js";
import { createUnitySandboxBoundaryPolicyContext } from "./sandbox-policy.js";
import {
  UNITY_BRIDGE_CAPABILITIES,
  type AssetSearchInput,
  type ConsoleReadInput,
  type EntityReferenceInput,
  type SceneHierarchyReadInput,
  type SceneObjectCreateInput,
  type SceneObjectDeleteInput,
  type SceneObjectUpdateInput,
  type ScriptValidateInput,
  type SnapshotRestoreInput,
  type TestJobReadInput,
  type TestRunInput,
  type UnityBridgeAdapterRequest,
  type UnityBridgeConsoleEntryRecord,
  type UnityBridgeEditorState,
  type UnityBridgeNodeReference,
  type UnityBridgeObjectRecord,
  type UnityBridgeSandboxAssetRecord,
  type UnityBridgeSandboxOptions,
  type UnityBridgeSnapshotRecord,
  type UnityBridgeTestJobRecord,
  cloneRecords,
  cloneTransform,
  createDefaultTestJobRecord,
  ensureUnitySandboxObjectName,
  matchesReference,
  mergeTransforms,
  normalizeTestFilter,
  rewriteLogicalNames,
  uniqueStrings
} from "./sandbox-model.js";
import { extractSnapshotId, extractTargetLogicalName } from "../policy/request-targets.js";

export class UnityBridgeSandboxAdapter {
  readonly adapter = "unity-bridge-sandbox";
  readonly capabilities: readonly CapabilityName[] = UNITY_BRIDGE_CAPABILITIES;

  private readonly editorState: UnityBridgeEditorState;
  private readonly sceneName: string;
  private readonly sceneEnginePath: string;
  private readonly canCaptureSnapshots: boolean;
  private readonly sessionScope: SessionScope;
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly roots: UnityBridgeObjectRecord[];
  private readonly assets: UnityBridgeSandboxAssetRecord[];
  private readonly consoleEntries: UnityBridgeConsoleEntryRecord[];
  private readonly snapshots = new Map<string, UnityBridgeSnapshotRecord>();
  private readonly testJobs = new Map<string, UnityBridgeTestJobRecord>();
  private snapshotCounter = 0;
  private testJobCounter = 0;

  constructor(options: UnityBridgeSandboxOptions = {}) {
    this.editorState = {
      engineVersion: options.editorState?.engineVersion ?? "6000.2.0f1",
      workspaceName: options.editorState?.workspaceName ?? "UnitySandboxProject",
      activity: options.editorState?.activity ?? "idle",
      isReady: options.editorState?.isReady ?? true
    };
    this.sceneName = options.sceneName ?? "SandboxScene";
    this.sceneEnginePath = `Assets/MCP_Sandbox/Scenes/${this.sceneName}.unity`;
    this.canCaptureSnapshots = options.canCaptureSnapshots ?? true;
    this.sessionScope = options.sessionScope ?? "sandbox_write";
    this.policyEvaluator = createSandboxBoundaryPolicyEvaluator(
      (context) => createUnitySandboxBoundaryPolicyContext(context, this.sceneEnginePath),
      createSnapshotAvailabilityPolicyEvaluator(options.policyEvaluator ?? defaultPolicyEvaluator)
    );
    this.roots = cloneRecords(
      options.roots ?? [
        {
          logicalName: "SandboxRoot",
          displayName: "SandboxRoot",
          active: true,
          components: ["Transform"],
          labels: ["sandbox"],
          transform: {},
          children: []
        }
      ]
    );
    this.assets = options.assets ?? [
      {
        assetGuid: "sandbox-scene-001",
        assetPath: "Assets/MCP_Sandbox/Scenes/SandboxScene.unity",
        displayName: "SandboxScene",
        kind: "scene"
      },
      {
        assetGuid: "sandbox-prefab-001",
        assetPath: "Assets/MCP_Sandbox/Generated/SandboxCube.prefab",
        displayName: "SandboxCube",
        kind: "prefab"
      },
      {
        assetGuid: "sandbox-script-001",
        assetPath: "Assets/Scripts/Spawner.cs",
        displayName: "Spawner",
        kind: "script"
      },
      {
        assetGuid: "sandbox-material-001",
        assetPath: "Assets/MCP_Sandbox/Generated/SandboxMaterial.mat",
        displayName: "SandboxMaterial",
        kind: "material"
      }
    ];
    this.consoleEntries = (options.consoleEntries ?? [
      {
        severity: "info",
        message: "Sandbox bootstrap ready",
        channel: "unity",
        source: "editor",
        sequence: 1,
        timestamp: "2026-03-20T00:00:00.000Z"
      },
      {
        severity: "warning",
        message: "Sandbox compile warning",
        channel: "unity",
        source: "editor",
        sequence: 2,
        timestamp: "2026-03-20T00:00:01.000Z"
      },
      {
        severity: "error",
        message: "Sandbox exception captured",
        channel: "unity",
        source: "editor",
        sequence: 3,
        timestamp: "2026-03-20T00:00:02.000Z"
      }
    ]).map((entry, index) => ({
      severity: entry.severity,
      message: entry.message,
      channel: entry.channel ?? "unity",
      source: entry.source ?? "editor",
      sequence: entry.sequence ?? index + 1,
      timestamp: entry.timestamp ?? new Date(Date.UTC(2026, 2, 20, 0, 0, index)).toISOString()
    }));
  }

  async invoke(
    request: UnityBridgeAdapterRequest,
    _context?: { signal?: AbortSignal }
  ): Promise<unknown> {
    this.assertSupportedCapability(request.capability);
    this.assertValidInput(request.capability, request.input);
    await this.assertPolicyAllowed(request.capability, request.input);

    let output: unknown;

    switch (request.capability) {
      case "editor.state.read":
        output = this.handleEditorStateRead();
        break;
      case "asset.search":
        output = this.handleAssetSearch(request.input as AssetSearchInput);
        break;
      case "script.validate":
        output = this.handleScriptValidate(request.input as ScriptValidateInput);
        break;
      case "console.read":
        output = this.handleConsoleRead(request.input as ConsoleReadInput);
        break;
      case "scene.hierarchy.read":
        output = this.handleSceneHierarchyRead(request.input as SceneHierarchyReadInput);
        break;
      case "scene.object.create":
        output = this.handleSceneObjectCreate(request.input as SceneObjectCreateInput);
        break;
      case "scene.object.update":
        output = this.handleSceneObjectUpdate(request.input as SceneObjectUpdateInput);
        break;
      case "scene.object.delete":
        output = this.handleSceneObjectDelete(request.input as SceneObjectDeleteInput);
        break;
      case "snapshot.restore":
        output = this.handleSnapshotRestore(request.input as SnapshotRestoreInput);
        break;
      case "test.run":
        output = this.handleTestRun(request.input as TestRunInput);
        break;
      case "test.job.read":
        output = this.handleTestJobRead(request.input as TestJobReadInput);
        break;
      default:
        throw new Error(`Unsupported capability: ${request.capability}`);
    }

    this.assertValidOutput(request.capability, output);
    return output;
  }

  snapshotHierarchy(): UnityBridgeObjectRecord[] {
    return cloneRecords(this.roots);
  }

  listSnapshots(): UnityBridgeSnapshotRecord[] {
    return [...this.snapshots.values()].map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      createdAt: snapshot.createdAt,
      label: snapshot.label,
      capability: snapshot.capability,
      targetLogicalName: snapshot.targetLogicalName,
      roots: cloneRecords(snapshot.roots)
    }));
  }

  restoreSnapshot(snapshotId: string): boolean {
    return this.tryRestoreSnapshot(snapshotId) !== undefined;
  }

  private assertSupportedCapability(capability: CapabilityName): void {
    if (!UNITY_BRIDGE_CAPABILITIES.includes(capability as (typeof UNITY_BRIDGE_CAPABILITIES)[number])) {
      throw new Error(`Capability ${capability} is not implemented by ${this.adapter}`);
    }
  }

  private assertValidInput(capability: CapabilityName, input: unknown): void {
    const validation = validateCapabilityInput(capability, input);

    if (!validation.valid) {
      throw new UnityBridgeValidationError(
        capability,
        `Invalid ${capability} request for ${this.adapter}.`,
        validation.errors
      );
    }
  }

  private async assertPolicyAllowed(capability: CapabilityName, input: unknown): Promise<void> {
    const descriptor = getCapabilityDescriptor(capability);
    const decision = await resolvePolicyDecision(
      {
        adapter: this.adapter,
        capability,
        operationClass: descriptor.operationClass,
        sessionScope: this.sessionScope,
        input,
        target: extractTargetLogicalName(input),
        snapshotAvailable:
          (capability === "scene.object.delete" && this.canCaptureSnapshots) ||
          (capability === "snapshot.restore" && this.hasSnapshot(extractSnapshotId(input)))
      },
      this.policyEvaluator
    );

    if (!decision.allowed) {
      throw new UnityBridgePolicyError(capability, decision);
    }
  }

  private assertValidOutput(capability: CapabilityName, output: unknown): void {
    const validation = validateCapabilityOutput(capability, output);

    if (!validation.valid) {
      throw new UnityBridgeValidationError(
        capability,
        `Invalid ${capability} response from ${this.adapter}.`,
        validation.errors
      );
    }
  }

  private handleEditorStateRead(): unknown {
    return {
      engine: "Unity",
      engineVersion: this.editorState.engineVersion,
      workspaceName: this.editorState.workspaceName,
      isReady: this.editorState.isReady,
      activity: this.editorState.activity,
      selectionCount: 0,
      activeContainer: {
        displayName: this.sceneName,
        enginePath: this.sceneEnginePath
      },
      diagnostics: []
    };
  }

  private handleAssetSearch(input: AssetSearchInput): unknown {
    const query = input.query?.trim().toLowerCase() ?? "";
    const roots = input.roots?.map((root) => root.trim()).filter(Boolean) ?? [];
    const kinds = input.kinds ?? [];
    const filtered = this.assets.filter((asset) => {
      if (
        query.length > 0 &&
        !asset.displayName.toLowerCase().includes(query) &&
        !asset.assetPath.toLowerCase().includes(query)
      ) {
        return false;
      }

      if (
        roots.length > 0 &&
        !roots.some((root) => asset.assetPath === root || asset.assetPath.startsWith(`${root}/`))
      ) {
        return false;
      }

      if (kinds.length > 0 && !kinds.includes(asset.kind)) {
        return false;
      }

      return true;
    });
    const limit = Math.max(1, input.limit ?? 50);
    const results = filtered.slice(0, limit);

    return {
      results,
      total: filtered.length,
      truncated: filtered.length > results.length
    };
  }

  private handleScriptValidate(input: ScriptValidateInput): unknown {
    const targetScript = this.assets.find((asset) => {
      if (asset.kind !== "script") {
        return false;
      }

      if (input.path && asset.assetPath === input.path) {
        return true;
      }

      if (input.assetGuid && asset.assetGuid === input.assetGuid) {
        return true;
      }

      return false;
    });

    if (!targetScript) {
      throw new Error("target_not_found: script asset could not be resolved.");
    }

    return {
      targetPath: targetScript.assetPath,
      isValid: true,
      diagnostics: []
    };
  }

  private handleSceneHierarchyRead(input: SceneHierarchyReadInput): unknown {
    return {
      container: {
        displayName: this.sceneName,
        enginePath: this.sceneEnginePath
      },
      roots: this.roots.map((root) => this.toHierarchyNode(root, input.includeComponents ?? false))
    };
  }

  private handleConsoleRead(input: ConsoleReadInput): unknown {
    const sinceSequence = Math.max(0, input.sinceSequence ?? 0);
    const allowedSeverities = input.severities ? new Set(input.severities) : null;
    const filtered = this.consoleEntries.filter(
      (entry) =>
        entry.sequence > sinceSequence &&
        (!allowedSeverities || allowedSeverities.has(entry.severity))
    );
    const limit = Math.max(1, input.limit ?? 100);
    const entries = filtered.slice(0, limit);

    return {
      entries,
      nextSequence: entries.at(-1)?.sequence ?? sinceSequence,
      truncated: filtered.length > entries.length
    };
  }

  private handleSceneObjectCreate(input: SceneObjectCreateInput): unknown {
    const parentRecord = input.parent ? this.findObjectReference(input.parent) : undefined;
    const normalizedName = ensureUnitySandboxObjectName(input.name);
    const logicalName = parentRecord ? `${parentRecord.logicalName}/${normalizedName}` : normalizedName;
    const createdRecord: UnityBridgeObjectRecord = {
      logicalName,
      displayName: normalizedName,
      active: input.setActive ?? true,
      components: uniqueStrings(["Transform", ...(input.components?.map(({ type }) => type) ?? [])]),
      labels: uniqueStrings(input.labels ?? []),
      transform: cloneTransform(input.transform ?? {}),
      children: []
    };

    if (parentRecord) {
      parentRecord.children.push(createdRecord);
    } else {
      this.roots.push(createdRecord);
    }

    return {
      object: {
        logicalName: createdRecord.logicalName,
        displayName: createdRecord.displayName
      },
      container: {
        displayName: this.sceneName,
        enginePath: this.sceneEnginePath
      },
      created: true,
      transform: createdRecord.transform,
      appliedComponents: createdRecord.components
    };
  }

  private handleSceneObjectUpdate(input: SceneObjectUpdateInput): unknown {
    const targetReference = this.findNodeReference(input.target);

    if (!targetReference) {
      throw new Error("Target object not found for scene.object.update.");
    }

    const updatedFields: string[] = [];
    let currentParent = targetReference.parent;

    if (input.newParent) {
      const newParentReference = this.findNodeReference(input.newParent);

      if (!newParentReference) {
        throw new Error("New parent not found for scene.object.update.");
      }

      if (newParentReference.record.logicalName.startsWith(targetReference.record.logicalName)) {
        throw new Error("Cannot reparent an object under its own descendant.");
      }

      targetReference.siblings.splice(targetReference.index, 1);
      newParentReference.record.children.push(targetReference.record);
      currentParent = newParentReference.record;
      updatedFields.push("newParent");
    }

    if (input.newName) {
      targetReference.record.displayName = ensureUnitySandboxObjectName(input.newName);
      updatedFields.push("newName");
    }

    if (input.newParent || input.newName) {
      const nextLogicalName = currentParent
        ? `${currentParent.logicalName}/${targetReference.record.displayName}`
        : targetReference.record.displayName;

      rewriteLogicalNames(targetReference.record, nextLogicalName);
    }

    if (input.transform) {
      targetReference.record.transform = mergeTransforms(
        targetReference.record.transform,
        input.transform
      );
      updatedFields.push("transform");
    }

    if (input.components) {
      targetReference.record.components = uniqueStrings([
        "Transform",
        ...input.components.map(({ type }) => type)
      ]);
      updatedFields.push("components");
    }

    if (input.labels) {
      targetReference.record.labels = uniqueStrings(input.labels);
      updatedFields.push("labels");
    }

    if (typeof input.active === "boolean") {
      targetReference.record.active = input.active;
      updatedFields.push("active");
    }

    return {
      object: {
        logicalName: targetReference.record.logicalName,
        displayName: targetReference.record.displayName
      },
      updatedFields,
      transform: targetReference.record.transform
    };
  }

  private handleSceneObjectDelete(input: SceneObjectDeleteInput): unknown {
    const targetReference = this.findNodeReference(input.target);

    if (!targetReference) {
      if (input.allowMissing) {
        return {
          target: {
            logicalName: input.target.logicalName ?? input.target.displayName ?? "unknown"
          },
          deleted: false
        };
      }

      throw new Error("Target object not found for scene.object.delete.");
    }

    if (!this.canCaptureSnapshots) {
      throw new UnityBridgeRemoteError(
        "snapshot_failed",
        "Snapshot capture is unavailable for scene.object.delete."
      );
    }

    const snapshotId = this.captureSnapshot(targetReference.record.logicalName, input.snapshotLabel);
    targetReference.siblings.splice(targetReference.index, 1);

    return {
      target: {
        logicalName: targetReference.record.logicalName,
        displayName: targetReference.record.displayName
      },
      deleted: true,
      snapshotId
    };
  }

  private handleSnapshotRestore(input: SnapshotRestoreInput): unknown {
    const snapshot = this.tryRestoreSnapshot(input.snapshotId);

    if (!snapshot) {
      throw new UnityBridgePolicyError(
        "snapshot.restore",
        denyRollbackUnavailable(
          createSnapshotAvailabilityPolicyDetails({
            capability: "snapshot.restore",
            input
          })
        )
      );
    }

    const restoredTarget = this.findRecordByLogicalName(snapshot.targetLogicalName);

    return {
      snapshotId: snapshot.snapshotId,
      restored: true,
      ...(restoredTarget
        ? {
            target: {
              logicalName: restoredTarget.logicalName,
              displayName: restoredTarget.displayName
            }
          }
        : {})
    };
  }

  private handleTestRun(input: TestRunInput): unknown {
    this.testJobCounter += 1;
    const jobId = `test-job-${String(this.testJobCounter).padStart(4, "0")}`;
    const acceptedFilter = normalizeTestFilter(input.filter);
    const targetLabel = input.executionTarget === "runtime" ? "PlayMode" : "EditMode";
    const nameStem = acceptedFilter?.namePattern?.trim() || "Sandbox";
    const job: UnityBridgeTestJobRecord = {
      jobId,
      status: "completed",
      ...(acceptedFilter ? { acceptedFilter } : {}),
      progress: 1,
      summary: {
        passed: 1,
        failed: 0,
        skipped: 0
      },
      results: [
        {
          name: `${nameStem}.${targetLabel}.GeneratedTest`,
          status: "passed"
        }
      ]
    };

    this.testJobs.set(jobId, job);

    return {
      jobId,
      status: job.status,
      ...(acceptedFilter ? { acceptedFilter } : {})
    };
  }

  private handleTestJobRead(input: TestJobReadInput): unknown {
    const job = this.testJobs.get(input.jobId) ?? createDefaultTestJobRecord(input.jobId);
    const results = input.maxResults ? job.results.slice(0, input.maxResults) : job.results;

    return {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      summary: job.summary,
      results
    };
  }

  private captureSnapshot(targetLogicalName: string, label?: string): string {
    this.snapshotCounter += 1;
    const snapshotId = `snapshot-${String(this.snapshotCounter).padStart(4, "0")}`;

    this.snapshots.set(snapshotId, {
      snapshotId,
      createdAt: new Date().toISOString(),
      label,
      capability: "scene.object.delete",
      targetLogicalName,
      roots: cloneRecords(this.roots)
    });

    return snapshotId;
  }

  private hasSnapshot(snapshotId: string | undefined): boolean {
    return !!snapshotId && this.snapshots.has(snapshotId);
  }

  private tryRestoreSnapshot(snapshotId: string): UnityBridgeSnapshotRecord | undefined {
    const snapshot = this.snapshots.get(snapshotId);

    if (!snapshot) {
      return undefined;
    }

    this.roots.splice(0, this.roots.length, ...cloneRecords(snapshot.roots));
    this.snapshots.delete(snapshotId);

    return {
      snapshotId: snapshot.snapshotId,
      createdAt: snapshot.createdAt,
      label: snapshot.label,
      capability: snapshot.capability,
      targetLogicalName: snapshot.targetLogicalName,
      roots: cloneRecords(snapshot.roots)
    };
  }

  private findObjectReference(reference: EntityReferenceInput): UnityBridgeObjectRecord {
    const match = this.findNodeReference(reference);

    if (!match) {
      throw new Error("Object reference not found in sandbox hierarchy.");
    }

    return match.record;
  }

  private findNodeReference(
    reference: EntityReferenceInput,
    records: UnityBridgeObjectRecord[] = this.roots,
    parent?: UnityBridgeObjectRecord
  ): UnityBridgeNodeReference | undefined {
    for (const [index, record] of records.entries()) {
      if (matchesReference(record, reference)) {
        return {
          record,
          siblings: records,
          index,
          parent
        };
      }

      const childMatch = this.findNodeReference(reference, record.children, record);

      if (childMatch) {
        return childMatch;
      }
    }

    return undefined;
  }

  private findRecordByLogicalName(logicalName: string): UnityBridgeObjectRecord | undefined {
    return this.findNodeReference({ logicalName })?.record;
  }

  private toHierarchyNode(record: UnityBridgeObjectRecord, includeComponents: boolean): unknown {
    return {
      object: {
        logicalName: record.logicalName,
        displayName: record.displayName
      },
      active: record.active,
      labels: record.labels,
      ...(includeComponents ? { components: record.components } : {}),
      children: record.children.map((child) => this.toHierarchyNode(child, includeComponents))
    };
  }
}

export function createUnityBridgeSandboxAdapter(
  options: UnityBridgeSandboxOptions = {}
): UnityBridgeSandboxAdapter {
  return new UnityBridgeSandboxAdapter(options);
}
