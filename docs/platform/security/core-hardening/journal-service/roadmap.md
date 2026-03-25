# Journal Service Roadmap

## Goal

Ship the first append-only journal baseline for inline `tools/call` in `core-server`.

## Phase 3A: Interface And Default Backend

### Deliverables

- `EngineMcpJournalService` contract in `core-server`
- in-memory append-only implementation
- unit tests for append/list behavior

### Exit Criteria

- the service is injectable
- the default backend is deterministic in tests

## Phase 3B: Inline Tool Wiring

### Deliverables

- journal entry creation for success, failure, and denial
- strict handling for `journal_write_failed`

### Exit Criteria

- inline `tools/call` always attempts journal append for canonical capabilities

## Phase 3C: Transport Validation

### Deliverables

- `stdio` journal coverage
- `Streamable HTTP` journal coverage

### Exit Criteria

- success and denial paths are journaled over both transports

## Non-Goals

- task journaling
- snapshot/rollback journaling beyond placeholder link fields
- journal resource exposure
