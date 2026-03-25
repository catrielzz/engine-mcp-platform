# @engine-mcp/contracts

Canonical platform contracts for:

- capability catalogs
- prompt definitions
- discovery resources
- policy and structured errors
- journal entries
- snapshot metadata
- rollback requests and results

## Purpose

This package is the engine-agnostic contract layer for the platform.

It exists to keep `core-server`, adapters, and future engines aligned on one canonical model before runtime behavior is widened.

The current active hardening track is defined in:

- [Core Hardening README](E:/engine-mcp-platform/docs/platform/security/core-hardening/README.md)
- [Core Hardening Roadmap](E:/engine-mcp-platform/docs/platform/security/core-hardening/roadmap.md)
- [ADR-0005](E:/engine-mcp-platform/docs/platform/adr/ADR-0005-core-policy-journal-snapshot-baseline.md)

## Functional Scope

This package currently owns:

- canonical capability ids and descriptors
- tool-ready JSON Schema materialization
- prompt definitions and prompt rendering inputs
- discovery resource contracts
- baseline hardening contracts for policy, journal, snapshots, rollback, and structured errors

This package does not own:

- transport behavior
- policy decisions at runtime
- journal persistence strategy
- snapshot execution
- rollback orchestration

## Technical Scope

The package should stay:

- engine-agnostic
- schema-first where possible
- safe to import from `core-server` and adapters without side effects
- narrow enough that runtime modules can evolve behind stable contracts

`index.ts` remains the public facade. Implementation-specific logic should stay out of the root file.

## Current Slice

Phase 1 of the hardening track establishes canonical contracts only:

- risk classes
- policy scopes and decisions
- structured policy/recovery error codes
- journal entry records
- snapshot metadata
- rollback request/result records

No runtime policy engine or persistence is introduced in this package.

## Validation

Use:

- `pnpm --filter @engine-mcp/contracts typecheck`
- `pnpm --filter @engine-mcp/contracts test`

## Roadmap

- [Contracts Package Roadmap](E:/engine-mcp-platform/packages/contracts/roadmap.md)
