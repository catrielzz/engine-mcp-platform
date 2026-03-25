import type { CapabilityName, OperationRiskClass } from "./types.js";
import type { PolicyDecisionRecord, PolicyTargetDescriptor } from "./policy.js";

export const JOURNAL_ACTOR_TYPE_VALUES = ["client", "automation", "system"] as const;
export const JOURNAL_RESULT_STATUS_VALUES = [
  "pending",
  "succeeded",
  "failed",
  "denied",
  "rolled_back"
] as const;

export type JournalActorType = (typeof JOURNAL_ACTOR_TYPE_VALUES)[number];
export type JournalResultStatus = (typeof JOURNAL_RESULT_STATUS_VALUES)[number];

export interface JournalActor {
  type: JournalActorType;
  id: string;
  displayName?: string;
}

export interface JournalSnapshotLink {
  snapshotId: string;
  rollbackAvailable: boolean;
}

export interface JournalRecordedError {
  code: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface JournalResult {
  status: JournalResultStatus;
  durationMs?: number;
  error?: JournalRecordedError;
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  capability: CapabilityName;
  riskClass: OperationRiskClass;
  actor: JournalActor;
  target?: PolicyTargetDescriptor;
  decision: PolicyDecisionRecord;
  result: JournalResult;
  snapshot?: JournalSnapshotLink;
}
