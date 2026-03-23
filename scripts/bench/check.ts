import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { BenchReport } from "./common.ts";
import { getBenchProfile, type BenchProfile, type BenchThresholdSet } from "./bench-profiles.ts";

interface CheckCliOptions {
  profileName: string;
  baselinePath?: string;
  candidatePath?: string;
}

interface BenchMetricComparison {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  deltaPct: number;
  thresholdPct: number;
  status: "improved" | "regressed" | "unchanged";
}

interface BenchScenarioCheck {
  name: string;
  status: "improved" | "regressed" | "unchanged" | "missing";
  thresholds: BenchThresholdSet;
  metrics: BenchMetricComparison[];
}

interface BenchRuntimeDescriptor {
  version: string;
  platform: BenchReport["node"]["platform"];
  arch: string;
}

interface BenchCheckError {
  code: "incompatible_runtime";
  message: string;
}

async function main(): Promise<void> {
  const options = parseCheckCliOptions(process.argv.slice(2));
  const profile = getBenchProfile(options.profileName);
  const baselinePath = resolve(options.baselinePath ?? profile.baselinePath);
  const candidatePath = resolve(options.candidatePath ?? profile.candidatePath);
  const baseline = await readBenchReport(baselinePath);
  const candidate = await readBenchReport(candidatePath);
  const baselineRuntime = toRuntimeDescriptor(baseline);
  const candidateRuntime = toRuntimeDescriptor(candidate);
  const error = resolveCompatibilityError(baseline, candidate, profile);
  const comparisons = error ? [] : compareAgainstProfile(baseline, candidate, profile);
  const summary = error
    ? {
        improved: 0,
        regressed: 0,
        unchanged: 0,
        missing: 0
      }
    : summarizeComparisons(comparisons);

  console.log(
    JSON.stringify(
      {
        profile: profile.name,
        benchmark: candidate.benchmark,
        baselineKind: profile.baselineKind,
        baseline: baselinePath,
        candidate: candidatePath,
        baselineRuntime,
        candidateRuntime,
        recommended: {
          iterations: profile.recommendedIterations,
          warmupIterations: profile.recommendedWarmupIterations
        },
        summary,
        comparisons,
        ...(error ? { error } : {})
      },
      null,
      2
    )
  );

  if (error || summary.regressed > 0 || summary.missing > 0) {
    process.exitCode = 1;
  }
}

function parseCheckCliOptions(argv: string[]): CheckCliOptions {
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

  const profileName = values.get("profile");

  if (!profileName) {
    throw new Error("bench check requires --profile <name>.");
  }

  return {
    profileName,
    baselinePath: values.get("baseline"),
    candidatePath: values.get("candidate")
  };
}

async function readBenchReport(path: string): Promise<BenchReport> {
  const payload = await readFile(path, "utf8");

  return JSON.parse(payload) as BenchReport;
}

function toRuntimeDescriptor(report: BenchReport): BenchRuntimeDescriptor {
  return {
    version: report.node.version,
    platform: report.node.platform,
    arch: report.node.arch
  };
}

function resolveCompatibilityError(
  baseline: BenchReport,
  candidate: BenchReport,
  profile: BenchProfile
): BenchCheckError | undefined {
  const mismatches: string[] = [];

  if (baseline.node.platform !== candidate.node.platform) {
    mismatches.push(
      `platform baseline=${baseline.node.platform} candidate=${candidate.node.platform}`
    );
  }

  if (baseline.node.arch !== candidate.node.arch) {
    mismatches.push(`arch baseline=${baseline.node.arch} candidate=${candidate.node.arch}`);
  }

  if (mismatches.length === 0) {
    return undefined;
  }

  return {
    code: "incompatible_runtime",
    message:
      `Profile ${profile.name} requires runner-compatible artifacts. ` +
      `Approval baselines are runner-specific, but this check compared different runtimes ` +
      `(${mismatches.join(", ")}). Regenerate the baseline on ` +
      `${candidate.node.platform}/${candidate.node.arch} or choose a baseline captured ` +
      `on the same runner family as the candidate artifact.`
  };
}

