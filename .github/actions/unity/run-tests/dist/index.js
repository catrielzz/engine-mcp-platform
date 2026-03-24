import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildUnityRunTestsArgs, deriveUnityTestArtifactPaths } from "../../../../../scripts/ci/unity/run-tests.js";
import { resolveWindowsUnityEditorPath } from "../../../../../scripts/ci/unity/host-unity.js";
function getInput(name) {
    return (process.env[`INPUT_${name.replace(/ /g, "_").replace(/-/g, "_").toUpperCase()}`] ?? "").trim();
}
function getRequiredInput(name) {
    const value = getInput(name);
    if (!value) {
        throw new Error(`Missing required input: ${name}`);
    }
    return value;
}
async function writeOutput(name, value) {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) {
        console.log(`${name}=${value}`);
        return;
    }
    await fs.appendFile(outputPath, `${name}=${value}\n`, "utf8");
}
async function run() {
    if (process.platform !== "win32") {
        throw new Error(`unity-run-tests currently supports only self-hosted Windows runners. Current platform: ${process.platform}`);
    }
    const workspacePath = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const projectPath = path.resolve(workspacePath, getRequiredInput("project-path"));
    const unityVersion = getRequiredInput("unity-version");
    const testMode = getRequiredInput("test-mode");
    const unityEditorPath = getInput("unity-editor-path");
    const artifactsPath = getInput("artifacts-path");
    const customParameters = getInput("custom-parameters");
    const artifacts = deriveUnityTestArtifactPaths({
        workspacePath,
        unityVersion,
        testMode,
        artifactsPath
    });
    await fs.mkdir(artifacts.artifactsPath, { recursive: true });
    const resolvedEditor = resolveWindowsUnityEditorPath({
        projectPath,
        unityVersion,
        unityEditorPath: unityEditorPath || undefined
    });
    const args = buildUnityRunTestsArgs({
        projectPath,
        resultsXmlPath: artifacts.resultsXmlPath,
        logPath: artifacts.logPath,
        testMode,
        customParameters
    });
    const startedAt = new Date().toISOString();
    const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(resolvedEditor.editorPath, args, {
            cwd: workspacePath,
            stdio: "inherit"
        });
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 1));
    });
    const finishedAt = new Date().toISOString();
    await fs.writeFile(artifacts.summaryPath, JSON.stringify({
        projectPath,
        requestedUnityVersion: unityVersion,
        resolvedUnityVersion: resolvedEditor.resolvedVersion,
        unityEditorPath: resolvedEditor.editorPath,
        testMode,
        startedAt,
        finishedAt,
        exitCode,
        artifactsPath: artifacts.artifactsPath,
        resultsXmlPath: artifacts.resultsXmlPath,
        logPath: artifacts.logPath,
        licenseStrategy: "self_hosted_prelicensed"
    }, null, 2), "utf8");
    await writeOutput("artifacts-path", artifacts.artifactsPath);
    await writeOutput("results-xml-path", artifacts.resultsXmlPath);
    await writeOutput("log-path", artifacts.logPath);
    await writeOutput("summary-path", artifacts.summaryPath);
    await writeOutput("unity-editor-path", resolvedEditor.editorPath);
    await writeOutput("unity-editor-version", resolvedEditor.resolvedVersion);
    await writeOutput("license-strategy", "self_hosted_prelicensed");
    if (exitCode !== 0) {
        throw new Error(`Unity test run failed with exit code ${exitCode}. See ${artifacts.logPath}`);
    }
}
run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
