# Rollback Baseline Slice

## Purpose

This document defines the first bounded rollback implementation for the platform core.

The goal of the slice is to make `core-server` treat successful `snapshot.restore` operations as explicit rollback transitions in the journal, without widening the public capability surface or redesigning adapter-side restore mechanics.

## Functional Specification

### User-visible outcome

After this slice:

1. successful `snapshot.restore` calls are journaled as `rolled_back`, not as generic success
2. rollback journal entries still preserve the snapshot link produced by the existing snapshot service
3. unsuccessful rollback attempts continue to surface structured errors such as `rollback_unavailable`
4. the public `snapshot.restore` tool result remains unchanged for MCP clients

### In Scope

- inline `tools/call`
- `snapshot.restore` rollback classification in `core-server`
- journal transition normalization for successful rollback execution
- transport coverage over `stdio` and `Streamable HTTP`

### Out Of Scope

- new rollback capabilities
- public `snapshot.create`
- adapter redesign for restore execution
- rollback orchestration for task-augmented calls
- project-wide multi-step recovery workflows

## Technical Specification

### Affected Modules

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [docs/platform/security/core-hardening](E:/engine-mcp-platform/docs/platform/security/core-hardening)

### Design

The slice should introduce:

- a narrow internal `rollback-service.ts` helper in `core-server`
- rollback-status normalization for inline success results
- protocol wiring that journals `snapshot.restore` as `rolled_back` when the restore payload confirms `restored: true`

The implementation should keep the public tool result untouched. The change is journal semantics, not capability redesign.

### Rollback Semantics

For inline canonical tool execution:

- non-rollback capabilities continue to journal `succeeded`
- `snapshot.restore` journals `rolled_back` when the validated success payload confirms `restored: true`
- `snapshot.restore` may still journal `succeeded` if the adapter returns a valid success payload without confirmed restoration semantics
- failures still use the existing structured error path and do not become rollback transitions

### Journal Model

For successful rollback execution, the journal entry should store:

- `result.status = "rolled_back"`
- the existing `snapshot.snapshotId`
- `snapshot.rollbackAvailable = false`

This keeps the journal consistent with the prior snapshot-linkage slice while making rollback intent explicit.

## Acceptance Criteria

This slice is done when:

1. `snapshot.restore` success no longer appears as generic `succeeded` in the journal
2. successful rollback entries retain their snapshot link
3. `stdio` and `Streamable HTTP` tests prove the rollback journal transition
4. existing non-rollback success paths remain `succeeded`

## Sources

- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