function compareAgainstProfile(
  baseline: BenchReport,
  candidate: BenchReport,
  profile: BenchProfile
): BenchScenarioCheck[] {
  if (candidate.benchmark !== profile.benchmark) {
    throw new Error(
      `Profile ${profile.name} expects benchmark ${profile.benchmark}, received ${candidate.benchmark}.`
    );
  }

  const baselineScenarios = new Map(
    baseline.scenarios.map((scenario) => [scenario.name, scenario])
  );
  const candidateScenarios = new Map(
    candidate.scenarios.map((scenario) => [scenario.name, scenario])
  );
  const scenarioNames = new Set([
    ...baselineScenarios.keys(),
    ...candidateScenarios.keys()
  ]);

  return [...scenarioNames].sort().map((scenarioName) => {
    const baselineScenario = baselineScenarios.get(scenarioName);
    const candidateScenario = candidateScenarios.get(scenarioName);
    const thresholds = resolveScenarioThresholds(profile, scenarioName);

    if (!baselineScenario || !candidateScenario) {
      return {
        name: scenarioName,
        status: "missing",
        thresholds,
        metrics: []
      };
    }

    const metrics: BenchMetricComparison[] = [
      compareMetric(
        "latency.mean",
        baselineScenario.latencyMs.mean,
        candidateScenario.latencyMs.mean,
        thresholds.latencyPct
      ),
      compareMetric(
        "latency.p95",
        baselineScenario.latencyMs.p95,
        candidateScenario.latencyMs.p95,
        thresholds.latencyPct
      ),
      compareMetric(
        "eventLoop.mean",
        baselineScenario.eventLoopDelayMs.mean,
        candidateScenario.eventLoopDelayMs.mean,
        thresholds.eventLoopPct
      ),
      compareMetric(
        "eventLoop.p95",
        baselineScenario.eventLoopDelayMs.p95,
        candidateScenario.eventLoopDelayMs.p95,
        thresholds.eventLoopPct
      ),
      compareMetric(
        "memory.heapUsed.after",
        baselineScenario.memory.after.heapUsed,
        candidateScenario.memory.after.heapUsed,
        thresholds.memoryPct
      ),
      compareMetric(
        "memory.rss.after",
        baselineScenario.memory.after.rss,
        candidateScenario.memory.after.rss,
        thresholds.memoryPct
      )
    ];

    return {
      name: scenarioName,
      status: summarizeScenarioStatus(metrics),
      thresholds,
      metrics
    };
  });
}

function resolveScenarioThresholds(
  profile: BenchProfile,
  scenarioName: string
): BenchThresholdSet {
  const overrides = profile.scenarioThresholds[scenarioName] ?? {};

  return {
    latencyPct: overrides.latencyPct ?? profile.defaultThresholds.latencyPct,
    eventLoopPct:
      overrides.eventLoopPct ?? profile.defaultThresholds.eventLoopPct,
    memoryPct: overrides.memoryPct ?? profile.defaultThresholds.memoryPct
  };
}

function compareMetric(
  metric: string,
  baseline: number,
  candidate: number,
  thresholdPct: number
): BenchMetricComparison {
  const delta = candidate - baseline;
  const denominator = baseline === 0 ? 1 : baseline;
  const deltaPct = (delta / denominator) * 100;
  let status: "improved" | "regressed" | "unchanged" = "unchanged";

  if (deltaPct >= thresholdPct) {
    status = "regressed";
  } else if (deltaPct <= -thresholdPct) {
    status = "improved";
  }

  return {
    metric,
    baseline,
    candidate,
    delta,
    deltaPct,
    thresholdPct,
    status
  };
}

function summarizeScenarioStatus(
  metrics: BenchMetricComparison[]
): "improved" | "regressed" | "unchanged" {
  if (metrics.some((metric) => metric.status === "regressed")) {
    return "regressed";
  }

  if (metrics.some((metric) => metric.status === "improved")) {
    return "improved";
  }

  return "unchanged";
}

function summarizeComparisons(comparisons: BenchScenarioCheck[]): {
  improved: number;
  regressed: number;
  unchanged: number;
  missing: number;
} {
  return comparisons.reduce(
    (summary, comparison) => {
      summary[comparison.status] += 1;
      return summary;
    },
    {
      improved: 0,
      regressed: 0,
      unchanged: 0,
      missing: 0
    }
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
