import type { CoreError } from "./errors.js";

export const ROLLBACK_STATUS_VALUES = ["accepted", "completed", "failed", "unavailable"] as const;

export type RollbackStatus = (typeof ROLLBACK_STATUS_VALUES)[number];

export interface RollbackRequest {
  snapshotId: string;
  journalEntryId?: string;
  reason?: string;
  dryRun?: boolean;
}

export interface RollbackResult {
  snapshotId: string;
  status: RollbackStatus;
  restoredTargets?: readonly string[];
  error?: CoreError;
}
