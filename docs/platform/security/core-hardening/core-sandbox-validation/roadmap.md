# Core Sandbox Validation Roadmap

## Goal

Prove the hardened `core-server` flow end-to-end against the Unity preferred adapter in sandbox fallback mode.

## Phase 6A: Stdio Validation

### Deliverables

- integrated `stdio` test for create, delete, restore, and journal assertions

### Exit Criteria

- the sandbox flow passes over `stdio`
- rollback state is visible in the journal

## Phase 6B: Streamable HTTP Validation

### Deliverables

- integrated `Streamable HTTP` test for the same flow

### Exit Criteria

- the sandbox flow passes over `Streamable HTTP`
- rollback journal semantics match the `stdio` path

## Phase 6C: Coverage Freeze

### Deliverables

- updated hardening index
- stable assertions for snapshot linkage and rollback state

### Exit Criteria

- the slice documents the proven path and does not require Unity-project mutations

## Non-Goals

- live-plugin bootstrap validation
- workflow automation for the slice
- new rollback features
