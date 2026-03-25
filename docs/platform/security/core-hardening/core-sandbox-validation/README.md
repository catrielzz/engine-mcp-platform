# Core Sandbox Validation Slice

## Purpose

This document defines the first integrated validation slice for the hardened platform core.

The goal of the slice is to prove that the existing `core-server` policy, journal, snapshot, and rollback baselines work together against the real Unity preferred adapter in sandbox fallback mode.

## Functional Specification

### User-visible outcome

After this slice:

1. `core-server` can create, delete, and restore a sandbox object through the Unity preferred adapter
2. destructive delete paths produce snapshot linkage that the server records in the journal
3. successful `snapshot.restore` calls are journaled as `rolled_back`
4. the restored object is visible again through canonical read APIs after rollback

### In Scope

- integrated validation of `core-server` against the Unity preferred adapter
- sandbox fallback mode through the preferred adapter
- `delete -> snapshot -> restore -> journal rollback` verification
- transport coverage over `stdio` and `Streamable HTTP`

### Out Of Scope

- Unity live-plugin transport validation
- new adapter features
- project-scoped destructive recovery outside the sandbox
- workflow or CI changes
- direct mutation of the Unity test host project

## Technical Specification

### Affected Modules

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [docs/platform/security/core-hardening](E:/engine-mcp-platform/docs/platform/security/core-hardening)

### Design

The slice should add integration-style tests in `core-server` that:

- boot the server with the Unity preferred adapter
- force fallback to the sandbox adapter by using a missing plugin bootstrap path
- run the canonical mutation and rollback flow through MCP transports
- inspect the in-memory journal after the flow completes

The validation must use the server surface, not adapter-direct invocations. That keeps the slice focused on proving core wiring rather than re-testing adapter internals that already have their own package coverage.

### Validation Flow

The integrated scenario should:

1. create a sandbox object
2. confirm it exists through `scene.hierarchy.read`
3. delete it through `scene.object.delete`
4. capture the returned `snapshotId`
5. restore it through `snapshot.restore`
6. confirm it exists again through `scene.hierarchy.read`
7. verify journal entries for:
   - create `succeeded`
   - delete `succeeded` with rollback-capable snapshot link
   - restore `rolled_back` with the same `snapshotId`

## Acceptance Criteria

This slice is done when:

1. the integrated sandbox flow passes over `stdio`
2. the integrated sandbox flow passes over `Streamable HTTP`
3. journal state proves rollback semantics after restore
4. no adapter or Unity-project implementation changes are required for the slice

## Sources

- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Unity Test Framework](https://docs.unity3d.com/Packages/com.unity.test-framework@latest)
- [Unity Command Line Arguments](https://docs.unity3d.com/Manual/EditorCommandLineArguments.html)
