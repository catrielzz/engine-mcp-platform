import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Options = {
  unityVersion: string;
  imagePlatform: string;
  projectPath: string;
  outputDir: string;
  licenseFile?: string;
  imageVersion: string;
  keepTemp: boolean;
};

type SpikeSummary = {
  unityVersion: string;
  imagePlatform: string;
  imageTag: string;
  projectPath: string;
  outputDir: string;
  activationExitCode: number | null;
  verifyExitCode: number | null;
  dockerExitCode: number | null;
  success: boolean;
  usedLicenseSource: "file" | "env";
  timestamp: string;
};

function fail(message: string): never {
  console.error(`[unity-license-spike] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      fail(`Unexpected argument: ${current}`);
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(key);
      continue;
    }

    values.set(key, next);
    index += 1;
  }

  const unityVersion = values.get("unity-version");
  if (!unityVersion) {
    fail("Missing required argument --unity-version <version>.");
  }

  const imagePlatform = values.get("image-platform") ?? "base";
  const projectPath = path.resolve(values.get("project-path") ?? path.join("Unity-Tests", unityVersion));
  const outputDir = path.resolve(
    values.get("output-dir") ?? path.join("artifacts", "local-unity-ci-spike", `${unityVersion}-${imagePlatform}`),
  );
  const licenseFile = values.get("license-file") ? path.resolve(values.get("license-file")!) : undefined;
  const imageVersion = values.get("image-version") ?? "3";
  const keepTemp = flags.has("keep-temp");

  return {
    unityVersion,
    imagePlatform,
    projectPath,
    outputDir,
    licenseFile,
    imageVersion,
    keepTemp,
  };
}

function ensureDockerAvailable(): void {
  const versionResult = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (versionResult.error || versionResult.status !== 0) {
    fail("Docker CLI is required for this spike. Ensure Docker Desktop or a compatible Docker installation is available.");
  }

  const result = spawnSync("docker", ["info"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail("Docker daemon is not available. Start Docker Desktop or another compatible Docker engine before running the spike.");
  }
}

function readLicense(options: Options): { content: string; source: "file" | "env" } {
  if (options.licenseFile) {
    if (!existsSync(options.licenseFile)) {
      fail(`License file not found: ${options.licenseFile}`);
    }
    return {
      content: readFileSync(options.licenseFile, "utf8"),
      source: "file",
    };
  }

  const envLicense = process.env.UNITY_LICENSE;
  if (!envLicense || envLicense.trim().length === 0) {
    fail("Provide --license-file <path> or set UNITY_LICENSE in the environment.");
  }

  return {
    content: envLicense,
    source: "env",
  };
}

function writeSummary(summaryPath: string, summary: SpikeSummary): void {
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  ensureDockerAvailable();

  if (!existsSync(options.projectPath)) {
    fail(`Project path does not exist: ${options.projectPath}`);
  }

  const license = readLicense(options);

  mkdirSync(options.outputDir, { recursive: true });

  const tempRoot = mkdtempSync(path.join(tmpdir(), "unity-license-spike-"));
  const licensesDir = path.join(tempRoot, "licenses");
  const outputMountDir = path.join(tempRoot, "output");
  mkdirSync(licensesDir, { recursive: true });
  mkdirSync(outputMountDir, { recursive: true });

  const licensePath = path.join(licensesDir, "license.ulf");
  writeFileSync(licensePath, license.content, "utf8");

  const imageTag = `unityci/editor:ubuntu-${options.unityVersion}-${options.imagePlatform}-${options.imageVersion}`;
  const activationLog = path.join(options.outputDir, "activate.log");
  const verifyLog = path.join(options.outputDir, "verify.log");
  const dockerTranscript = path.join(options.outputDir, "docker-transcript.log");
  const summaryPath = path.join(options.outputDir, "summary.json");

  const containerCommand = [
    "set -euo pipefail",
    "echo '[unity-license-spike] Starting activation using -manualLicenseFile'",
    "unity-editor -batchmode -nographics -manualLicenseFile /licenses/license.ulf -logFile /output/activate.log",
    "echo '[unity-license-spike] Activation command completed, running verification against mounted project'",
    "unity-editor -batchmode -nographics -quit -projectPath /workspace/project -logFile /output/verify.log",
  ].join(" && ");

  const dockerArgs = [
    "run",
    "--rm",
    "--workdir",
    "/workspace",
    "--volume",
    `${options.projectPath}:/workspace/project`,
    "--volume",
    `${licensesDir}:/licenses`,
    "--volume",
    `${outputMountDir}:/output`,
    imageTag,
    "/bin/bash",
    "-lc",
    containerCommand,
  ];

  console.log(`[unity-license-spike] Image: ${imageTag}`);
  console.log(`[unity-license-spike] Project: ${options.projectPath}`);
  console.log(`[unity-license-spike] Output: ${options.outputDir}`);
  console.log(`[unity-license-spike] License source: ${license.source}`);

  const result = spawnSync("docker", dockerArgs, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  writeFileSync(dockerTranscript, `${stdout}${stderr}`, "utf8");

  if (stdout.trim().length > 0) {
    process.stdout.write(stdout);
  }
  if (stderr.trim().length > 0) {
    process.stderr.write(stderr);
  }

  const activationLogPath = path.join(outputMountDir, "activate.log");
  const verifyLogPath = path.join(outputMountDir, "verify.log");
  const activationExitCode = existsSync(activationLogPath)
    ? stdout.includes("Activation command completed")
      ? 0
      : 1
    : null;
  const verifyExitCode = existsSync(verifyLogPath) && result.status === 0 ? 0 : null;

  if (existsSync(activationLogPath)) {
    writeFileSync(activationLog, readFileSync(activationLogPath, "utf8"), "utf8");
  }
  if (existsSync(verifyLogPath)) {
    writeFileSync(verifyLog, readFileSync(verifyLogPath, "utf8"), "utf8");
  }

  const summary: SpikeSummary = {
    unityVersion: options.unityVersion,
    imagePlatform: options.imagePlatform,
    imageTag,
    projectPath: options.projectPath,
    outputDir: options.outputDir,
    activationExitCode,
    verifyExitCode,
    dockerExitCode: result.status,
    success: result.status === 0,
    usedLicenseSource: license.source,
    timestamp: new Date().toISOString(),
  };

  writeSummary(summaryPath, summary);

  if (!options.keepTemp) {
    rmSync(tempRoot, { force: true, recursive: true });
  } else {
    console.log(`[unity-license-spike] Temp directory preserved at: ${tempRoot}`);
  }

  if (result.error) {
    fail(`Docker execution failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Spike failed with docker exit code ${result.status}. See ${dockerTranscript} and ${summaryPath}.`);
  }

  console.log("[unity-license-spike] Spike completed successfully.");
  console.log(`[unity-license-spike] Activation log: ${activationLog}`);
  console.log(`[unity-license-spike] Verify log: ${verifyLog}`);
  console.log(`[unity-license-spike] Summary: ${summaryPath}`);
}

main();
