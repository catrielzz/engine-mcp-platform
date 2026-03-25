import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CapabilityName,
  JournalSnapshotLink,
  PolicyTargetDescriptor,
  SnapshotScope
} from "@engine-mcp/contracts";

import type {
  EngineMcpSnapshotMetadataRecord,
  EngineMcpSnapshotMetadataStore
} from "../shared.js";

const SNAPSHOT_METADATA_FILE_NAME = "snapshot-metadata.json";

export interface FileSnapshotMetadataStoreOptions {
  rootDir: string;
}

export function createInMemorySnapshotMetadataStore(): EngineMcpSnapshotMetadataStore {
  const records = new Map<string, EngineMcpSnapshotMetadataRecord>();

  return {
    upsert(record): void {
      records.set(
        record.snapshot.snapshotId,
        mergeSnapshotMetadata(records.get(record.snapshot.snapshotId), record)
      );
    },
    get(snapshotId): EngineMcpSnapshotMetadataRecord | undefined {
      return records.get(snapshotId);
    },
    list(): readonly EngineMcpSnapshotMetadataRecord[] {
      return Object.freeze([...records.values()]);
    }
  };
}

export function createFileSnapshotMetadataStore(
  options: FileSnapshotMetadataStoreOptions
): EngineMcpSnapshotMetadataStore {
  const filePath = join(options.rootDir, SNAPSHOT_METADATA_FILE_NAME);

  return {
    async upsert(record): Promise<void> {
      await mkdir(options.rootDir, { recursive: true });
      const records = await readSnapshotMetadataMap(filePath);
      records.set(
        record.snapshot.snapshotId,
        mergeSnapshotMetadata(records.get(record.snapshot.snapshotId), record)
      );
      await writeSnapshotMetadataMap(filePath, records);
    },
    async get(snapshotId): Promise<EngineMcpSnapshotMetadataRecord | undefined> {
      const records = await readSnapshotMetadataMap(filePath);
      return records.get(snapshotId);
    },
    async list(): Promise<readonly EngineMcpSnapshotMetadataRecord[]> {
      const records = await readSnapshotMetadataMap(filePath);
      return Object.freeze([...records.values()]);
    }
  };
}

export function createSnapshotMetadataRecord(options: {
  capability: CapabilityName;
  adapterId: string;
  snapshot: JournalSnapshotLink;
  target?: PolicyTargetDescriptor;
  now?: () => string;
}): EngineMcpSnapshotMetadataRecord {
  const timestamp = options.now?.() ?? new Date().toISOString();
  const targetPath = options.target?.assetPath ?? options.target?.logicalName;

  return {
    snapshot: {
      snapshotId: options.snapshot.snapshotId,
      adapterId: options.adapterId,
      createdAt: timestamp,
      scope: resolveSnapshotScope(options.capability, options.target),
      ...(targetPath ? { targetPath } : {}),
      capability: options.capability
    },
    rollbackAvailable: options.snapshot.rollbackAvailable,
    updatedAt: timestamp,
    ...(options.target ? { target: options.target } : {})
  };
}

function resolveSnapshotScope(
  capability: CapabilityName,
  target: PolicyTargetDescriptor | undefined
): SnapshotScope {
  if (target?.assetPath) {
    return "sandbox_assets";
  }

  if (capability.startsWith("scene.") || capability === "snapshot.restore") {
    return "sandbox_scene";
  }

  return "sandbox_workspace";
}

function mergeSnapshotMetadata(
  existing: EngineMcpSnapshotMetadataRecord | undefined,
  next: EngineMcpSnapshotMetadataRecord
): EngineMcpSnapshotMetadataRecord {
  if (!existing) {
    return Object.freeze(next);
  }

  return Object.freeze({
    snapshot: {
      snapshotId: next.snapshot.snapshotId,
      adapterId: existing.snapshot.adapterId || next.snapshot.adapterId,
      createdAt: existing.snapshot.createdAt,
      scope: existing.snapshot.scope,
      ...(next.snapshot.targetPath || existing.snapshot.targetPath
        ? {
            targetPath: next.snapshot.targetPath ?? existing.snapshot.targetPath
          }
        : {}),
      ...(next.snapshot.label || existing.snapshot.label
        ? {
            label: next.snapshot.label ?? existing.snapshot.label
          }
        : {}),
      ...(existing.snapshot.capability || next.snapshot.capability
        ? {
            capability: existing.snapshot.capability ?? next.snapshot.capability
          }
        : {})
    },
    rollbackAvailable: next.rollbackAvailable,
    updatedAt: next.updatedAt,
    ...(next.target || existing.target
      ? {
          target: next.target ?? existing.target
        }
      : {})
  });
}

async function readSnapshotMetadataMap(
  filePath: string
): Promise<Map<string, EngineMcpSnapshotMetadataRecord>> {
  try {
    const text = await readFile(filePath, "utf8");
    const payload = JSON.parse(text) as {
      records?: EngineMcpSnapshotMetadataRecord[];
    };
    const records = new Map<string, EngineMcpSnapshotMetadataRecord>();

    for (const record of payload.records ?? []) {
      records.set(record.snapshot.snapshotId, Object.freeze(record));
    }

    return records;
  } catch (error) {
    if (isMissingFileError(error)) {
      return new Map();
    }

    throw error;
  }
}

async function writeSnapshotMetadataMap(
  filePath: string,
  records: Map<string, EngineMcpSnapshotMetadataRecord>
): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;

  await writeFile(
    tempPath,
    JSON.stringify(
      {
        records: [...records.values()]
      },
      null,
      2
    ),
    "utf8"
  );
  await rename(tempPath, filePath);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
