# @engine-mcp/unity-bridge

Bootstrap Unity bridge adapter for the first executable P0 slice.

Current scope:

- in-memory sandbox scene state
- contract-aware handling for `editor.state.read`
- contract-aware handling for `asset.search`
- contract-aware handling for `script.validate`
- contract-aware handling for `console.read`
- contract-aware handling for `scene.hierarchy.read`
- contract-aware handling for `scene.object.create`
- contract-aware handling for `scene.object.update`
- contract-aware handling for `scene.object.delete`
- contract-aware handling for `snapshot.restore`
- contract-aware handling for synthetic `test.run` and `test.job.read` in the sandbox adapter
- scope-based policy checks for destructive operations
- snapshot capture and restore hooks for delete flows
- Node-side local bridge contract exports and envelope parsers for the Unity plugin seam
- localhost HTTP listener for the Unity plugin over `127.0.0.1`
- session bootstrap manifest helpers for handing endpoint and token data to the Unity plugin
- plugin-session bootstrap helpers for discovering the Unity-hosted editor-backed endpoint, including stale-manifest rejection by owner process id
- HTTP proxy adapter that forwards the current scene, asset, script, console, and test capabilities into the live Unity plugin
- preferred adapter helper that uses the live Unity plugin when available and falls back to the sandbox adapter when the plugin bootstrap is missing
- canonical sandbox denial helpers shared with `@engine-mcp/policy-engine` so `policy_denied` details stay stable across fallback and live adapter paths
- aligned rollback-missing behavior across fallback and live plugin paths so `snapshot.restore` now fails as `policy_denied` with reason `rollback_unavailable`
- standalone `rollback_unavailable` bridge error codes are now treated as legacy compatibility input only and normalized back to the canonical `policy_denied` contract
- sandbox fallback naming and boundary checks now converge with the live Unity plugin on the reserved `MCP_E2E__*` namespace under `SandboxRoot`
- conformance-tested against the canonical P0 runner subset

Out of scope for this slice:

- persistent snapshot/journal semantics in the sandbox fallback adapter
- core-server wiring that makes the preferred Unity adapter the default runtime path
