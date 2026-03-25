import type {
  CapabilityName,
  JournalSnapshotLink,
  PolicyDecisionRecord,
  PolicyTargetDescriptor
} from "@engine-mcp/contracts";

import type {
  EngineMcpSnapshotMetadataRecord,
  EngineMcpToolError
} from "../shared.js";
import { createSnapshotMetadataRecord } from "./snapshot-metadata-store.js";

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

export function createInlineSnapshotMetadataRecord(options: {
  capability: CapabilityName;
  adapterId: string;
  snapshot: JournalSnapshotLink | undefined;
  target?: PolicyTargetDescriptor;
}): EngineMcpSnapshotMetadataRecord | undefined {
  if (!options.snapshot) {
    return undefined;
  }

  return createSnapshotMetadataRecord({
    capability: options.capability,
    adapterId: options.adapterId,
    snapshot: options.snapshot,
    ...(options.target ? { target: options.target } : {})
  });
}

function readSnapshotId(output: Readonly<Record<string, unknown>>): string | undefined {
  return typeof output.snapshotId === "string" && output.snapshotId.trim().length > 0
    ? output.snapshotId
    : undefined;
}
