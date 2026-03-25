# Core Hardening: Policy, Journal, Snapshot, And Rollback

## Purpose

This document defines the next implementation slice for the platform core after the Unity CI and self-hosted runner track reached a stable baseline.

The goal of this slice is to turn the current server from "functionally usable" into "safe enough to claim non-interactive editor automation with rollback discipline."

This is the active specification for the next bounded implementation, not a future wish-list.

## Problem Statement

The repository already supports meaningful mutation paths through the Unity adapter and the platform core. However, the current baseline is still too weak in the areas that matter most for reliable automation:

- no first-class policy engine that classifies and authorizes mutations
- no durable operation journal that records platform decisions and outcomes
- no mandatory pre-mutation snapshot orchestration for destructive or wide-scope actions
- no rollback contract that is stable enough to automate against
- no machine-readable denial model suitable for Codex-first flows

This gap is explicitly visible in the planning corpus:

- [platform-foundation/security-model.md](E:/engine-mcp-platform/platform-foundation/security-model.md)
- [platform-foundation/roadmap-v1.md](E:/engine-mcp-platform/platform-foundation/roadmap-v1.md)
- [platform-foundation/module-map.md](E:/engine-mcp-platform/platform-foundation/module-map.md)

## Functional Specification

### User-visible outcome

After this slice, the platform should be able to:

1. classify incoming operations by risk
2. allow or deny operations through server-side policy
3. emit explicit structured errors for denied or unsafe requests
4. record the operation in a journal with actor, capability, target, decision, and result
5. create a pre-mutation snapshot when policy requires it
6. provide a rollback entry point for sandbox mutations tied to a recorded snapshot

### Scope

In scope for the first slice:

- sandbox-first mutation coverage
- canonic risk classes for operations
- journal creation for reads and writes
- snapshot requirement on selected mutation classes
- rollback entry point for sandbox operations
- structured error codes for policy and recovery failures

Out of scope for the first slice:

- full project-wide rollback semantics
- UI-driven policy management
- external OAuth infrastructure
- multi-engine adapter parity
- broad historical migration of every existing Unity operation

### Functional actors

- Codex or another MCP client
- `core-server`
- Unity adapter
- sandbox scene / sandbox asset namespace

### Risk classes

The implementation should start with these classes:

- `read`
- `write_safe`
- `write_project`
- `destructive`
- `external`

These classes already align with the policy framing in [platform-foundation/security-model.md](E:/engine-mcp-platform/platform-foundation/security-model.md).

### Functional rules

1. `read` operations are journaled but do not require snapshots.
2. `write_safe` operations require write-capable session scope and are journaled.
3. `write_project` operations require project scope and policy approval.
4. `destructive` operations require:
   - explicit scope
   - policy approval
   - pre-mutation snapshot
   - rollback metadata in the journal
5. `external` operations require their own explicit scope and are denied by default unless policy allows them.

### Error model

The first slice should standardize at least:

- `policy_denied`
- `scope_missing`
- `snapshot_required`
- `target_outside_sandbox`
- `rollback_unavailable`
- `journal_write_failed`

These errors must be machine-readable and stable enough for automated clients to branch on.

## Technical Specification

### Affected modules

Expected implementation surfaces:

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [packages/contracts](E:/engine-mcp-platform/packages/contracts)
- [adapters/unity/bridge](E:/engine-mcp-platform/adapters/unity/bridge)
- [Unity-Tests/6000.3.1f1](E:/engine-mcp-platform/Unity-Tests/6000.3.1f1)

### Proposed core module split

The slice should introduce or stabilize these core responsibilities:

- `policy/`
  - operation classification
  - scope checks
  - sandbox boundary checks
  - preconditions for snapshots
- `journal/`
  - append-only operation records
  - decision and result logging
  - snapshot linkage
- `snapshots/`
  - snapshot request orchestration
  - snapshot metadata model
  - adapter handoff
- `rollback/`
  - rollback request contract
  - rollback precondition checks
  - adapter handoff and result recording
- `errors/`
  - canonical error factory / shape

`index.ts` files should remain facades only. Do not collapse these responsibilities into the existing bootstrap files.

### Contract changes

Expected contract additions in [packages/contracts](E:/engine-mcp-platform/packages/contracts):

- operation risk classification model
- journal entry schema
- snapshot metadata schema
- rollback request / result schema
- structured policy error schema

### Adapter contract requirements

The Unity adapter should expose only what the core needs for the first slice:

- create snapshot for a bounded target
- restore snapshot for a bounded target
- report capability support / limitations

The adapter should not own the policy decision itself.

### Persistence expectations

V1 does not need a production database here.

The first implementation may use a bounded local persistence strategy if it is:

- deterministic
- append-only for journal writes
- easy to inspect in tests
- replaceable behind a narrow interface

### Testing requirements

At minimum:

- unit tests for policy decisions
- unit tests for structured errors
- unit tests for journal/snapshot orchestration
- integration tests for `core-server`
- Unity sandbox tests for snapshot/rollback handoff
- at least one E2E-like destructive sandbox flow proving:
  - mutation
  - snapshot creation
  - rollback success

## Acceptance Criteria

This slice is done when:

1. The platform denies out-of-policy mutations with stable structured errors.
2. Destructive sandbox mutations require snapshots.
3. A journal record exists for each handled operation.
4. Rollback can be invoked for at least one destructive sandbox path.
5. Core and adapter tests prove the above behavior repeatedly.

## Risks

- adapter snapshot primitives may be thinner than the core wants initially
- journal shape may drift if too much data is packed into V1
- rollback scope can balloon if it is not bounded to sandbox-first

## Design Constraints

- keep the contract engine-agnostic
- keep Unity-specific details in the adapter layer
- keep the first slice sandbox-first
- prefer explicit structured errors over human-language-only failures
- do not widen feature surface while the risk model is still undefined

## Sources

- [MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)
