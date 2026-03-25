import type { CapabilityName } from "./types.js";

export const SNAPSHOT_SCOPE_VALUES = [
  "sandbox_scene",
  "sandbox_assets",
  "sandbox_workspace"
] as const;

export type SnapshotScope = (typeof SNAPSHOT_SCOPE_VALUES)[number];

export interface SnapshotMetadata {
  snapshotId: string;
  adapterId: string;
  createdAt: string;
  scope: SnapshotScope;
  targetPath?: string;
  label?: string;
  capability?: CapabilityName;
}

export interface SnapshotCreateRequest {
  capability: CapabilityName;
  scope: SnapshotScope;
  targetPath?: string;
  label?: string;
  reason?: string;
}

export interface SnapshotCreateResult {
  created: boolean;
  snapshot: SnapshotMetadata;
}
