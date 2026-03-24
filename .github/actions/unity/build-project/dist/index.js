import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildUnityExecuteMethodArgs, deriveUnityBuildArtifactPaths, resolveWindowsUnityEditorPath } from "../../../../../scripts/ci/unity/build-project.js";
function getInput(name) {
    return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
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
        throw new Error(`unity-build-project currently supports only self-hosted Windows runners. Current platform: ${process.platform}`);
    }
    const workspacePath = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const projectPath = path.resolve(workspacePath, getRequiredInput("project-path"));
    const unityVersion = getRequiredInput("unity-version");
    const buildMethod = getRequiredInput("build-method");
    const unityEditorPath = getInput("unity-editor-path");
    const buildsPath = getInput("builds-path");
    const buildOutputPath = getInput("build-output-path");
    const customParameters = getInput("custom-parameters");
    const artifacts = deriveUnityBuildArtifactPaths({
        workspacePath,
        unityVersion,
        buildsPath,
        buildOutputPath
    });
    await fs.mkdir(artifacts.buildsPath, { recursive: true });
    const resolvedEditor = resolveWindowsUnityEditorPath({
        projectPath,
        unityVersion,
        unityEditorPath: unityEditorPath || undefined
    });
    const args = buildUnityExecuteMethodArgs({
        projectPath,
        logPath: artifacts.logPath,
        buildMethod,
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
    const buildOutputExists = await fs
        .stat(artifacts.buildOutputPath)
        .then((stat) => stat.isFile() || stat.isDirectory())
        .catch(() => false);
    await fs.writeFile(artifacts.summaryPath, JSON.stringify({
        projectPath,
        requestedUnityVersion: unityVersion,
        resolvedUnityVersion: resolvedEditor.resolvedVersion,
        unityEditorPath: resolvedEditor.editorPath,
        buildMethod,
        startedAt,
        finishedAt,
        exitCode,
        buildsPath: artifacts.buildsPath,
        buildOutputPath: artifacts.buildOutputPath,
        buildOutputExists,
        logPath: artifacts.logPath,
        licenseStrategy: "self_hosted_prelicensed"
    }, null, 2), "utf8");
    await writeOutput("builds-path", artifacts.buildsPath);
    await writeOutput("build-output-path", artifacts.buildOutputPath);
    await writeOutput("log-path", artifacts.logPath);
    await writeOutput("summary-path", artifacts.summaryPath);
    await writeOutput("unity-editor-path", resolvedEditor.editorPath);
    await writeOutput("unity-editor-version", resolvedEditor.resolvedVersion);
    await writeOutput("license-strategy", "self_hosted_prelicensed");
    if (exitCode !== 0) {
        throw new Error(`Unity build failed with exit code ${exitCode}. See ${artifacts.logPath}`);
    }
    if (!buildOutputExists) {
        throw new Error(`Unity build completed without producing the expected artifact: ${artifacts.buildOutputPath}`);
    }
}
run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
