import {
  createUnityBridgeLocalHttpServer,
  createUnityLocalBridgeRequest,
  parseUnityLocalBridgeResponse,
  type UnityBridgeLocalHttpAdapter,
  type UnityLocalBridgeCallResponse
} from "../../adapters/unity/bridge/src/index.ts";

import {
  measureScenario,
  parseBenchCliOptions,
  writeBenchArtifacts,
  type BenchCliOptions,
  type BenchReport
} from "./common.ts";

const SAMPLE_EDITOR_STATE_INPUT = {
  includeDiagnostics: true,
  includeActiveContainer: true
};

const SAMPLE_EDITOR_STATE_OUTPUT = {
  engine: "Unity",
  engineVersion: "6000.3.11f1",
  workspaceName: "Unity-Tests",
  isReady: true,
  activity: "idle",
  selectionCount: 0,
  activeContainer: {
    displayName: "MCP_Sandbox",
    enginePath: "Assets/MCP_Sandbox/Scenes/MCP_Sandbox.unity"
  },
  diagnostics: []
};

const BENCH_SESSION_TOKEN = "bench-unity-bridge-session-token";
const BENCH_SESSION_SCOPE = "inspect";
const CONCURRENT_REQUEST_COUNT = 4;
const CONCURRENT_REQUEST_DELAY_MS = 10;
const TIMEOUT_SCENARIO_TIMEOUT_MS = 25;

async function main(): Promise<void> {
  const options = parseBenchCliOptions(process.argv.slice(2));
  const scenarios = [
    await runInlineRequestScenario(options),
    await runConcurrentRequestsScenario(options),
    await runInvocationTimeoutScenario(options)
  ];
  const report: BenchReport = {
    benchmark: "unity-bridge",
    generatedAt: new Date().toISOString(),
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    },
    options,
    scenarios
  };
  const artifacts = await writeBenchArtifacts(
    report.benchmark,
    report,
    options.outputDir
  );

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `Wrote benchmark artifacts to ${artifacts.latestPath} and ${artifacts.timestampedPath}`
  );
}

async function runInlineRequestScenario(options: BenchCliOptions) {
  const server = createUnityBridgeLocalHttpServer({
    adapter: createStaticEditorStateAdapter(),
    port: 0,
    sessionToken: BENCH_SESSION_TOKEN
  });

  await server.start();

  try {
    return await measureScenario(
      "localhost.inline_request.editor_state_read",
      options,
      async (iteration) => {
        const envelope = await postEditorStateRead(server.address!.url, iteration);

        assertSuccessfulEditorStateResponse(envelope);
      }
    );
  } finally {
    await server.stop();
  }
}

async function runConcurrentRequestsScenario(options: BenchCliOptions) {
  const server = createUnityBridgeLocalHttpServer({
    adapter: createDelayedEditorStateAdapter(CONCURRENT_REQUEST_DELAY_MS),
    port: 0,
    sessionToken: BENCH_SESSION_TOKEN,
    maxConcurrentRequests: CONCURRENT_REQUEST_COUNT
  });

  await server.start();

  try {
    return await measureScenario(
      "localhost.concurrent_requests.within_cap",
      options,
      async (iteration) => {
        const envelopes = await Promise.all(
          Array.from({ length: CONCURRENT_REQUEST_COUNT }, (_, index) =>
            postEditorStateRead(server.address!.url, iteration * CONCURRENT_REQUEST_COUNT + index)
          )
        );

        for (const envelope of envelopes) {
          assertSuccessfulEditorStateResponse(envelope);
        }
      }
    );
  } finally {
    await server.stop();
  }
}

async function runInvocationTimeoutScenario(options: BenchCliOptions) {
  const server = createUnityBridgeLocalHttpServer({
    adapter: createTimeoutBenchAdapter(),
    port: 0,
    sessionToken: BENCH_SESSION_TOKEN,
    invocationTimeoutMs: TIMEOUT_SCENARIO_TIMEOUT_MS
  });

  await server.start();

  try {
    return await measureScenario(
      "localhost.invocation_timeout.abort_path",
      options,
      async (iteration) => {
        const envelope = await postEditorStateRead(server.address!.url, iteration);

        if (envelope.success || !envelope.error) {
          throw new Error(
            `Expected timeout scenario to return an error envelope. Received: ${JSON.stringify(envelope)}`
          );
        }

        if (envelope.error.code !== "bridge_transport_error") {
          throw new Error(
            `Expected bridge_transport_error during timeout scenario. Received ${envelope.error.code}.`
          );
        }
      }
    );
  } finally {
    await server.stop();
  }
}

function createStaticEditorStateAdapter(): UnityBridgeLocalHttpAdapter {
  return {
    async invoke() {
      return SAMPLE_EDITOR_STATE_OUTPUT;
    }
  };
}

function createDelayedEditorStateAdapter(delayMs: number): UnityBridgeLocalHttpAdapter {
  return {
    async invoke(_request, context) {
      await waitForDelay(delayMs, context?.signal);
      return SAMPLE_EDITOR_STATE_OUTPUT;
    }
  };
}

function createTimeoutBenchAdapter(): UnityBridgeLocalHttpAdapter {
  return {
    async invoke(_request, context) {
      await new Promise<never>((_resolve, reject) => {
        context?.signal?.addEventListener(
          "abort",
          () => {
            reject(
              context.signal?.reason instanceof Error
                ? context.signal.reason
                : new Error("Bridge benchmark invocation aborted.")
            );
          },
          { once: true }
        );
      });
    }
  };
}

async function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Bridge benchmark aborted."));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function postEditorStateRead(
  url: string,
  iteration: number
): Promise<UnityLocalBridgeCallResponse> {
  const request = createUnityLocalBridgeRequest({
    requestId: `bench-unity-bridge-${String(iteration).padStart(5, "0")}`,
    capability: "editor.state.read",
    sessionScope: BENCH_SESSION_SCOPE,
    payload: SAMPLE_EDITOR_STATE_INPUT
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-engine-mcp-session-token": BENCH_SESSION_TOKEN
    },
    body: JSON.stringify(request)
  });

  if (response.status !== 200) {
    throw new Error(`Expected localhost bridge response 200. Received ${response.status}.`);
  }

  return parseUnityLocalBridgeResponse(await response.text());
}

function assertSuccessfulEditorStateResponse(envelope: UnityLocalBridgeCallResponse): void {
  if (!envelope.success) {
    throw new Error(`Expected successful bridge envelope. Received: ${JSON.stringify(envelope)}`);
  }

  if (!isEditorStateLike(envelope.payload)) {
    throw new Error(`Expected editor state payload. Received: ${JSON.stringify(envelope.payload)}`);
  }
}

function isEditorStateLike(
  value: unknown
): value is {
  engine: string;
  workspaceName: string;
} {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "engine" in value &&
    typeof value.engine === "string" &&
    "workspaceName" in value &&
    typeof value.workspaceName === "string"
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
