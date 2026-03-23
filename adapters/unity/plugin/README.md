# Engine MCP Unity Plugin

Unity-side plugin scaffold for the Engine MCP Platform.

Current scope:

- Unity Package Manager package manifest
- runtime and editor assemblies
- local bridge DTOs for the Node bridge contract
- localhost HTTP transport implementation and client stub for bridge calls
- session bootstrap manifest support via `ENGINE_MCP_UNITY_BRIDGE_SESSION_FILE`
- plugin-side localhost HTTP server for bridge-to-plugin editor-backed calls
- plugin-side session bootstrap manifest support via `ENGINE_MCP_UNITY_PLUGIN_SESSION_FILE`
- bootstrap refresh/invalidation for the bridge client, including stale-manifest rejection by owner process id
- sandbox scaffold helpers for `Assets/MCP_Sandbox/` and `Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity`
- editor-backed handlers for `editor.state.read`, `asset.search`, `script.validate`, `console.read`, `scene.hierarchy.read`, `scene.object.create`, `scene.object.update`, `scene.object.delete`, `snapshot.restore`, `test.run`, and `test.job.read`
- real asset search for `asset.search`, backed by `AssetDatabase.FindAssets`, GUID/path resolution, and canonical kind mapping
- compiler-backed script validation for `script.validate`, backed by `CompilationPipeline` compiler messages plus path/GUID script resolution
- resident editor log collector for `console.read`, backed by `Application.logMessageReceivedThreaded`
- Unity Test Framework-backed in-memory job registry for `test.run` / `test.job.read`
- disk-backed delete snapshot store for `scene.object.delete`, with a public `snapshot.restore` capability that can restore the deleted sandbox subtree by `snapshotId`
- mutation journal persistence under `Library/EngineMcp/Journal/` for delete and restore flows
- policy-shaped rollback denials for missing restore availability, aligned with the fallback adapter as `policy_denied` + `rollback_unavailable`
- legacy `rollback_unavailable` transport codes are accepted only for backward compatibility and should be normalized to the policy-shaped contract
- protocol documentation under `Documentation~/`
- contract mirror for Node lives in `../bridge/src/plugin-contract.ts`
- JSON serialization now uses `com.unity.nuget.newtonsoft-json` for Unity-host compatibility
- package manifest now declares `com.unity.test-framework`
- package-pure DTO/client/bootstrap tests live under `Tests/Editor`, while `Unity-Tests/6000.3.1f1` is reserved for host/integration coverage and batch execution of both assemblies

Out of scope for this slice:

- making the preferred bridge adapter the default runtime path in the future core server
- generated cross-language sync for contract constants between the TypeScript policy package and the Unity C# protocol layer

## TDD Host Loop

Use `Unity-Tests/6000.3.1f1` as the stable EditMode host for this package.

Batch verification entry point:

```powershell
$env:ENGINE_MCP_UNITY_BATCH_TEST_RESULTS='E:\engine-mcp-platform\artifacts\unity-editmode-results.xml'
$env:ENGINE_MCP_UNITY_BATCH_TEST_SUMMARY='E:\engine-mcp-platform\artifacts\unity-editmode-summary.txt'
E:\Unity\Hub\Editor\6000.3.11f1\Editor\Unity.exe `
  -batchmode -nographics `
  -projectPath E:\engine-mcp-platform\Unity-Tests\6000.3.1f1 `
  -logFile E:\engine-mcp-platform\artifacts\unity-editmode-tests.log `
  -executeMethod EngineMcp.Unity.Plugin.HostTests.EngineMcpBatchTestRunner.RunEditorTests `
  -quit
```

The batch runner writes:

- XML results to `ENGINE_MCP_UNITY_BATCH_TEST_RESULTS`
- a short textual summary to `ENGINE_MCP_UNITY_BATCH_TEST_SUMMARY`

If those environment variables are not set, the fallback artifact directory is `Unity-Tests/6000.3.1f1/artifacts/`.
