import type { IncomingMessage } from "node:http";

import {
  CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH,
  createStaticBearerAuthorization,
  type EngineMcpAccessTokenValidationContext,
  type EngineMcpAccessTokenValidationResult,
  type EngineMcpAuthorizationFailure,
  type EngineMcpHttpAuthorizationOptions,
  type EngineMcpToolError,
  type ResolvedStreamableHttpAuthorization
} from "../shared.js";

export function normalizeHttpPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function matchesPath(requestUrl: string | undefined, expectedPath: string): boolean {
  const actualPath = requestUrl?.split("?")[0] ?? "/";

  return actualPath === expectedPath;
}

export function matchesProtectedResourceMetadataPath(
  requestUrl: string | undefined,
  metadataPaths: {
    root: string;
    pathSpecific: string;
  }
): boolean {
  return (
    matchesPath(requestUrl, metadataPaths.root) || matchesPath(requestUrl, metadataPaths.pathSpecific)
  );
}

export function resolveStreamableHttpAuthorization(options: {
  authorization?: EngineMcpHttpAuthorizationOptions;
  authToken?: string;
  endpointUrl: string;
  path: string;
}): ResolvedStreamableHttpAuthorization | undefined {
  const resolvedAuthorization =
    options.authorization ??
    (options.authToken
      ? createStaticBearerAuthorization({
          token: options.authToken,
          authorizationServers: [options.endpointUrl],
          requiredScopes: ["mcp"]
        })
      : undefined);

  if (!resolvedAuthorization) {
    return undefined;
  }

  if (resolvedAuthorization.authorizationServers.length === 0) {
    throw new Error("HTTP authorization requires at least one authorization server URL.");
  }

  const resource = normalizeCanonicalResourceUri(
    resolvedAuthorization.resource ?? options.endpointUrl
  );
  const authorizationServers = Object.freeze(
    resolvedAuthorization.authorizationServers.map((serverUrl) =>
      normalizeCanonicalResourceUri(serverUrl)
    )
  );
  const metadataPaths = getProtectedResourceMetadataPaths(options.path);
  const metadataUrls = {
    root: new URL(metadataPaths.root, options.endpointUrl).toString(),
    pathSpecific: new URL(metadataPaths.pathSpecific, options.endpointUrl).toString()
  };
  const requiredScopes = Object.freeze([...(resolvedAuthorization.requiredScopes ?? [])]);

  return {
    metadata: {
      resource,
      authorization_servers: authorizationServers,
      ...(resolvedAuthorization.scopesSupported
        ? {
            scopes_supported: Object.freeze([...resolvedAuthorization.scopesSupported])
          }
        : {})
    },
    metadataPaths,
    metadataUrls,
    requiredScopes,
    async validateAccessToken(
      context: EngineMcpAccessTokenValidationContext
    ): Promise<EngineMcpAccessTokenValidationResult> {
      return resolvedAuthorization.validateAccessToken(context);
    }
  };
}

export function getDefaultAllowedHostnames(host: string): string[] {
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    return ["127.0.0.1", "localhost", "[::1]"];
  }

  return [host];
}

export function validateHostHeader(
  request: IncomingMessage,
  allowedHosts: readonly string[]
): EngineMcpToolError | undefined {
  const hostHeader = readHeaderValue(request.headers.host);

  if (!hostHeader) {
    return {
      code: "invalid_host",
      message: "Missing Host header"
    };
  }

  let hostname: string;

  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return {
      code: "invalid_host",
      message: `Invalid Host header: ${hostHeader}`
    };
  }

  if (!allowedHosts.includes(hostname)) {
    return {
      code: "invalid_host",
      message: `Invalid Host header: ${hostHeader}`
    };
  }

  return undefined;
}

export function validateOriginHeader(
  request: IncomingMessage,
  allowedOriginHosts: readonly string[]
): EngineMcpToolError | undefined {
  const originHeader = readHeaderValue(request.headers.origin);

  if (!originHeader) {
    return undefined;
  }

  let hostname: string;

  try {
    hostname = new URL(originHeader).hostname;
  } catch {
    return {
      code: "invalid_origin",
      message: `Invalid Origin header: ${originHeader}`
    };
  }

  if (!allowedOriginHosts.includes(hostname)) {
    return {
      code: "invalid_origin",
      message: `Invalid Origin header: ${originHeader}`
    };
  }

  return undefined;
}

