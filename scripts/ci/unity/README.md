# Unity CI Spike

This folder holds early validation tooling for the repository-owned Unity CI actions.

Current entrypoint:

- `license-spike.ts`
- `run-tests.js`
- `build-project.js`

## Purpose

Validate whether `unityci/editor` can consume a `.ulf` file with `-manualLicenseFile` across the Unity versions and image variants already used by repository CI.

This is a spike, not the final action implementation.

The helper layer now also includes:

- `run-tests.js`
- `build-project.js`

That helper is shared by the first repository-owned self-hosted Windows action under:

- `.github/actions/unity/run-tests/`
- `.github/actions/unity/build-project/`

## Run

From the workspace root:

```bash
pnpm unity:license-spike -- --unity-version 2022.3.62f3 --license-file "C:\\ProgramData\\Unity\\Unity_lic.ulf"
pnpm unity:license-spike -- --unity-version 2023.2.22f1 --image-platform base --license-file "C:\\ProgramData\\Unity\\Unity_lic.ulf"
pnpm unity:license-spike -- --unity-version 6000.3.11f1 --image-platform windows-mono --license-file "C:\\ProgramData\\Unity\\Unity_lic.ulf"
```

You can also provide the license through `UNITY_LICENSE` instead of `--license-file`.

Optional flags:

```bash
pnpm unity:license-spike -- --unity-version 6000.3.11f1 --project-path "./Unity-Tests/6000.3.11f1" --output-dir artifacts/local-unity-ci-spike/6000-base
pnpm unity:license-spike -- --unity-version 2022.3.62f3 --keep-temp
```

## Output

Each run writes:

- `activate.log`
- `verify.log`
- `docker-transcript.log`
- `summary.json`

under the selected output directory, which defaults to:

- `artifacts/local-unity-ci-spike/<unityVersion>-<imagePlatform>/`

## Notes

- Docker is required.
- The script mounts the target project and runs the same `unityci/editor` image family already used by CI.
- The script prefers `--license-file` for local validation because it avoids shell-specific multiline environment issues.
