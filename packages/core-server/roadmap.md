# Core Server Roadmap

## Current Normalization Slice

This roadmap covers the pending `core-server` slice that was already partially implemented in the worktree and must be normalized before policy hardening continues.

## Scope

This slice is limited to:

- `prompts/list`
- `prompts/get`
- `completion/complete` for prompt arguments
- adapter-backed `resources/list` and `resources/read`
- `notifications/prompts/list_changed` when adapter changes alter visible prompts

## Why It Must Land Before Policy Phase 2

- the pending changes already touch `protocol-server.ts`, `shared.ts`, and the foundation suites
- policy preflight must modify the same entry points
- mixing both slices would produce one noisy commit and make later regressions harder to isolate

## Deliverables

- track prompt/resource helper modules
- finish package README linkage for the slice
- validate `stdio` and `Streamable HTTP` coverage
- commit the current prompt/resource/completion surface as its own unit

## Exit Criteria

- `core-server` exports and runtime entry points compile cleanly
- foundation tests for prompts/resources/completion pass
- the slice is committed separately from policy-engine work

## Non-Goals

- policy preflight
- journal service
- snapshot orchestration
- rollback runtime behavior
