# Unity CI Wrapper Migration Runbook

## Purpose

This runbook describes how to migrate the repository from the current GameCI-based Unity workflows to repository-owned Unity CI actions.

It also defines rollback conditions so the migration can be executed in controlled slices.

## Current Workflow Map

### Reusable test workflow

- `.github/workflows/test_unity_plugin.yml`

### Pull request workflow

- `.github/workflows/test_pull_request.yml`

### Release workflow

- `.github/workflows/release.yml`

### Current external dependencies to remove

- `game-ci/unity-test-runner@v4`
- `game-ci/unity-builder@v4`

## Migration Order

### Step 1

Freeze the runner/activation strategy from the Phase 0 spike result.

Current chosen target:

- self-hosted Windows x64 runner
- installed Unity editors
- no primary dependency on `unityci/editor` for V1

### Step 2

Implement and validate the local `run-tests` action.

### Step 3

Replace `game-ci/unity-test-runner@v4` inside `.github/workflows/test_unity_plugin.yml`.

### Step 4

Run `test-pull-request` on a PR branch and validate the full Unity matrix.

Current safety adjustment:

- self-hosted Unity jobs in `.github/workflows/test_pull_request.yml` are restricted to `workflow_dispatch` while the repository remains public
- do not use open `pull_request` execution as the primary self-hosted validation path

### Step 5

Implement and validate the local `build-project` action.

### Step 6

Replace remaining GameCI steps in `.github/workflows/release.yml`.

### Step 7

Run `release.yml` on a safe branch/tag scenario and verify artifacts.

## Workflow-Level Expectations

### `test_unity_plugin.yml`

Must preserve:

- current matrix shape
- current project path inputs
- current artifact upload behavior
- current result visibility in GitHub Actions

May change:

- internal activation/decode steps
- execution path from Docker containers to local `Unity.exe`
- summary/log formatting

### `release.yml`

Must preserve:

- installer test gate
- installer package export
- downstream release artifact publication

May change:

- internal Unity execution logic
- activation strategy
- log layout
- runner routing to self-hosted Windows labels

## Rollback Plan

Rollback trigger examples:

- more than one supported Unity version fails after wrapper migration
- installer export path changes unexpectedly
- action output contract is unstable
- secret masking regresses
- GitHub-hosted manual activation fails with machine-binding errors

Rollback action:

- revert the workflow call site to the previous GameCI step
- keep the local wrapper branch alive for debugging
- capture the failing logs and artifacts before rollback
- if the self-hosted runner is the cause, remove its label from workflow routing before broader rollback

## Validation Checklist

### After migrating `test_unity_plugin.yml`

- a trusted manual run can be executed with the runner started interactively via `E:\actions-runner\engine-mcp-platform\run.cmd`
- `editmode` green on `2022`
- `editmode` green on `2023`
- `editmode` green on `6000`
- `standalone` green on `2022`
- `standalone` green on `2023`
- `standalone` green on `6000`
- artifact uploads still present
- logs show the chosen license strategy
- logs show the resolved local editor path on the self-hosted runner

### After migrating `release.yml`

- installer EditMode test passes
- installer export passes
- package artifact name/path is unchanged or intentionally migrated
- release publication jobs still receive expected artifacts
- jobs route only to the intended self-hosted Windows runner labels

## Operational Notes

- prefer repository secrets:
  - `UNITY_LICENSE`
  - `UNITY_EMAIL`
  - `UNITY_PASSWORD`
- do not assume `UNITY_LICENSE` copied from a developer workstation is portable to GitHub-hosted Linux runners
- treat `UNITY_LICENSE` as primary only when the chosen runner/activation model supports the same machine-binding lifecycle
- keep fallback login disabled unless needed for a controlled rollback or emergency path
- for V1, treat the self-hosted runner's activated machine state as the operational primary path
- if the runner is installed as a Windows service, configure it from an elevated shell and prefer `Manual` startup over always-on execution on a public repository

### Elevated service conversion reference

```powershell
cd E:\actions-runner\engine-mcp-platform
.\config.cmd remove --local
.\config.cmd --unattended --url https://github.com/catrielzz/engine-mcp-platform --token <NUEVO_TOKEN> --name DESKTOP-FCF31GI-engine-mcp-platform --labels self-hosted,windows,x64,unity,unity-tests,unity-builds --work _work --replace --runasservice
```

## Phase 0 Constraint

The repository spike in:

- `artifacts/local-unity-ci-spike/2022.3.62f3-base-smoke/summary.json`
- `artifacts/local-unity-ci-spike/2022.3.62f3-base-smoke/activate.log`

confirmed:

- the container and `-manualLicenseFile` path work syntactically
- a Windows-host `.ulf` failed in the Linux container with `Machine bindings don't match`

So migration must not proceed on the assumption that a single static `.ulf` secret will work on GitHub-hosted Linux runners.

## Self-Hosted Runner Constraint

The self-hosted Windows runner becomes part of the CI product surface.

That means the migration must version and document:

- runner labels
- installed Unity versions
- editor path expectations
- service/account expectations
- operational recovery steps when the machine drifts

## Open Questions To Resolve During Migration

- whether the wrapper should support a licensing-server mode in V1
- whether login fallback should remain in `main` after the wrapper is stable
- whether local Windows validation should be codified in a repo script or left manual
- whether the long-term autoscaling path should be a wake-on-demand workstation, a stable Windows VM, or a true ephemeral self-hosted fleet

## Sources

- [GitHub workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
- [GitHub: Creating a JavaScript action](https://docs.github.com/en/actions/tutorials/creating-a-javascript-action)
- [GitHub: Using self-hosted runners in a workflow](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow)
- [Unity Support: manual activation overview](https://support.unity.com/hc/en-us/articles/4401914348436-How-do-I-manually-activate-my-Unity-license)
- [Unity Support: Machine Identification Is Invalid For Current License](https://support.unity.com/hc/en-us/articles/360039435032-I-receive-a-Machine-Identification-Is-Invalid-For-Current-License-when-attempting-to-activate-my-license)
