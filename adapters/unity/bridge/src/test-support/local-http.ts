import { request as createNodeHttpRequest } from "node:http";

import {
  UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER,
  createUnityBridgeLocalHttpServer,
  createUnityBridgeSessionToken,
  createUnityLocalBridgeRequest,
  parseUnityLocalBridgeResponse,
  type UnityBridgeLocalHttpAdapter,
  type UnityBridgeLocalHttpServer,
  type UnityBridgeLocalHttpServerAddress,
  type UnityLocalBridgeCallRequest,
  type UnityLocalBridgeCallResponse
} from "../index.js";

export interface UnityBridgeLocalHttpTestSession {
  address: UnityBridgeLocalHttpServerAddress;
  sessionToken: string;
  server: UnityBridgeLocalHttpServer;
  postAbortable(options: {
    request: UnityLocalBridgeCallRequest;
    sessionToken?: string | null;
  }): {
    abort(): void;
    closed: Promise<void>;
    response: Promise<{
      statusCode: number | undefined;
      body: string;
    }>;
  };
  postRaw(options: {
    request: UnityLocalBridgeCallRequest;
    sessionToken?: string | null;
  }): Promise<Response>;
  postEnvelope(options: {
    request: UnityLocalBridgeCallRequest;
    sessionToken?: string | null;
  }): Promise<{
    response: Response;
    envelope: UnityLocalBridgeCallResponse;
  }>;
}

export interface UnityBridgeLocalHttpHarness {
  startServer(options: {
    adapter: UnityBridgeLocalHttpAdapter;
    sessionToken?: string;
    maxConcurrentRequests?: number;
    maxRequestsPerSocket?: number;
    invocationTimeoutMs?: number;
    sessionIdleTtlMs?: number;
    sessionSweepIntervalMs?: number;
  }): Promise<UnityBridgeLocalHttpTestSession>;
  cleanup(): Promise<void>;
}

export function createUnityBridgeLocalHttpHarness(): UnityBridgeLocalHttpHarness {
  const servers: UnityBridgeLocalHttpServer[] = [];

  return {
    async startServer(options) {
      const sessionToken = options.sessionToken ?? createUnityBridgeSessionToken();
      const server = createUnityBridgeLocalHttpServer({
        adapter: options.adapter,
        port: 0,
        sessionToken,
        maxConcurrentRequests: options.maxConcurrentRequests,
        maxRequestsPerSocket: options.maxRequestsPerSocket,
        invocationTimeoutMs: options.invocationTimeoutMs,
        sessionIdleTtlMs: options.sessionIdleTtlMs,
        sessionSweepIntervalMs: options.sessionSweepIntervalMs
      });
      servers.push(server);

      const address = await server.start();

      return {
        address,
        sessionToken,
        server,
        postAbortable(requestOptions) {
          const presentedToken =
            requestOptions.sessionToken === undefined
              ? sessionToken
              : requestOptions.sessionToken;
          const request = createNodeHttpRequest(address.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(presentedToken === null
                ? {}
                : {
                    [UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]: presentedToken
                  })
            }
          });
          let resolveClosed!: () => void;
          const closed = new Promise<void>((resolve) => {
            resolveClosed = resolve;
          });
          const response = new Promise<{
            statusCode: number | undefined;
            body: string;
          }>((resolve, reject) => {
            request.on("response", (serverResponse) => {
              const chunks: string[] = [];
              serverResponse.setEncoding("utf8");
              serverResponse.on("data", (chunk) => {
                chunks.push(chunk);
              });
              serverResponse.on("end", () => {
                resolve({
                  statusCode: serverResponse.statusCode,
                  body: chunks.join("")
                });
              });
              serverResponse.on("close", () => {
                resolveClosed();
              });
              serverResponse.on("error", (error) => {
                resolveClosed();
                reject(error);
              });
            });
            request.on("error", (error) => {
              resolveClosed();
              reject(error);
            });
            request.on("close", () => {
              resolveClosed();
            });
          });

          request.end(JSON.stringify(requestOptions.request));

          return {
            abort() {
              request.destroy();
            },
            closed,
            response
          };
        },
        async postRaw(requestOptions) {
          const presentedToken =
            requestOptions.sessionToken === undefined
              ? sessionToken
              : requestOptions.sessionToken;

          return fetch(address.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(presentedToken === null
                ? {}
                : {
                    [UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]: presentedToken
                  })
            },
            body: JSON.stringify(requestOptions.request)
          });
        },
        async postEnvelope(requestOptions) {
          const presentedToken =
            requestOptions.sessionToken === undefined
              ? sessionToken
              : requestOptions.sessionToken;
          const response = await fetch(address.url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(presentedToken === null
                ? {}
                : {
                    [UNITY_LOCAL_HTTP_SESSION_TOKEN_HEADER]: presentedToken
                  })
            },
            body: JSON.stringify(requestOptions.request)
          });

          return {
            response,
            envelope: parseUnityLocalBridgeResponse(await response.text())
          };
        }
      };
    },
    async cleanup() {
      while (servers.length > 0) {
        await servers.pop()!.stop();
      }
    }
  };
}

export function createLocalHttpTestRequest(
  request: Parameters<typeof createUnityLocalBridgeRequest>[0]
): UnityLocalBridgeCallRequest {
  return createUnityLocalBridgeRequest(request);
}
