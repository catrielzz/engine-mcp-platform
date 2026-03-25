# Live Adapter Validation Roadmap

## Scope

This roadmap covers the first manual-only validation path for the preferred Unity adapter against the live plugin bridge.

## Deliverables

- functional and technical slice documentation
- shared env-gated helper for live validation
- `stdio` live validation suite
- `Streamable HTTP` live validation suite
- manual self-hosted GitHub workflow

## Phase 1 - Documentation

Deliverables:

- [README.md](E:/engine-mcp-platform/docs/platform/testing/live-adapter-validation/README.md)
- link from [testing README](E:/engine-mcp-platform/docs/platform/testing/README.md)

Exit criteria:

- manual-only scope is explicit
- bootstrap and env expectations are documented

## Phase 2 - Test Harness

Deliverables:

- shared helper for:
  - env gate
  - optional bootstrap override
  - preferred-adapter live options

Exit criteria:

- live suites can opt in without affecting the default package bar

## Phase 3 - Live Validation Suites

Deliverables:

- `stdio` live validation
- `Streamable HTTP` live validation

Exit criteria:

- both suites validate delete, restore, and runtime resource inspection against the live plugin path

## Phase 4 - Manual Workflow

Deliverables:

- manual self-hosted workflow for the live validation suites

Exit criteria:

- trusted operator can run the suites on demand from GitHub

## Non-Goals

- default CI integration
- auto-provisioning Unity Editor
- broader live conformance matrix
