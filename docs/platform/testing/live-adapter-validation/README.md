# Live Adapter Validation

## Purpose

This slice defines the first manual validation path for the preferred Unity adapter when the live plugin bridge is available on the self-hosted Windows runner.

The goal is to validate the real preferred-adapter path end-to-end without polluting the default package test bar or the regular PR workflow.

## Functional Specification

### User-visible outcome

After this slice, the repository should support a manual validation path that:

- targets the live Unity plugin bridge instead of the sandbox fallback
- validates destructive sandbox flow through the preferred adapter
- reads persisted core runtime resources after the flow completes
- keeps the normal `pnpm test` bar green when live validation is not explicitly enabled

### In scope

- opt-in `stdio` live validation
- opt-in `Streamable HTTP` live validation
- shared environment contract for enabling the suites
- manual self-hosted workflow for triggering the suites
- runtime assertions against:
  - `engine-mcp://runtime/journal-index`
  - `engine-mcp://runtime/snapshot-metadata-index`

### Out of scope

- adding live adapter validation to the normal PR bar
- auto-starting Unity Editor from this workflow
- replacing the existing self-hosted Unity test workflow
- live subscriptions, pagination, or advanced diagnostics

### Operator model

The workflow assumes:

1. the Windows self-hosted runner is online
2. a Unity Editor session for the repository test host is already open
3. the live plugin bridge bootstrap file is available to the runner process

This is intentionally manual and explicit for the current public-repo threat model.

## Technical Specification

### Trigger model

The validation path should be manual-only through `workflow_dispatch`.

The repository should not route normal `pull_request` or default package tests into this live path.

### Test gating contract

The live suites should only execute when:

- `ENGINE_MCP_ENABLE_UNITY_LIVE_VALIDATION=true`

Optional override:

- `ENGINE_MCP_UNITY_LIVE_BOOTSTRAP_PATH`

If the bootstrap path override is absent, the bridge default path should be used.

### Expected runtime behavior

The live suites should use:

- `fallbackToSandbox: false`
- `sessionScope: "dangerous_write"`
- persistence enabled to a temp directory

The suite should validate a bounded flow:

1. `scene.object.create`
2. `scene.object.delete`
3. `snapshot.restore`
4. `scene.hierarchy.read`
5. `resources/read` of journal and snapshot metadata indexes

This ensures the preferred adapter is not silently falling back to sandbox.

### Bootstrap expectations

The default live bootstrap path follows the bridge contract under the system temp directory:

- `engine-mcp-platform/unity-plugin/engine-mcp-unity-plugin-session.json`

The actual full path is platform-specific and resolved by the bridge runtime.

## Acceptance Criteria

This slice is done when:

1. default package tests remain green with live validation disabled.
2. manual live suites execute only when the env gate is enabled.
3. live `stdio` and `Streamable HTTP` suites validate:
   - create
   - delete
   - restore
   - runtime journal resource
   - runtime snapshot metadata resource
4. a dedicated manual workflow exists for the self-hosted runner.

## Sources

- [GitHub: Using self-hosted runners in a workflow](https://docs.github.com/en/actions/hosting-your-own-runners/using-self-hosted-runners-in-a-workflow)
- [GitHub: Manually running a workflow](https://docs.github.com/en/actions/how-tos/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)
- [MCP Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
