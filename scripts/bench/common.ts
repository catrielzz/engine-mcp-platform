import { mkdir, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import process from "node:process";
import { resolve } from "node:path";

export interface BenchCliOptions {
  iterations: number;
  warmupIterations: number;
  outputDir: string;
}

export interface BenchLatencySummary {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

export interface BenchEventLoopSummary {
  min: number;
  max: number;
  mean: number;
  p95: number;
}

export interface BenchMemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  availableMemory?: number;
}

export interface BenchResourceUsageDelta {
  userCPUTime: number;
  systemCPUTime: number;
  maxRSS: number;
  voluntaryContextSwitches: number;
  involuntaryContextSwitches: number;
  fsRead: number;
  fsWrite: number;
}

export interface BenchScenarioResult {
  name: string;
  iterations: number;
  warmupIterations: number;
  latencyMs: BenchLatencySummary;
  eventLoopDelayMs: BenchEventLoopSummary;
  memory: {
    before: BenchMemorySnapshot;
    after: BenchMemorySnapshot;
  };
  resourceUsage: BenchResourceUsageDelta;
  samplesMs: number[];
}

export interface BenchReport {
  benchmark: string;
  generatedAt: string;
  node: {
    version: string;
    platform: NodeJS.Platform;
    arch: string;
    pid: number;
  };
  options: BenchCliOptions;
  scenarios: BenchScenarioResult[];
}

export async function measureScenario(
  name: string,
  options: Pick<BenchCliOptions, "iterations" | "warmupIterations">,
  runIteration: (iteration: number) => Promise<void>
): Promise<BenchScenarioResult> {
  for (let iteration = 0; iteration < options.warmupIterations; iteration += 1) {
    await runIteration(iteration);
  }

  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }

  const histogram = monitorEventLoopDelay({
    resolution: 10
  });
  const memoryBefore = snapshotMemory();
  const resourceBefore = process.resourceUsage();
  const samplesMs: number[] = [];

  histogram.enable();

  try {
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      const startedAt = performance.now();
      await runIteration(iteration);
      samplesMs.push(performance.now() - startedAt);
    }
  } finally {
    histogram.disable();
  }

  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }

  const memoryAfter = snapshotMemory();
  const resourceAfter = process.resourceUsage();

  return {
    name,
    iterations: options.iterations,
    warmupIterations: options.warmupIterations,
    latencyMs: summarizeLatencies(samplesMs),
    eventLoopDelayMs: summarizeEventLoopDelay(histogram),
    memory: {
      before: memoryBefore,
      after: memoryAfter
    },
    resourceUsage: diffResourceUsage(resourceBefore, resourceAfter),
    samplesMs
  };
}

export async function writeBenchArtifacts(
  benchmark: string,
  report: BenchReport,
  outputDir: string
): Promise<{
  latestPath: string;
  timestampedPath: string;
}> {
  const resolvedOutputDir = resolve(outputDir);
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+$/, "Z");
  const latestPath = resolve(resolvedOutputDir, `${benchmark}-latest.json`);
  const timestampedPath = resolve(resolvedOutputDir, `${benchmark}-${timestamp}.json`);

  await mkdir(resolvedOutputDir, {
    recursive: true
  });

  const payload = JSON.stringify(report, null, 2);
  await writeFile(latestPath, payload, "utf8");
  await writeFile(timestampedPath, payload, "utf8");

  return {
    latestPath,
    timestampedPath
  };
}

export function parseBenchCliOptions(argv: string[]): BenchCliOptions {
  const defaults: BenchCliOptions = {
    iterations: 25,
    warmupIterations: 5,
    outputDir: "artifacts/bench"
  };

  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && value && !value.startsWith("--")) {
      values.set(rawKey, value);
      index += 1;
      continue;
    }

    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
    }
  }

  return {
    iterations: parsePositiveInteger(values.get("iterations"), defaults.iterations),
    warmupIterations: parsePositiveInteger(
      values.get("warmup"),
      defaults.warmupIterations
    ),
    outputDir: values.get("output-dir") ?? defaults.outputDir
  };
}

function snapshotMemory(): BenchMemorySnapshot {
  const memoryUsage = process.memoryUsage();
  const availableMemory =
    typeof process.availableMemory === "function" ? process.availableMemory() : undefined;

  return {
    rss: memoryUsage.rss,
    heapTotal: memoryUsage.heapTotal,
    heapUsed: memoryUsage.heapUsed,
    external: memoryUsage.external,
    arrayBuffers: memoryUsage.arrayBuffers,
    ...(availableMemory !== undefined ? { availableMemory } : {})
  };
}

function summarizeLatencies(samplesMs: number[]): BenchLatencySummary {
  const sortedSamples = [...samplesMs].sort((left, right) => left - right);

  return {
    min: sortedSamples[0] ?? 0,
    max: sortedSamples.at(-1) ?? 0,
    mean:
      samplesMs.length === 0
        ? 0
        : samplesMs.reduce((total, value) => total + value, 0) / samplesMs.length,
    p50: percentile(sortedSamples, 0.5),
    p95: percentile(sortedSamples, 0.95)
  };
}

function summarizeEventLoopDelay(
  histogram: ReturnType<typeof monitorEventLoopDelay>
): BenchEventLoopSummary {
  const count = Number((histogram as { count?: number }).count ?? 0);

  if (count === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      p95: 0
    };
  }

  return {
    min: histogram.min / 1_000_000,
    max: histogram.max / 1_000_000,
    mean: histogram.mean / 1_000_000,
    p95: histogram.percentile(95) / 1_000_000
  };
}

function diffResourceUsage(
  before: ReturnType<typeof process.resourceUsage>,
  after: ReturnType<typeof process.resourceUsage>
): BenchResourceUsageDelta {
  return {
    userCPUTime: after.userCPUTime - before.userCPUTime,
    systemCPUTime: after.systemCPUTime - before.systemCPUTime,
    maxRSS: after.maxRSS - before.maxRSS,
    voluntaryContextSwitches:
      after.voluntaryContextSwitches - before.voluntaryContextSwitches,
    involuntaryContextSwitches:
      after.involuntaryContextSwitches - before.involuntaryContextSwitches,
    fsRead: after.fsRead - before.fsRead,
    fsWrite: after.fsWrite - before.fsWrite
  };
}

function percentile(sortedSamples: number[], percentileValue: number): number {
  if (sortedSamples.length === 0) {
    return 0;
  }

  const clampedPercentile = Math.min(Math.max(percentileValue, 0), 1);
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * clampedPercentile) - 1)
  );

  return sortedSamples[index];
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}
