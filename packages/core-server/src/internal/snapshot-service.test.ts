import { describe, expect, it } from "vitest";

import { resolveInlineSnapshotLink } from "./snapshot-service.js";

describe("core-server snapshot service", () => {
  it("does not require snapshot linkage for non-destructive decisions", () => {
    expect(
      resolveInlineSnapshotLink({
        capability: "editor.state.read",
        adapterId: "fake-adapter",
        decision: {
          capability: "editor.state.read",
          riskClass: "read",
          decision: "allow",
          requiredScopes: ["read"],
          requiresSnapshot: false,
          sandboxOnly: false
        },
        output: {
          engine: "Unity"
        }
      })
    ).toEqual({});
  });

  it("creates a rollback-capable snapshot link for destructive mutation output", () => {
    expect(
      resolveInlineSnapshotLink({
        capability: "scene.object.delete",
        adapterId: "fake-adapter",
        decision: {
          capability: "scene.object.delete",
          riskClass: "destructive",
          decision: "allow",
          requiredScopes: ["write", "project"],
          requiresSnapshot: true,
          sandboxOnly: true
        },
        output: {
          deleted: true,
          snapshotId: "snapshot-001"
        }
      })
    ).toEqual({
      snapshot: {
        snapshotId: "snapshot-001",
        rollbackAvailable: true
      }
    });
  });

  it("marks rollback as unavailable after snapshot.restore", () => {
    expect(
      resolveInlineSnapshotLink({
        capability: "snapshot.restore",
        adapterId: "fake-adapter",
        decision: {
          capability: "snapshot.restore",
          riskClass: "destructive",
          decision: "allow",
          requiredScopes: ["write", "project"],
          requiresSnapshot: true,
          sandboxOnly: false
        },
        output: {
          restored: true,
          snapshotId: "snapshot-restore-001"
        }
      })
    ).toEqual({
      snapshot: {
        snapshotId: "snapshot-restore-001",
        rollbackAvailable: false
      }
    });
  });

  it("returns snapshot_required when a destructive success payload omits snapshot linkage", () => {
    expect(
      resolveInlineSnapshotLink({
        capability: "scene.object.delete",
        adapterId: "fake-adapter",
        decision: {
          capability: "scene.object.delete",
          riskClass: "destructive",
          decision: "allow",
          requiredScopes: ["write", "project"],
          requiresSnapshot: true,
          sandboxOnly: true
        },
        output: {
          deleted: true
        }
      })
    ).toEqual({
      error: {
        code: "snapshot_required",
        message: "snapshot_required",
        details: {
          capability: "scene.object.delete",
          adapterId: "fake-adapter",
          requiresSnapshot: true
        }
      }
    });
  });
});
