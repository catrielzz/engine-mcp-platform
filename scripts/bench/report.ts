import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { BenchReport, BenchScenarioResult } from "./common.ts";

interface ReportCliOptions {
  inputPath: string;
}

async function main(): Promise<void> {
  const options = parseReportCliOptions(process.argv.slice(2));
  const report = await readBenchReport(options.inputPath);

  console.log(renderMarkdownReport(report, resolve(options.inputPath)));
}

function parseReportCliOptions(argv: string[]): ReportCliOptions {
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
    throw new Error("bench report requires --input <path>.");
  }

  return {
    inputPath
  };
}

async function readBenchReport(path: string): Promise<BenchReport> {
  const payload = await readFile(resolve(path), "utf8");

  return JSON.parse(payload) as BenchReport;
}

function renderMarkdownReport(report: BenchReport, inputPath: string): string {
  const lines: string[] = [
    `# Benchmark Report: ${report.benchmark}`,
    "",
    `- Source: \`${inputPath}\``,
    `- Generated At: \`${report.generatedAt}\``,
    `- Node: \`${report.node.version}\` on \`${report.node.platform}/${report.node.arch}\``,
    `- Iterations: \`${report.options.iterations}\``,
    `- Warmup: \`${report.options.warmupIterations}\``,
    "",
    "| Scenario | Mean (ms) | P95 (ms) | Event Loop P95 (ms) | Heap After (MB) | RSS After (MB) |",
    "| --- | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.name} | ${formatNumber(scenario.latencyMs.mean)} | ${formatNumber(
        scenario.latencyMs.p95
      )} | ${formatNumber(scenario.eventLoopDelayMs.p95)} | ${formatMegabytes(
        scenario.memory.after.heapUsed
      )} | ${formatMegabytes(scenario.memory.after.rss)} |`
    );
  }

  lines.push("", "## Notes", "");
  lines.push(
    "- This report is descriptive; use `scripts/bench/compare.ts` to apply regression thresholds between two artifacts."
  );
  lines.push(
    `- File label: \`${basename(inputPath)}\``
  );

  return lines.join("\n");
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function formatMegabytes(value: number): string {
  return (value / (1024 * 1024)).toFixed(2);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
