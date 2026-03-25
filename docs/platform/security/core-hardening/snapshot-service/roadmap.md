# Snapshot Service Roadmap

## Goal

Ship the first server-side snapshot linkage baseline for destructive inline `tools/call`.

## Phase 4A: Snapshot Normalization

### Deliverables

- `snapshot-service.ts` in `core-server`
- extraction of `snapshotId` from destructive success payloads
- normalized `JournalSnapshotLink` creation

### Exit Criteria

- destructive success paths can produce journal-ready snapshot links

## Phase 4B: Inline Enforcement

### Deliverables

- `protocol-server` wiring for snapshot enforcement
- `snapshot_required` failure when destructive success payloads omit snapshot linkage

### Exit Criteria

- destructive inline success cannot complete without snapshot linkage

## Phase 4C: Transport Validation

### Deliverables

- `stdio` snapshot foundation coverage
- `Streamable HTTP` snapshot foundation coverage

### Exit Criteria

- snapshot link journaling and `snapshot_required` failure are covered over both transports or by a dedicated transport/unit split

## Non-Goals

- public `snapshot.create`
- rollback execution changes
- task-side snapshot orchestration
- Unity live-plugin snapshot persistence redesign
