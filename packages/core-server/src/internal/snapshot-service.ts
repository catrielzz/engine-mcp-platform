import type { CapabilityName, JournalSnapshotLink, PolicyDecisionRecord } from "@engine-mcp/contracts";

import type { EngineMcpToolError } from "../shared.js";

export function resolveInlineSnapshotLink(options: {
  capability: CapabilityName;
  adapterId: string;
  decision: PolicyDecisionRecord;
  output: Readonly<Record<string, unknown>>;
}):
  | {
      snapshot?: JournalSnapshotLink;
    }
  | {
      error: EngineMcpToolError;
    } {
  if (!options.decision.requiresSnapshot) {
    return {};
  }

  const snapshotId = readSnapshotId(options.output);

  if (!snapshotId) {
    return {
      error: {
        code: "snapshot_required",
        message: "snapshot_required",
        details: {
          capability: options.capability,
          adapterId: options.adapterId,
          requiresSnapshot: true
        }
      }
    };
  }

  return {
    snapshot: {
      snapshotId,
      rollbackAvailable: options.capability !== "snapshot.restore"
    }
  };
}

function readSnapshotId(output: Readonly<Record<string, unknown>>): string | undefined {
  return typeof output.snapshotId === "string" && output.snapshotId.trim().length > 0
    ? output.snapshotId
    : undefined;
}
