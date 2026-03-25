# Local Bridge Contract

## Purpose

This contract defines the first local protocol between the Unity C# plugin and the Node bridge under `adapters/unity/bridge/`.

It is intentionally not MCP itself. MCP stays between clients and the Node server. This local contract is only the Unity-to-bridge seam.
The same envelope is now used in both directions:

- `plugin -> bridge` when Unity calls the Node bridge
- `bridge -> plugin` when the Node bridge proxies into the live Unity Editor dispatcher

## Envelope

Every request carries:

- `protocolVersion`
- `requestId`
- `capability`
- `sessionScope`
- `payload`

Every response carries:

- `protocolVersion`
- `requestId`
- `success`
- `payload`
- optional `snapshotId`
- optional `error`

For `scene.object.delete`, `snapshotId` is now backed by a real Unity-side disk snapshot entry under `Library/EngineMcp/Snapshots/` for the deleted sandbox subtree. `snapshot.restore` uses that same store, consumes the matching snapshot on successful restore, and Unity records delete/restore journal entries under `Library/EngineMcp/Journal/`.

## Initial capabilities

The current contract version covers:

- `editor.state.read`
- `asset.search`
- `script.validate`
- `console.read`
- `scene.hierarchy.read`
- `scene.object.create`
- `scene.object.update`
- `scene.object.delete`
- `snapshot.restore`
- `test.run`
- `test.job.read`

## Error shape

When `success` is `false`, the response should include:

- `error.code`
- `error.message`
- optional `error.details`

For sandbox denials coming from the live Unity editor handlers, `error.code = policy_denied` and
`error.message = target_outside_sandbox` now carry structured `error.details` such as:

- `rule` (`scene_path`, `object_namespace`, `sandbox_root_immutable`)
- `targetLogicalName`
- `targetDisplayName`
- `scenePath`
- `expectedScenePath`

Missing rollback availability now follows the same policy-shaped contract:

- `error.code = policy_denied`
- `error.message = rollback_unavailable`
- `error.details.capability = snapshot.restore`
- `error.details.snapshotId = ...`

Initial error codes for `0.1.0`:

- `validation_error`
- `policy_denied`
- `scope_missing`
- `target_not_found`
- `snapshot_failed`
- `bridge_transport_error`

Backward-compatibility note:

- older bridge/plugin envelopes may still arrive with `error.code = rollback_unavailable`
- readers should treat that as a legacy form and normalize it to `error.code = policy_denied` with
  `error.message = rollback_unavailable`

## Transport note

The protocol stays transport-agnostic at the envelope level.

The first implemented transport is:

- `HTTP` over `127.0.0.1`
- `POST /bridge/call`
- header `x-engine-mcp-session-token` for the session secret
- `Content-Type: application/json`

Bridge-owned session bootstrap handoff for `plugin -> bridge`:

- environment variable `ENGINE_MCP_UNITY_BRIDGE_SESSION_FILE`
- default bootstrap path under the OS temp directory:
  `engine-mcp-platform/unity-bridge/engine-mcp-unity-bridge-session.json`
- bootstrap JSON fields:
  `protocolVersion`, `transport`, `endpointUrl`, `sessionToken`, `issuedAt`, `ownerProcessId`

Bootstrap fallback for manual debugging only:

- `ENGINE_MCP_UNITY_BRIDGE_URL`
- `ENGINE_MCP_UNITY_BRIDGE_TOKEN`

When Unity resolves the bridge bootstrap, it validates the owner process id before trusting the session. Missing or stale bridge bootstraps clear the cached configuration, and `CreateDefaultClient()` refreshes from the manifest on every use instead of trusting an old session silently.

Plugin-owned session bootstrap handoff for `bridge -> plugin`:

- environment variable `ENGINE_MCP_UNITY_PLUGIN_SESSION_FILE`
- default bootstrap path under the OS temp directory:
  `engine-mcp-platform/unity-plugin/engine-mcp-unity-plugin-session.json`
- bootstrap JSON fields:
  `protocolVersion`, `transport`, `endpointUrl`, `sessionToken`, `issuedAt`, `ownerProcessId`

The Unity plugin writes this second manifest when the editor-hosted local HTTP server starts, and removes it on shutdown / reload. The Node proxy validates the owner process id before using it and discards stale manifests when the owning Unity process is no longer alive.

The message shape above must remain stable even if the transport changes later.

## Ownership split

- this package owns C# DTOs, the Unity-facing client stub, and the editor-hosted local HTTP server that dispatches back into Unity on the main thread
- `adapters/unity/bridge/` owns the Node-side contract implementation, envelope parsing, proxy adapter, and policy/snapshot behavior
- changes to this contract must be reflected in both sides and recorded in the root `CHANGELOG.md`
