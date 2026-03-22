import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { BenchReport, BenchScenarioResult } from "./common.ts";

interface CompareCliOptions {
  baselinePath: string;
  candidatePath: string;
  latencyThresholdPct: number;
  eventLoopThresholdPct: number;
  memoryThresholdPct: number;
}

interface ScenarioComparison {
  name: string;
  status: "improved" | "regressed" | "unchanged" | "missing";
  metrics: Array<{
    metric: string;
    baseline: number;
    candidate: number;
    delta: number;
    deltaPct: number;
    status: "improved" | "regressed" | "unchanged";
  }>;
}

async function main(): Promise<void> {
  const options = parseCompareCliOptions(process.argv.slice(2));
  const baseline = await readBenchReport(options.baselinePath);
  const candidate = await readBenchReport(options.candidatePath);
  const comparisons = compareReports(baseline, candidate, options);
  const summary = summarizeComparisons(comparisons);

  console.log(
    JSON.stringify(
      {
        benchmark: candidate.benchmark,
        baseline: resolve(options.baselinePath),
        candidate: resolve(options.candidatePath),
        thresholds: {
          latencyPct: options.latencyThresholdPct,
          eventLoopPct: options.eventLoopThresholdPct,
          memoryPct: options.memoryThresholdPct
        },
        summary,
        comparisons
      },
      null,
      2
    )
  );

  if (summary.regressed > 0) {
    process.exitCode = 1;
  }
}

function parseCompareCliOptions(argv: string[]): CompareCliOptions {
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

  const baselinePath = values.get("baseline");
  const candidatePath = values.get("candidate");

  if (!baselinePath || !candidatePath) {
    throw new Error(
      "bench compare requires --baseline <path> and --candidate <path>."
    );
  }

  return {
    baselinePath,
    candidatePath,
    latencyThresholdPct: parseThreshold(values.get("latency-threshold"), 10),
    eventLoopThresholdPct: parseThreshold(values.get("eventloop-threshold"), 10),
    memoryThresholdPct: parseThreshold(values.get("memory-threshold"), 10)
  };
}

async function readBenchReport(path: string): Promise<BenchReport> {
  const payload = await readFile(resolve(path), "utf8");

  return JSON.parse(payload) as BenchReport;
}

function compareReports(
  baseline: BenchReport,
  candidate: BenchReport,
  options: CompareCliOptions
): ScenarioComparison[] {
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

    if (!baselineScenario || !candidateScenario) {
      return {
        name: scenarioName,
        status: "missing",
        metrics: []
      };
    }

    const metrics = [
      compareMetric(
        "latency.mean",
        baselineScenario.latencyMs.mean,
        candidateScenario.latencyMs.mean,
        options.latencyThresholdPct
      ),
      compareMetric(
        "latency.p95",
        baselineScenario.latencyMs.p95,
        candidateScenario.latencyMs.p95,
        options.latencyThresholdPct
      ),
      compareMetric(
        "eventLoop.mean",
        baselineScenario.eventLoopDelayMs.mean,
        candidateScenario.eventLoopDelayMs.mean,
        options.eventLoopThresholdPct
      ),
      compareMetric(
        "eventLoop.p95",
        baselineScenario.eventLoopDelayMs.p95,
        candidateScenario.eventLoopDelayMs.p95,
        options.eventLoopThresholdPct
      ),
      compareMetric(
        "memory.heapUsed.after",
        baselineScenario.memory.after.heapUsed,
        candidateScenario.memory.after.heapUsed,
        options.memoryThresholdPct
      ),
      compareMetric(
        "memory.rss.after",
        baselineScenario.memory.after.rss,
        candidateScenario.memory.after.rss,
        options.memoryThresholdPct
      )
    ];

    return {
      name: scenarioName,
      status: summarizeScenarioStatus(metrics),
      metrics
    };
  });
}

function compareMetric(
  metric: string,
  baseline: number,
  candidate: number,
  thresholdPct: number
): {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  deltaPct: number;
  status: "improved" | "regressed" | "unchanged";
} {
  const delta = candidate - baseline;
  const denominator = baseline === 0 ? 1 : baseline;
  const deltaPct = (delta / denominator) * 100;
  const normalizedThreshold = Math.abs(thresholdPct);
  let status: "improved" | "regressed" | "unchanged" = "unchanged";

  if (deltaPct >= normalizedThreshold) {
    status = "regressed";
  } else if (deltaPct <= -normalizedThreshold) {
    status = "improved";
  }

  return {
    metric,
    baseline,
    candidate,
    delta,
    deltaPct,
    status
  };
}

function summarizeScenarioStatus(
  metrics: Array<{
    status: "improved" | "regressed" | "unchanged";
  }>
): "improved" | "regressed" | "unchanged" {
  if (metrics.some((metric) => metric.status === "regressed")) {
    return "regressed";
  }

  if (metrics.some((metric) => metric.status === "improved")) {
    return "improved";
  }

  return "unchanged";
}

function summarizeComparisons(comparisons: ScenarioComparison[]): {
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

function parseThreshold(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative threshold percentage. Received: ${value}`);
  }

  return parsed;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
