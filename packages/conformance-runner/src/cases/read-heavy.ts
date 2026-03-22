import type { ConformanceCase, ReadHeavyConformanceCaseOptions } from "../types.js";

export function createReadHeavyConformanceCases(
  options: ReadHeavyConformanceCaseOptions = {}
): readonly ConformanceCase[] {
  const testJobId = options.testJobId ?? "job-123";
  const scriptPath = options.scriptPath ?? "Assets/Scripts/Spawner.cs";
  const scriptAssetGuid = options.scriptAssetGuid ?? "sandbox-script-001";

  return Object.freeze([
    {
      id: "asset.search:filtered-truncated",
      capability: "asset.search",
      expectation: "success",
      summary: "Returns filtered asset results with truncation metadata.",
      input: {
        query: "Sandbox",
        roots: ["Assets/MCP_Sandbox"],
        kinds: ["scene", "prefab"],
        limit: 1
      },
      expectedOutputSubset: {
        truncated: true,
        results: [
          {
            kind: "scene"
          }
        ]
      }
    },
    {
      id: "script.validate:path",
      capability: "script.validate",
      expectation: "success",
      summary: "Resolves script validation by direct path.",
      input: {
        path: scriptPath,
        includeWarnings: false
      },
      expectedOutputSubset: {
        targetPath: scriptPath
      }
    },
    {
      id: "script.validate:asset-guid",
      capability: "script.validate",
      expectation: "success",
      summary: "Resolves script validation by asset GUID.",
      input: {
        assetGuid: scriptAssetGuid,
        includeWarnings: true
      },
      expectedOutputSubset: {
        targetPath: scriptPath
      }
    },
    {
      id: "console.read:severity-pagination",
      capability: "console.read",
      expectation: "success",
      summary: "Applies severity filtering and incremental pagination.",
      input: {
        sinceSequence: 0,
        severities: ["warning", "error"],
        limit: 1
      },
      expectedOutputSubset: {
        nextSequence: 2,
        truncated: true,
        entries: [
          {
            severity: "warning",
            sequence: 2
          }
        ]
      }
    },
    {
      id: "test.run:accepted-filter",
      capability: "test.run",
      expectation: "success",
      summary: "Returns an accepted filter for a non-blocking editor test run.",
      input: {
        filter: {
          namePattern: "Sandbox"
        },
        executionTarget: "editor",
        waitForCompletion: false
      },
      expectedOutputSubset: {
        acceptedFilter: {
          namePattern: "Sandbox"
        }
      }
    },
    {
      id: "test.job.read:max-results",
      capability: "test.job.read",
      expectation: "success",
      summary: "Reads a known test job and respects maxResults.",
      input: {
        jobId: testJobId,
        maxResults: 1
      },
      expectedOutputSubset: {
        jobId: testJobId,
        progress: 1,
        summary: {
          passed: 1,
          failed: 0,
          skipped: 0
        },
        results: [
          {
            status: "passed"
          }
        ]
      }
    }
  ]);
}

export const READ_HEAVY_CONFORMANCE_CASES = createReadHeavyConformanceCases();
