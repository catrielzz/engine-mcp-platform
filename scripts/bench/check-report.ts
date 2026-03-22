import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { basename, resolve } from "node:path";

interface CheckMetric {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  deltaPct: number;
  thresholdPct: number;
  status: "improved" | "regressed" | "unchanged";
}

interface CheckScenario {
  name: string;
  status: "improved" | "regressed" | "unchanged" | "missing";
  thresholds: {
    latencyPct: number;
    eventLoopPct: number;
    memoryPct: number;
  };
  metrics: CheckMetric[];
}

interface CheckReport {
  profile: string;
  benchmark: string;
  baselineKind: "smoke" | "approval";
  baseline: string;
  candidate: string;
  recommended: {
    iterations: number;
    warmupIterations: number;
  };
  summary: {
    improved: number;
    regressed: number;
    unchanged: number;
    missing: number;
  };
  comparisons: CheckScenario[];
}

interface CheckReportCliOptions {
  inputPath: string;
  format: "markdown" | "workflow";
  title?: string;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await readCheckReport(options.inputPath);

  if (options.format === "workflow") {
    process.stdout.write(renderWorkflowCommands(report));
    return;
  }

  process.stdout.write(renderMarkdownSummary(report, options.inputPath, options.title));
}

function parseCliOptions(argv: string[]): CheckReportCliOptions {
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

  const inputPath = values.get("input");

  if (!inputPath) {
    throw new Error("bench check-report requires --input <path>.");
  }

  const formatValue = values.get("format") ?? "markdown";

  if (formatValue !== "markdown" && formatValue !== "workflow") {
    throw new Error(
      `Unsupported check-report format: ${formatValue}. Expected markdown or workflow.`
    );
  }

  return {
    inputPath,
    format: formatValue,
    title: values.get("title")
  };
}

async function readCheckReport(path: string): Promise<CheckReport> {
  const payload = await readFile(resolve(path));

  return JSON.parse(extractJsonPayload(decodeTextPayload(payload))) as CheckReport;
}

function renderMarkdownSummary(
  report: CheckReport,
  inputPath: string,
  title: string | undefined
): string {
  const heading = title ?? `${report.profile} gate`;
  const regressed = report.comparisons.filter((scenario) => scenario.status === "regressed");
  const missing = report.comparisons.filter((scenario) => scenario.status === "missing");
  const lines: string[] = [
    `# ${heading}`,
    "",
    `- Source: \`${resolve(inputPath)}\``,
    `- Profile: \`${report.profile}\``,
    `- Baseline kind: \`${report.baselineKind}\``,
    `- Recommended iterations: \`${report.recommended.iterations}\``,
    `- Recommended warmup: \`${report.recommended.warmupIterations}\``,
    `- Summary: \`regressed=${report.summary.regressed}\`, \`missing=${report.summary.missing}\`, \`unchanged=${report.summary.unchanged}\`, \`improved=${report.summary.improved}\``,
    ""
  ];

  if (regressed.length === 0 && missing.length === 0) {
    lines.push("- Gate result: no regressions detected.");
    return `${lines.join("\n")}\n`;
  }

  if (regressed.length > 0) {
    lines.push("## Regressed Scenarios", "");
    for (const scenario of regressed) {
      lines.push(
        `- \`${scenario.name}\`: ${formatMetricHighlights(
          scenario.metrics.filter((metric) => metric.status === "regressed")
        )}`
      );
    }
    lines.push("");
  }

  if (missing.length > 0) {
    lines.push("## Missing Scenarios", "");
    for (const scenario of missing) {
      lines.push(`- \`${scenario.name}\``);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderWorkflowCommands(report: CheckReport): string {
  const commands: string[] = [];
  const regressed = report.comparisons.filter((scenario) => scenario.status === "regressed");
  const missing = report.comparisons.filter((scenario) => scenario.status === "missing");

  if (regressed.length === 0 && missing.length === 0) {
    commands.push(
      `::notice title=${escapeWorkflowValue(
        `${report.profile} benchmark gate`
      )}::No benchmark regressions detected.`
    );
    return `${commands.join("\n")}\n`;
  }

  for (const scenario of regressed) {
    const highlights = formatMetricHighlights(
      scenario.metrics.filter((metric) => metric.status === "regressed")
    );
    commands.push(
      `::error title=${escapeWorkflowValue(
        `${report.profile}: ${scenario.name}`
      )}::${escapeWorkflowValue(highlights)}`
    );
  }

  for (const scenario of missing) {
    commands.push(
      `::error title=${escapeWorkflowValue(
        `${report.profile}: ${scenario.name}`
      )}::Scenario is missing from either the baseline or candidate artifact.`
    );
  }

  return `${commands.join("\n")}\n`;
}

function formatMetricHighlights(metrics: CheckMetric[]): string {
  if (metrics.length === 0) {
    return "No metric details available.";
  }

  return metrics
    .map(
      (metric) =>
        `${metric.metric} ${formatSigned(metric.deltaPct)}% (threshold ${metric.thresholdPct}%)`
    )
    .join("; ");
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function escapeWorkflowValue(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function extractJsonPayload(payload: string): string {
  const normalized = payload.replace(/^\uFEFF/, "").trim();
  const firstBraceIndex = normalized.indexOf("{");
  const lastBraceIndex = normalized.lastIndexOf("}");

  if (firstBraceIndex === -1 || lastBraceIndex === -1 || lastBraceIndex < firstBraceIndex) {
    throw new Error("check-report could not locate a JSON object in the provided input.");
  }

  return normalized.slice(firstBraceIndex, lastBraceIndex + 1);
}

function decodeTextPayload(payload: Buffer): string {
  if (payload.length >= 2) {
    if (payload[0] === 0xff && payload[1] === 0xfe) {
      return payload.subarray(2).toString("utf16le");
    }

    if (payload[0] === 0xfe && payload[1] === 0xff) {
      const swapped = Buffer.from(payload.subarray(2));

      for (let index = 0; index + 1 < swapped.length; index += 2) {
        const first = swapped[index];
        swapped[index] = swapped[index + 1];
        swapped[index + 1] = first;
      }

      return swapped.toString("utf16le");
    }
  }

  if (payload.length >= 3 && payload[0] === 0xef && payload[1] === 0xbb && payload[2] === 0xbf) {
    return payload.subarray(3).toString("utf8");
  }

  return payload.toString("utf8");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
