# Rollback Baseline Roadmap

## Goal

Ship the first explicit rollback journal baseline for inline `snapshot.restore`.

## Phase 5A: Rollback Normalization

### Deliverables

- `rollback-service.ts` in `core-server`
- rollback-status normalization for inline success results

### Exit Criteria

- `snapshot.restore` success can be classified as a rollback transition without changing public tool payloads

## Phase 5B: Journal Wiring

### Deliverables

- `protocol-server` wiring for rollback-aware journal status
- reuse of existing snapshot linkage for rollback entries

### Exit Criteria

- successful rollback calls are journaled as `rolled_back`

## Phase 5C: Transport Validation

### Deliverables

- `stdio` rollback coverage
- `Streamable HTTP` rollback coverage

### Exit Criteria

- rollback journal semantics are covered over both transports or by a dedicated transport/unit split

## Non-Goals

- new rollback capabilities
- rollback orchestration for tasks
- adapter-side restore redesign
- public rollback resource exposure
