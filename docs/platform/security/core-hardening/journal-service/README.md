# Journal Service Slice

## Purpose

This document defines the first bounded journal implementation for the platform core.

The goal of the slice is to make `core-server` record append-only operation evidence for inline `tools/call` without yet introducing snapshot orchestration, rollback execution, or production persistence.

## Functional Specification

### User-visible outcome

After this slice:

1. each canonical inline `tools/call` handled by `core-server` records a journal entry
2. journal entries include:
   - actor
   - capability
   - risk class
   - policy decision
   - target when known
   - final result
3. denied operations are journaled, not only successful ones
4. journal writes that fail surface a structured `journal_write_failed` tool error

### In Scope

- inline `tools/call`
- append-only in-memory journal backend
- journal service interface suitable for later replacement
- success, failure, and denial recording

### Out Of Scope

- task-augmented journaling
- snapshot linkage beyond the empty/optional contract field
- persistent disk/database backends
- journal resource exposure over MCP
- rollback-specific journal transitions

## Technical Specification

### Affected Modules

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [packages/contracts](E:/engine-mcp-platform/packages/contracts)

### Design

The slice should introduce:

- a narrow `EngineMcpJournalService` interface
- a default in-memory append-only implementation
- a small helper that maps inline tool execution outcomes into `JournalEntry`

The journal service must stay replaceable. `protocol-server.ts` should not own persistence.

### Journal Semantics

The first implementation should record:

- `succeeded`
- `failed`
- `denied`

The actor model should stay simple:

- actor type `client`
- actor id from `sessionId` when present, otherwise request id

### Failure Semantics

If journal append fails, the tool result should fail with `journal_write_failed`.

That is stricter than a best-effort log, but it keeps the hardening claim honest for this phase.

## Acceptance Criteria

This slice is done when:

1. inline successes create journal entries
2. inline denials create journal entries
3. inline adapter failures create journal entries
4. a broken journal backend produces `journal_write_failed`
5. `core-server` tests prove the above over `stdio` and `Streamable HTTP`

## Sources

- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
