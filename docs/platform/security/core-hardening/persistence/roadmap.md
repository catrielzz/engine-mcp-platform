# Persistence Roadmap

## Goal

Ship the first durable local persistence baseline for journal entries and snapshot metadata in `core-server`.

## Phase 7A: Store Interfaces

### Deliverables

- narrow journal persistence interface
- narrow snapshot metadata persistence interface
- explicit error boundary between protocol orchestration and storage

### Exit Criteria

- the core can swap in-memory and persistent implementations without changing protocol logic

## Phase 7B: Local Backend

### Deliverables

- default filesystem-backed journal store
- default filesystem-backed snapshot metadata store
- configurable persistence root

### Exit Criteria

- entries and snapshot metadata survive process restart in local tests

## Phase 7C: Core Wiring

### Deliverables

- runtime bootstrap for the default persistent stores
- preservation of current error semantics for failed writes

### Exit Criteria

- inline hardening flow keeps working with the persistent backend enabled

## Phase 7D: Validation

### Deliverables

- unit tests for persistent store behavior
- integration tests that verify restart-safe loading

### Exit Criteria

- deterministic local tests prove append, reload, and listing behavior

## Non-Goals

- MCP resource exposure
- live adapter persistence coordination
- external databases
- retention/compaction policy beyond the minimum needed for correctness
