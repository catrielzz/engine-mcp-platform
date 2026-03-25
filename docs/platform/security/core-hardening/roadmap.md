# Core Hardening Roadmap

## Goal

Ship the first bounded hardening pass for the platform core:

- policy
- journal
- snapshot
- rollback
- structured error model

This roadmap is intentionally scoped to the next slice only.

## Phase 0: Contracts And ADR Freeze

### Objective

Freeze the baseline before touching runtime behavior.

### Deliverables

- ADR-0005
- functional specification
- technical specification
- roadmap

### Exit Criteria

- approved baseline for policy/journal/snapshot/rollback
- bounded module targets are explicit

## Phase 1: Canonical Contracts

### Objective

Introduce stable contracts in [packages/contracts](E:/engine-mcp-platform/packages/contracts).

### Expected Work

- risk class model
- journal entry types
- snapshot metadata types
- rollback request/result types
- structured policy error types

### Exit Criteria

- contract tests exist
- `core-server` can import the new contracts without widening runtime logic yet

## Phase 2: Policy Engine Skeleton

### Objective

Add server-side operation classification and denial semantics.

### Expected Work

- classify capabilities into risk classes
- enforce scope checks
- enforce sandbox boundary checks
- return stable structured errors

### Exit Criteria

- unit tests prove allow/deny decisions
- denial responses are machine-readable

## Phase 3: Journal Service

### Objective

Record operation intent, decision, and outcome durably enough for V1.

### Expected Work

- append-only journal interface
- bounded persistence strategy
- operation correlation IDs
- snapshot linkage fields

### Exit Criteria

- handled operations generate journal records
- test suite can inspect records deterministically

## Phase 4: Snapshot Service

### Objective

Require and orchestrate pre-mutation snapshots for selected mutation classes.

### Expected Work

- snapshot request orchestration in `core-server`
- Unity adapter hook for sandbox snapshots
- policy hook that can require snapshot before execution

### Exit Criteria

- destructive sandbox path cannot proceed without snapshot success
- snapshot metadata is journaled

## Phase 5: Rollback Baseline

### Objective

Expose a rollback entry point for the first destructive sandbox scenario.

### Expected Work

- rollback request path
- rollback capability wiring to Unity adapter
- rollback result recording

### Exit Criteria

- one destructive sandbox mutation can be rolled back end-to-end
- failures return `rollback_unavailable` or equivalent structured error

## Phase 6: Core And Sandbox Validation

### Objective

Prove the slice with repeatable tests.

### Expected Work

- `core-server` integration tests
- adapter contract tests
- Unity sandbox validation
- destructive sandbox E2E-style case

### Exit Criteria

- all new tests are green locally and in CI
- rollback evidence is inspectable

## Suggested File Targets

Likely implementation targets:

- [packages/contracts](E:/engine-mcp-platform/packages/contracts)
- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [adapters/unity/bridge](E:/engine-mcp-platform/adapters/unity/bridge)
- [Unity-Tests/6000.3.11f1](E:/engine-mcp-platform/Unity-Tests/6000.3.11f1)

Likely documentation targets:

- [core-hardening README](E:/engine-mcp-platform/docs/platform/security/core-hardening/README.md)
- [ADR-0005](E:/engine-mcp-platform/docs/platform/adr/ADR-0005-core-policy-journal-snapshot-baseline.md)

## Non-Goals For This Slice

- production-grade multi-engine snapshot support
- full project rollback outside sandbox
- OAuth server implementation
- large CoplayDev feature port batch

## Recommended First Implementation Order

1. contracts
2. structured errors
3. policy engine skeleton
4. journal service
5. snapshot orchestration
6. rollback for one sandbox mutation
7. validation
