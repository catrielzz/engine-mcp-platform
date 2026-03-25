# Snapshot Service Slice

## Purpose

This document defines the first bounded snapshot-orchestration implementation for the platform core.

The goal of the slice is to make `core-server` treat snapshot capture as an enforced contract for destructive inline `tools/call`, without widening the public capability surface beyond the current adapter-managed snapshot flows.

## Functional Specification

### User-visible outcome

After this slice:

1. destructive inline `tools/call` paths that succeed must provide usable snapshot linkage
2. `core-server` journals the snapshot link for successful destructive operations
3. if a destructive operation is policy-allowed but returns no snapshot linkage, the core fails it with `snapshot_required`
4. rollback remains exposed through the existing canonical `snapshot.restore` capability, without adding a new public `snapshot.create` capability

### In Scope

- inline `tools/call`
- server-side snapshot linkage enforcement
- journal linkage for successful destructive operations
- adapter-managed snapshot capture that is normalized by the core

### Out Of Scope

- a new public `snapshot.create` capability
- task-augmented snapshot orchestration
- project-wide snapshot semantics outside sandbox-first flows
- Unity live-plugin snapshot persistence redesign
- rollback execution changes

## Technical Specification

### Affected Modules

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [docs/platform/security/core-hardening](E:/engine-mcp-platform/docs/platform/security/core-hardening)

### Design

The slice should introduce:

- a narrow internal `snapshot-service.ts` helper in `core-server`
- success-path snapshot extraction from destructive tool outputs
- strict failure behavior when a destructive success payload omits required snapshot linkage
- journal integration through the existing `JournalSnapshotLink` contract

The core should not attempt to own snapshot persistence details in this slice. The adapter remains responsible for capture/restore mechanics; the core only enforces that destructive success paths expose a usable snapshot handle.

### Enforcement Model

For inline canonical tool execution:

- if `decision.requiresSnapshot === false`, no snapshot enforcement is applied
- if `decision.requiresSnapshot === true`, the success payload must contain a non-empty `snapshotId`
- if that `snapshotId` is missing, the core returns `snapshot_required`

### Journal Model

For successful destructive operations, the journal entry should store:

- `snapshot.snapshotId`
- `snapshot.rollbackAvailable`

For the first implementation:

- `scene.object.delete` records `rollbackAvailable: true`
- `snapshot.restore` records `rollbackAvailable: false`

## Acceptance Criteria

This slice is done when:

1. destructive inline success responses cannot bypass snapshot linkage
2. `scene.object.delete` success records a journal snapshot link
3. destructive success responses without `snapshotId` fail with `snapshot_required`
4. `stdio` and `Streamable HTTP` tests prove the behavior

## Sources

- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Unity AssetDatabase.SaveAssets](https://docs.unity3d.com/ScriptReference/AssetDatabase.SaveAssets.html)
