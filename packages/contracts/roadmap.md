# Contracts Package Roadmap

## Goal

Provide stable, engine-agnostic contracts that the rest of the platform can build on without inventing local shapes for policy, journaling, snapshots, rollback, or structured errors.

## Phase 1

### Objective

Add canonical contracts for the hardening baseline without changing runtime behavior.

### Deliverables

- policy contracts
- structured error contracts
- journal contracts
- snapshot contracts
- rollback contracts
- package README expansion
- package-level roadmap

### Exit Criteria

- `packages/contracts` exports the new contract surface
- tests cover representative values
- no runtime module depends on local, ad-hoc hardening shapes anymore once later phases adopt these exports

## Phase 2

### Objective

Support `core-server` adoption of the contracts.

### Expected Work

- use structured error codes in denial paths
- use policy decision records in preflight flow
- use journal entry contracts in append-only persistence

## Phase 3

### Objective

Support adapter adoption of snapshot and rollback contracts.

### Expected Work

- snapshot metadata handoff
- rollback request/result handoff
- capability limitation reporting

## Non-Goals

- runtime authorization implementation
- database selection
- adapter-side policy decisions
- engine-specific mutation policy
