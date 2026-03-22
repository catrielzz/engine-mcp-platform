# @engine-mcp/conformance-runner

Canonical conformance runner for adapter and toolpack checks against the P0 contract slice.

Current scope:

- built-in P0 fixtures for valid and invalid requests
- generic runner that executes capability cases against an adapter candidate
- structured error expectations for valid requests that should fail with a canonical error shape
- subset-based output assertions for success cases through `expectedOutputSubset`
- reusable richer read-heavy cases for `asset.search`, `script.validate`, `console.read`, `test.run`, and `test.job.read`
- output validation through `@engine-mcp/contracts`
- report helpers for CI and local adapter bring-up
