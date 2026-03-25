# Unity Self-Hosted Runner Onboarding

## Purpose

This document defines the baseline setup for the repository's primary Unity CI runner.

For V1, the target is:

- Windows
- x64
- self-hosted GitHub Actions runner
- locally installed Unity editors

## Why This Exists

The repository's Phase 0 licensing spike showed that a workstation-generated `.ulf` is not portable as-is to GitHub-hosted Linux containers:

- `artifacts/local-unity-ci-spike/2022.3.62f3-base-smoke/activate.log`

So the V1 wrapper path depends on a stable machine identity with local Unity installations.

## Host Requirements

- Windows x64 machine
- Docker optional, not required for the primary V1 path
- GitHub self-hosted runner installed
- Unity Hub installed
- required Unity editor versions installed locally
- runner machine activated for the intended Unity workflow

Repository-supported Unity versions today:

- `2022.3.62f3`
- `2023.2.22f1`
- `6000.3.11f1`

## Runner Registration

Use the repository or organization self-hosted runner flow in GitHub.

Official notes:

- GitHub allows adding self-hosted runners at repository or organization scope.
- On Windows, GitHub recommends `C:\actions-runner` if the runner is installed as a service.
- Jobs can be routed with cumulative labels.

Recommended labels:

- `self-hosted`
- `windows`
- `x64`
- `unity`
- `unity-tests`
- `unity-builds`

Optional version labels if you want tighter routing:

- `unity-2022`
- `unity-2023`
- `unity-6000`

## Local Interactive Mode

Use this mode first when validating the runner on a developer workstation.

1. Open a regular PowerShell window.
2. Start the runner manually:

```powershell
cd E:\actions-runner\engine-mcp-platform
.\run.cmd
```

Operational notes:

- Unity does not need to be open ahead of time.
- The runner machine must stay awake and online while the job is running.
- This mode is the safest first step for a public repository because the runner is only online when you intentionally start it.

Recommended first validation:

- trigger `workflow_dispatch`
- confirm the job lands on the labels `self-hosted`, `windows`, `x64`, `unity`, `unity-tests`
- stop the runner after the trusted run completes

## Windows Service Mode

Use this mode only from an elevated PowerShell window.

If you want the runner installed as a Windows service, reconfigure it with `--runasservice`:

```powershell
cd E:\actions-runner\engine-mcp-platform
.\config.cmd remove --local
.\config.cmd --unattended --url https://github.com/catrielzz/engine-mcp-platform --token <NUEVO_TOKEN> --name DESKTOP-FCF31GI-engine-mcp-platform --labels self-hosted,windows,x64,unity,unity-tests,unity-builds --work _work --replace --runasservice
```

After service installation:

- set startup mode to `Manual`
- do not leave the service permanently running in a public repository
- start it only for trusted runs you intend to execute

Repository inference:

- on this workstation, service installation required Administrator privileges
- the repository was successfully registered without elevation, but Windows service setup was blocked until an elevated shell is used

## Public Repository Hardening

This repository is public, so self-hosted routing must be treated as sensitive infrastructure.

Current repository hardening:

- Unity self-hosted jobs in `.github/workflows/test_pull_request.yml` are restricted to `workflow_dispatch`
- `release.yml` self-hosted jobs still run only on trusted `push` events to `main`

Recommended operating policy:

- do not leave the runner online continuously
- do not use self-hosted Unity jobs for untrusted fork PR execution
- prefer manual runs or trusted branch pushes while the self-hosted rollout is still maturing
- review any new workflow that adds `runs-on: [self-hosted, ...]` before merging it

## Editor Path Contract

The wrapper should resolve local editors from either:

1. explicit workflow/action input
2. repository-owned version map
3. conventional Hub install paths

Expected Windows shape:

- `C:\Program Files\Unity\Hub\Editor\2022.3.62f3\Editor\Unity.exe`
- `C:\Program Files\Unity\Hub\Editor\2023.2.22f1\Editor\Unity.exe`
- `C:\Program Files\Unity\Hub\Editor\6000.3.11f1\Editor\Unity.exe`

Note:

- the repository's Unity 6 host project now lives at `Unity-Tests/6000.3.11f1`
- CI should trust `ProjectVersion.txt` and the configured editor map, not only the project folder name

## Service And Account Expectations

If the runner is installed as a Windows service:

- install from an elevated shell
- verify the runner remains able to access the Unity installation and the activated machine context

Repository inference:

- because the activation context is machine-bound, the first end-to-end validation should be run on the exact machine/account setup that will own the runner operationally
- if the service context behaves differently from the interactive user context, validate that before cutting workflows over

This is a repository operational inference from the Phase 0 spike and current local validation, not a Unity official prescription.

## Initial Validation Checklist

Before migrating workflows:

- runner shows as online in GitHub Actions
- labels are applied as expected
- `Unity.exe` is resolvable for all required versions
- `EditMode` local smoke passes
- `StandaloneWindows64` local smoke passes
- artifact paths are writable by the runner process

## Workflow Routing Guidance

Unity jobs should not use generic `windows-latest` once the wrapper migration begins.

Prefer explicit routing such as:

- `runs-on: [self-hosted, windows, x64, unity, unity-tests]`

If build jobs need separation:

- `runs-on: [self-hosted, windows, x64, unity, unity-builds]`

## Recovery Checklist

If the runner starts failing unexpectedly:

- verify the runner is online
- verify labels still match workflow routing
- verify the workflow run is using the expected workflow SHA and not an older PR merge ref
- verify the expected Unity versions are still installed
- verify `Unity.exe` paths did not change
- verify local action manifests parse correctly if the failure happens before Unity starts
- verify local EditMode still passes outside GitHub Actions
- only then investigate wrapper code

## Sources

- [GitHub: Using self-hosted runners in a workflow](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow)
- [GitHub: Adding self-hosted runners](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
- [GitHub: Applying labels to self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/apply-labels)
- [GitHub: Configuring the self-hosted runner application as a service](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configuring-the-self-hosted-runner-application-as-a-service)
- [GitHub: Security hardening for GitHub Actions](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [Unity Test Runner command line usage](https://docs.unity3d.com/es/2017.4/Manual/testing-editortestsrunner.html)