export async function validateAuthorization(
  request: IncomingMessage,
  authorization: ResolvedStreamableHttpAuthorization | undefined
): Promise<EngineMcpAuthorizationFailure | undefined> {
  if (!authorization) {
    return undefined;
  }

  const bearerToken = readBearerToken(request);
  const validationResult = await authorization.validateAccessToken({
    token: bearerToken,
    request,
    resource: authorization.metadata.resource,
    requiredScopes: authorization.requiredScopes
  });

  if (validationResult.ok) {
    return undefined;
  }

  const requiredScopes = validationResult.requiredScopes ?? authorization.requiredScopes;

  if (validationResult.status === 403) {
    return {
      httpStatus: 403,
      error: {
        code: "insufficient_scope",
        message: validationResult.errorDescription ?? "Insufficient scope",
        ...(requiredScopes.length > 0 ? { details: { requiredScopes } } : {})
      },
      wwwAuthenticate: buildWwwAuthenticateHeader({
        metadataUrl: authorization.metadataUrls.pathSpecific,
        error: "insufficient_scope",
        ...(requiredScopes.length > 0 ? { scope: requiredScopes } : {}),
        ...(validationResult.errorDescription
          ? { errorDescription: validationResult.errorDescription }
          : {})
      })
    };
  }

  return {
    httpStatus: 401,
    error: {
      code: validationResult.error ?? "unauthorized",
      message: validationResult.errorDescription ?? "Unauthorized",
      ...(requiredScopes.length > 0 ? { details: { requiredScopes } } : {})
    },
    wwwAuthenticate: buildWwwAuthenticateHeader({
      metadataUrl: authorization.metadataUrls.pathSpecific,
      ...(validationResult.error ? { error: validationResult.error } : {}),
      ...(requiredScopes.length > 0 ? { scope: requiredScopes } : {}),
      ...(validationResult.errorDescription
        ? { errorDescription: validationResult.errorDescription }
        : {})
    })
  };
}

function getProtectedResourceMetadataPaths(path: string): {
  root: string;
  pathSpecific: string;
} {
  const normalizedPath = normalizeHttpPath(path);
  const trimmedPath = normalizedPath.replace(/^\/+/, "");

  return {
    root: CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH,
    pathSpecific: trimmedPath.length > 0
      ? `${CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH}/${trimmedPath}`
      : CORE_SERVER_PROTECTED_RESOURCE_METADATA_ROOT_PATH
  };
}

function normalizeCanonicalResourceUri(uri: string): string {
  let parsedUri: URL;

  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error(`Invalid canonical resource URI: ${uri}`);
  }

  if (!["http:", "https:"].includes(parsedUri.protocol)) {
    throw new Error(`Canonical resource URI must use http or https: ${uri}`);
  }

  if (parsedUri.hash.length > 0) {
    throw new Error(`Canonical resource URI must not include a fragment: ${uri}`);
  }

  return parsedUri.toString();
}

function readBearerToken(request: IncomingMessage): string | undefined {
  const authorizationHeader = readHeaderValue(request.headers.authorization);

  if (!authorizationHeader) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  return match?.[1];
}

function buildWwwAuthenticateHeader(options: {
  metadataUrl: string;
  error?: "invalid_request" | "invalid_token" | "insufficient_scope";
  errorDescription?: string;
  scope?: readonly string[];
}): string {
  const parts = [`resource_metadata="${options.metadataUrl}"`];

  if (options.error) {
    parts.push(`error="${options.error}"`);
  }

  if (options.errorDescription) {
    parts.push(`error_description="${options.errorDescription.replace(/"/g, '\\"')}"`);
  }

  if (options.scope && options.scope.length > 0) {
    parts.push(`scope="${options.scope.join(" ")}"`);
  }

  return `Bearer ${parts.join(", ")}`;
}

function readHeaderValue(headerValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}
