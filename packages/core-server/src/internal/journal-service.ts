import { randomUUID } from "node:crypto";

import type {
  JournalEntry,
  JournalSnapshotLink,
  JournalResultStatus,
  PolicyDecisionRecord,
  PolicyTargetDescriptor
} from "@engine-mcp/contracts";

import type {
  EngineMcpCoreRequestExtra,
  EngineMcpJournalService,
  EngineMcpToolError
} from "../shared.js";

export function createInMemoryJournalService(): EngineMcpJournalService {
  const entries: JournalEntry[] = [];

  return {
    append(entry): void {
      entries.push(Object.freeze(entry));
    },
    list(): readonly JournalEntry[] {
      return Object.freeze([...entries]);
    }
  };
}

export async function appendInlineToolJournalEntry(options: {
  journalService: EngineMcpJournalService;
  capability: JournalEntry["capability"];
  riskClass: JournalEntry["riskClass"];
  extra: EngineMcpCoreRequestExtra;
  decision: PolicyDecisionRecord;
  target?: PolicyTargetDescriptor;
  snapshot?: JournalSnapshotLink;
  status: JournalResultStatus;
  error?: EngineMcpToolError;
}): Promise<void> {
  const entry: JournalEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    capability: options.capability,
    riskClass: options.riskClass,
    actor: createJournalActor(options.extra),
    ...(options.target ? { target: options.target } : {}),
    decision: options.decision,
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
    result: {
      status: options.status,
      ...(options.error ? { error: toJournalRecordedError(options.error) } : {})
    }
  };

  await options.journalService.append(entry);
}

function createJournalActor(extra: EngineMcpCoreRequestExtra): JournalEntry["actor"] {
  if (extra.sessionId) {
    return {
      type: "client",
      id: extra.sessionId,
      displayName: "session"
    };
  }

  return {
    type: "client",
    id: String(extra.requestId),
    displayName: "request"
  };
}

function toJournalRecordedError(error: EngineMcpToolError): JournalEntry["result"]["error"] {
  return {
    code: error.code,
    message: error.message,
    ...(error.details !== undefined && isRecord(error.details)
      ? { details: error.details }
      : {})
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
