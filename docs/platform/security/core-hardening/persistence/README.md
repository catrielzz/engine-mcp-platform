# Persistence Slice

## Purpose

This document defines the first bounded persistence implementation for the hardened platform core.

The goal of the slice is to move journal and snapshot metadata out of process memory and into a deterministic local store, without yet exposing that state as MCP resources or redesigning adapter-side snapshot mechanics.

## Problem Statement

The current hardening baseline now covers:

- policy preflight
- inline journaling
- snapshot linkage enforcement
- rollback journal semantics
- integrated sandbox validation

That is enough to prove the control flow, but it is still too weak operationally because all journal evidence and snapshot linkage disappear with process lifetime.

For V1, the platform needs traceability that survives a restart and can later support resource exposure, rollback inspection, and adapter-live diagnosis.

## Functional Specification

### User-visible outcome

After this slice, when local persistence is enabled:

1. journal entries survive `core-server` process restarts
2. snapshot metadata survives `core-server` process restarts
3. the default persistence backend remains local, deterministic, and inspectable
4. `core-server` still exposes the same public MCP tool behavior as today

### In Scope

- persistent local journal storage
- persistent local snapshot metadata storage
- append-only write path for journal entries
- narrow interfaces that can be replaced later
- deterministic loading for tests and local debugging

### Out Of Scope

- MCP resource exposure for journal or snapshot data
- remote database backends
- retention policies beyond minimal bounded cleanup rules
- task/result persistence for experimental tasks
- Unity adapter snapshot storage redesign

## Technical Specification

### Affected Modules

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [docs/platform/security/core-hardening](E:/engine-mcp-platform/docs/platform/security/core-hardening)

### Design

The slice should introduce two storage concerns in `core-server`:

- `journal-store`
  - append-only persistence for `JournalEntry`
  - deterministic list/read for tests and inspection
- `snapshot-metadata-store`
  - persistence for snapshot linkage metadata already normalized by the core
  - enough information to correlate a snapshot id with capability, target, timestamp, and rollback availability

Both stores must sit behind narrow interfaces. `protocol-server.ts` must continue to orchestrate behavior, not own file persistence directly.

### Default Local Backend

The first backend should stay intentionally simple:

- local filesystem only
- JSON-based data
- append-friendly for journal writes
- easy to inspect manually
- safe to replace with SQLite or another embedded store later

Recommended default shape:

- journal log as newline-delimited JSON
- snapshot metadata as either:
  - newline-delimited JSON in a dedicated log, or
  - a small per-snapshot record set in the same persistence root

The exact file naming can be implementation-driven, but the storage root should be configurable and isolated from source files.

### Persistence Requirements

The first implementation should guarantee:

1. append-only journal writes
2. stable serialization of `JournalEntry`
3. explicit persistence errors surfaced to the core
4. deterministic listing order
5. testability without depending on the Unity editor or runner state

### Failure Model

The persistence slice should preserve current hardening behavior:

- journal write failures remain actionable and visible
- snapshot metadata persistence failures must not silently claim rollback readiness
- the system should prefer explicit structured errors over partial-success ambiguity

## Acceptance Criteria

This slice is done when:

1. restarting `core-server` no longer loses journal entries
2. restarting `core-server` no longer loses persisted snapshot metadata
3. unit and integration tests can inspect persisted state deterministically
4. public MCP behavior stays unchanged for existing tool clients

## Risks

- over-designing the storage layer before resource exposure exists
- mixing persistence policy with protocol orchestration
- making the default store too implicit to debug locally

## Sources

- [MCP Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
