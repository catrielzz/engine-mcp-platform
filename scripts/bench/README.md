# Benchmarks

This folder holds lightweight, reproducible benchmark entrypoints for the active TypeScript runtime.

Current entrypoints:

- `core-server.ts`
- `unity-bridge.ts`
- `check.ts`
- `check-report.ts`
- `compare.ts`
- `report.ts`

CI coverage:

- `.github/workflows/platform_bench.yml`

## Run

From the workspace root:

```bash
pnpm bench:core-server
pnpm bench:unity-bridge
pnpm bench:core-server:approval
pnpm bench:unity-bridge:approval
pnpm bench:check:core-server
pnpm bench:check:unity-bridge
pnpm bench:check:core-server:approval
pnpm bench:check:unity-bridge:approval
pnpm bench:report -- --input artifacts/bench/core-server-latest.json
pnpm bench:compare:core-server:baseline
pnpm bench:compare:unity-bridge:baseline
```

Optional flags:

```bash
pnpm bench:core-server -- --iterations 10 --warmup 2 --output-dir artifacts/bench
pnpm bench:unity-bridge -- --iterations 10 --warmup 2 --output-dir artifacts/bench
pnpm bench:check:core-server -- --candidate artifacts/bench/core-server-latest.json
pnpm bench:check:unity-bridge -- --candidate artifacts/bench/unity-bridge-latest.json
pnpm bench:report -- --input artifacts/bench/approval/core-server-latest.json
pnpm bench:check:core-server:approval -- --candidate artifacts/bench/approval/core-server-latest.json
pnpm bench:compare -- --baseline artifacts/bench/baselines/core-server-smoke-2026-03-22.json --candidate artifacts/bench/core-server-latest.json --latency-threshold 10 --eventloop-threshold 10 --memory-threshold 10
```

## Output

Each run writes two JSON artifacts:

- `artifacts/bench/core-server-latest.json`
- `artifacts/bench/core-server-<timestamp>.json`
- `artifacts/bench/unity-bridge-latest.json`
- `artifacts/bench/unity-bridge-<timestamp>.json`

The report includes:

- scenario latency summaries (`min`, `max`, `mean`, `p50`, `p95`)
- event-loop delay summaries via `monitorEventLoopDelay()`
- memory snapshots from `process.memoryUsage()`
- resource deltas from `process.resourceUsage()`

The companion utilities add:

- Markdown summaries from a single JSON report
- threshold-based comparison between a baseline artifact and a candidate artifact
- profile-aware checks with per-scenario thresholds
- exit code `1` from `compare.ts` when one or more scenarios regress past the configured threshold
- exit code `1` from `check.ts` when one or more scenarios regress past the approved profile thresholds

## Versioned baselines

The repository now keeps the first approved smoke baselines under:

- `artifacts/bench/baselines/core-server-smoke-2026-03-22.json`
- `artifacts/bench/baselines/unity-bridge-smoke-2026-03-22.json`

The repository also keeps the first approval-oriented baselines under:

- `artifacts/bench/baselines/core-server-approval-2026-03-22.json`
- `artifacts/bench/baselines/unity-bridge-approval-2026-03-22.json`

The active CI approval baselines now target the GitHub-hosted Ubuntu runner family:

- `artifacts/bench/baselines/core-server-approval-github-ubuntu-2026-03-23.json`
- `artifacts/bench/baselines/unity-bridge-approval-github-ubuntu-2026-03-23.json`

Recommended workflow:

1. Use the default `bench:*` scripts for quick smoke drift checks under `artifacts/bench/`.
2. Use the `bench:*:approval` scripts for more stable approval runs under `artifacts/bench/approval/`.
3. Run the matching `bench:check:*` profile against the generated `*-latest.json`.
4. Re-baseline only when the performance change is intentional and reviewed, then add a new dated baseline instead of overwriting the old one.

Current status:

- the approved profiles are still smoke-oriented
- they use scenario-specific thresholds because `1/1` benchmark artifacts are intentionally lightweight and noisier than a longer benchmark run
- use `compare.ts` directly when you want a stricter ad hoc comparison with custom thresholds

Approval notes:

- approval runs use `10` iterations and `3` warmup iterations
- approval scripts run Node with `--expose-gc` so the harness can call `globalThis.gc()` when available before and after measurement
- approval profiles are intended to become the stricter long-term gate once enough history exists to tighten thresholds further
- approval baselines are runner-specific; the repository's active approval profiles target `ubuntu-latest` because `.github/workflows/platform_bench.yml` runs on GitHub-hosted Ubuntu VMs
- `check.ts` now fails explicitly when the baseline and candidate artifacts come from different runner families such as local `win32/x64` versus CI `linux/x64`
- if you want to inspect local Windows or macOS approval runs, compare them against a same-platform baseline instead of reusing the GitHub Ubuntu approval baseline

## CI

The repository also runs the approval benchmark flow through:

- manual trigger: `Platform Bench` via `workflow_dispatch`
- daily scheduled trigger: `17 5 * * *`

Each job uploads its generated approval artifacts from `artifacts/bench/approval/` with a `14` day retention period, even when the benchmark check fails.
Each job also writes a Markdown summary to the GitHub Actions job summary surface through `GITHUB_STEP_SUMMARY`, using the same `bench:report` renderer as the local CLI flow.
The workflow also preserves the JSON output of `bench:check:*:approval`, renders a compact gate summary from it, and emits `::notice` / `::error` annotations for regressed or missing scenarios before failing the job.

## Scope

This is a reproducible benchmark harness, not a correctness test suite.

The first slice focuses on:

- `stdio` inline `tools/call`
- `Streamable HTTP` initialize + inline `tools/call`
- `Streamable HTTP` task lifecycle (`tools/call` task creation + `tasks/get` + `tasks/result`)

The current `core-server` slice also covers heavier task transport paths:

- `Streamable HTTP` `tasks/result` SSE completion over a live task stream
- `Streamable HTTP` `tasks/result` replay after disconnect using `Last-Event-ID`
- `Streamable HTTP` task-side `sampling/createMessage` single-turn request/response
- `Streamable HTTP` task-side `sampling/createMessage` multi-turn `tool_use` / `tool_result` loop

The second slice adds localhost bridge transport coverage for:

- single inline bridge requests
- concurrent request bursts within the configured cap
- invocation timeout / abort handling through the local transport
