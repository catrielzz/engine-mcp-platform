export interface BenchThresholdSet {
  latencyPct: number;
  eventLoopPct: number;
  memoryPct: number;
}

export interface BenchScenarioThresholdOverride {
  latencyPct?: number;
  eventLoopPct?: number;
  memoryPct?: number;
}

export interface BenchProfile {
  name: string;
  benchmark: string;
  baselineKind: "smoke" | "approval";
  baselinePath: string;
  candidatePath: string;
  recommendedIterations: number;
  recommendedWarmupIterations: number;
  defaultThresholds: BenchThresholdSet;
  scenarioThresholds: Record<string, BenchScenarioThresholdOverride>;
}

export const BENCH_PROFILES: Record<string, BenchProfile> = {
  "core-server": {
    name: "core-server",
    benchmark: "core-server",
    baselineKind: "smoke",
    baselinePath: "artifacts/bench/baselines/core-server-smoke-2026-03-22.json",
    candidatePath: "artifacts/bench/core-server-latest.json",
    recommendedIterations: 1,
    recommendedWarmupIterations: 1,
    defaultThresholds: {
      latencyPct: 15,
      eventLoopPct: 15,
      memoryPct: 15
    },
    scenarioThresholds: {
      "stdio.inline_tool_call.editor_state_read": {
        latencyPct: 75
      },
      "http.initialize_and_inline_tool_call.editor_state_read": {
        latencyPct: 30
      },
      "http.task_result_sse.replay_after_disconnect.editor_state_read": {
        latencyPct: 30
      },
      "http.task_side_sampling.single_turn.text_only": {
        latencyPct: 20
      }
    }
  },
  "unity-bridge": {
    name: "unity-bridge",
    benchmark: "unity-bridge",
    baselineKind: "smoke",
    baselinePath: "artifacts/bench/baselines/unity-bridge-smoke-2026-03-22.json",
    candidatePath: "artifacts/bench/unity-bridge-latest.json",
    recommendedIterations: 1,
    recommendedWarmupIterations: 1,
    defaultThresholds: {
      latencyPct: 20,
      eventLoopPct: 40,
      memoryPct: 30
    },
    scenarioThresholds: {
      "localhost.inline_request.editor_state_read": {
        latencyPct: 150
      }
    }
  },
  "core-server-approval": {
    name: "core-server-approval",
    benchmark: "core-server",
    baselineKind: "approval",
    baselinePath: "artifacts/bench/baselines/core-server-approval-2026-03-22.json",
    candidatePath: "artifacts/bench/approval/core-server-latest.json",
    recommendedIterations: 10,
    recommendedWarmupIterations: 3,
    defaultThresholds: {
      latencyPct: 12,
      eventLoopPct: 15,
      memoryPct: 15
    },
    scenarioThresholds: {
      "stdio.inline_tool_call.editor_state_read": {
        latencyPct: 25
      },
      "http.task_result_sse.replay_after_disconnect.editor_state_read": {
        latencyPct: 20
      },
      "http.task_side_sampling.single_turn.text_only": {
        latencyPct: 15
      },
      "http.task_side_sampling.tool_loop.two_turn": {
        latencyPct: 15
      }
    }
  },
  "unity-bridge-approval": {
    name: "unity-bridge-approval",
    benchmark: "unity-bridge",
    baselineKind: "approval",
    baselinePath: "artifacts/bench/baselines/unity-bridge-approval-2026-03-22.json",
    candidatePath: "artifacts/bench/approval/unity-bridge-latest.json",
    recommendedIterations: 10,
    recommendedWarmupIterations: 3,
    defaultThresholds: {
      latencyPct: 15,
      eventLoopPct: 20,
      memoryPct: 20
    },
    scenarioThresholds: {
      "localhost.inline_request.editor_state_read": {
        latencyPct: 25
      },
      "localhost.concurrent_requests.within_cap": {
        latencyPct: 18,
        eventLoopPct: 25
      }
    }
  }
};

export function getBenchProfile(profileName: string): BenchProfile {
  const profile = BENCH_PROFILES[profileName];

  if (!profile) {
    throw new Error(
      `Unknown benchmark profile: ${profileName}. Expected one of: ${Object.keys(
        BENCH_PROFILES
      ).join(", ")}`
    );
  }

  return profile;
}
