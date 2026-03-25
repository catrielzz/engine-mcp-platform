import { describe, expect, it } from "vitest";

import {
  CORE_ERROR_CODES,
  JOURNAL_ACTOR_TYPE_VALUES,
  JOURNAL_RESULT_STATUS_VALUES,
  POLICY_DECISION_VALUES,
  POLICY_SCOPE_VALUES,
  ROLLBACK_STATUS_VALUES,
  SNAPSHOT_SCOPE_VALUES,
  type JournalEntry,
  type PolicyDecisionRecord,
  type RollbackResult,
  type SnapshotCreateResult
} from "./index.js";

describe("hardening contracts", () => {
  it("exports the canonical policy and recovery enums", () => {
    expect(POLICY_SCOPE_VALUES).toEqual(["read", "write", "project", "external"]);
    expect(POLICY_DECISION_VALUES).toEqual(["allow", "deny"]);
    expect(CORE_ERROR_CODES).toEqual([
      "policy_denied",
      "scope_missing",
      "snapshot_required",
      "target_outside_sandbox",
      "rollback_unavailable",
      "journal_write_failed"
    ]);
    expect(JOURNAL_ACTOR_TYPE_VALUES).toEqual(["client", "automation", "system"]);
    expect(JOURNAL_RESULT_STATUS_VALUES).toEqual([
      "pending",
      "succeeded",
      "failed",
      "denied",
      "rolled_back"
    ]);
    expect(SNAPSHOT_SCOPE_VALUES).toEqual([
      "sandbox_scene",
      "sandbox_assets",
      "sandbox_workspace"
    ]);
    expect(ROLLBACK_STATUS_VALUES).toEqual(["accepted", "completed", "failed", "unavailable"]);
  });

  it("supports representative policy, journal, snapshot, and rollback records", () => {
    const decision: PolicyDecisionRecord = {
      capability: "scene.object.delete",
      riskClass: "destructive",
      decision: "allow",
      requiredScopes: ["write", "project"],
      requiresSnapshot: true,
      sandboxOnly: true
    };

    const snapshot: SnapshotCreateResult = {
      created: true,
      snapshot: {
        snapshotId: "snapshot-001",
        adapterId: "unity-bridge",
        createdAt: "2026-03-25T12:00:00Z",
        scope: "sandbox_scene",
        targetPath: "Assets/Scenes/Sandbox.unity",
        label: "pre-delete",
        capability: "scene.object.delete"
      }
    };

    const journal: JournalEntry = {
      id: "journal-001",
      timestamp: "2026-03-25T12:00:01Z",
      capability: "scene.object.delete",
      riskClass: "destructive",
      actor: {
        type: "client",
        id: "codex"
      },
      target: {
        logicalName: "SandboxRoot/GeneratedCube",
        sandboxed: true
      },
      decision,
      result: {
        status: "succeeded",
        durationMs: 52
      },
      snapshot: {
        snapshotId: snapshot.snapshot.snapshotId,
        rollbackAvailable: true
      }
    };

    const rollback: RollbackResult = {
      snapshotId: snapshot.snapshot.snapshotId,
      status: "completed",
      restoredTargets: ["SandboxRoot/GeneratedCube"]
    };

    expect(journal.decision.requiresSnapshot).toBe(true);
    expect(journal.snapshot?.snapshotId).toBe("snapshot-001");
    expect(rollback.status).toBe("completed");
  });
});
