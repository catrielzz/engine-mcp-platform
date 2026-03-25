# @engine-mcp/core-server

Bootstrap MCP server runtime for the platform.

As of March 19, 2026, the official production recommendation remains the `v1.x` SDK line, which uses `@modelcontextprotocol/sdk`. The future `v2` line and its split packages are tracked as a later migration, not as the bootstrap default.

Current documentation for the prompt/resource surface of this package:

- [Core Server Roadmap](E:/engine-mcp-platform/packages/core-server/roadmap.md)
- [MCP Prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)
- [MCP Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Completion](https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/completion)

Current bootstrap slice:

- resolves adapters from a core-server registry, with Unity preferred-adapter registration built in
- can switch the active adapter at runtime through the registry or by direct replacement
- boots the platform server over `stdio`
- boots the platform server over `Streamable HTTP`
- exposes adapter-declared canonical tools through the low-level `Server` API
- exposes platform-owned parameterized MCP prompts through `prompts/list` and `prompts/get`, filtered by the active adapter's canonical capability surface and augmented by optional adapter-contributed prompt packs
- supports MCP `completion/complete` for prompt arguments, including hierarchy-backed and script-path-backed completions when the active adapter can satisfy the underlying read capabilities
- serves canonical `inputSchema` / `outputSchema` documents from `@engine-mcp/contracts`, without reading contract files directly in the server runtime
- defaults to the preferred Unity adapter, which uses the live plugin when available and falls back to the sandbox bootstrap when not
- can run an optional conformance preflight before transport startup and fail fast when the selected adapter does not meet the required capability slice
- uses stateful HTTP sessions with `MCP-Session-Id`
- binds HTTP to `127.0.0.1` by default, rejects invalid `Origin` / `Host`, and supports MCP/OAuth resource-server discovery through OAuth Protected Resource Metadata plus pluggable access-token validation
- supports SSE mode for `Streamable HTTP`, including standalone `GET`, priming events, and in-memory replay via `Last-Event-ID`
- supports experimental task-augmented `tools/call`, plus `tasks/get` / `tasks/result` / `tasks/list` / `tasks/cancel`, over `stdio` and `Streamable HTTP` when enabled with a task store
- can attach `_meta["io.modelcontextprotocol/model-immediate-response"]` to `CreateTaskResult` for task-augmented `tools/call` when `experimentalTasks.modelImmediateResponse` is configured
- can enforce an optional per-invocation sampling guardrail through `experimentalTasks.samplingPolicy`, including `maxTurns` and `forceToolChoiceNoneOnFinalTurn`
- can bound task-side child requests with `experimentalTasks.childRequestTimeoutMs`, surfacing `client_request_timeout` instead of leaving `sampling/createMessage` / `elicitation/create` waits open indefinitely
- can cap queued task-side side-channel messages through `experimentalTasks.maxQueueSize`, surfacing `task_message_queue_overflow` instead of leaking SDK queue-overflow errors directly
- applies bounded in-memory defaults for experimental tasks when the caller does not provide a custom task store / queue, including a default task TTL plus age-based retention and prune for the default task-message queue
- delivers queued task-side messages through `tasks/result`, including `input_required` flows triggered by adapter-side client requests such as `elicitation/create`, `sampling/createMessage`, and `roots/list`
- upgrades task-side `sampling/createMessage` and `elicitation/create` to child-task client requests when the peer advertises `tasks.requests.*`, while preserving the existing direct-request fallback for clients that do not
- supports URL-mode `elicitation/create`, `notifications/elicitation/complete`, inline `URLElicitationRequiredError` passthrough for `tools/call`, and late completion notifications that let the client retry after an out-of-band URL flow
- caches `roots/list` results within a single tool invocation and invalidates that cache when the client emits `notifications/roots/list_changed`
- emits standard `notifications/tools/list_changed` when the active adapter changes at runtime
- emits standard `notifications/prompts/list_changed` when the active adapter changes the visible prompt registry at runtime
- exposes adapter-registry runtime state as the standard MCP resource `engine-mcp://runtime/adapter-state`, with `resources/read` for pull-based inspection and `notifications/resources/updated` for subscribers when adapter selection or preflight health changes
- supports standard `notifications/message` for server logging and request-scoped `notifications/progress` when clients provide a `progressToken`
- normalizes policy-driven adapter denials into the same public tool error shape used for bridge-side remote errors: `structuredContent.error = { code, message, details }`, with policy reasons such as `target_outside_sandbox` and `rollback_unavailable` surfaced as the public `message`
- uses a bounded in-memory SSE replay store by default, with explicit per-stream event-count eviction and optional max-age eviction
- supports live `notifications/tasks/status` over standalone `GET` SSE and resumable `tasks/result` request streams via `Last-Event-ID`
- treats `notifications/tasks/status` as optional on the client side; requestors should keep polling via `tasks/get` / `tasks/list` for required state changes
- if callers replace the default replay store through `eventStoreFactory`, the runtime treats it as a per-session backend and will call optional `cleanup()` on session close when the custom store exposes that hook

Primary exports:

- `createCoreServer()`
- `createCoreServerAdapterRegistry()`
- `startCoreServerStdio()`
- `startCoreServerStreamableHttp()`
- `createStaticBearerAuthorization()`
- `createInMemoryEventStore()`
- `createInMemoryTaskMessageQueue()`
- `EngineMcpConformancePreflightError`
- `DEFAULT_CORE_SERVER_INFO`
- `DEFAULT_CORE_SERVER_INSTRUCTIONS`

Runtime behavior worth calling out:

- `createCoreServer()`, `startCoreServerStdio()`, and `startCoreServerStreamableHttp()` now return runtimes that expose:
  - `availableAdapterNames`
  - `adapterName`
  - `selectAdapter(name)`
  - `replaceAdapter(adapter)`
  - `notifyToolListChanged()`
  - `notifyPromptListChanged()`
  - `sendLoggingMessage(params, sessionId?)`
- tool adapters now receive optional request context in `invoke()`:
  - `requestId`
  - `sessionId`
  - `progressToken`
  - `cancellationSignal`
  - `isCancellationRequested()`
  - `throwIfCancelled()`
  - `context.sendProgress(...)`
  - `context.sendNotification(...)`
  - `context.sendRequest(...)`
  - `context.createElicitationCompletionNotifier(elicitationId)`
  - `context.sendRequest(...)` now prefers task-augmented `sampling/createMessage` / `elicitation/create` when the client advertises `tasks.requests.sampling.createMessage` or `tasks.requests.elicitation.create`; if not, it falls back to the direct request path
- `startCoreServerStreamableHttp()` now accepts `authorization`, which lets the server act as an MCP/OAuth protected resource:
  - publishes protected-resource metadata at `/.well-known/oauth-protected-resource` and the path-specific variant for the MCP endpoint
  - returns `WWW-Authenticate: Bearer resource_metadata="..."` challenges on `401`
  - returns `error="insufficient_scope"` challenges on `403` when the token is valid but underscoped
  - keeps `authToken` only as a deprecated compatibility shorthand; new work should use `authorization`
- `experimentalTasks.modelImmediateResponse` accepts either:
  - a fixed string
  - a callback receiving `{ capability, adapterId, input, taskId, requestId, sessionId? }`
  - when present, the resolved string is emitted as `_meta["io.modelcontextprotocol/model-immediate-response"]` on the initial `CreateTaskResult`
- `experimentalTasks.samplingPolicy` currently supports:
  - `maxTurns`
  - `forceToolChoiceNoneOnFinalTurn`
  - the policy is tracked per tool invocation, not globally across the whole session
- `experimentalTasks.childRequestTimeoutMs` sets an explicit timeout for task-side client requests associated with a parent task:
  - applies to both direct queued requests and task-augmented child-task requests emitted through `context.sendRequest(...)`
  - timeout failures now normalize to `structuredContent.error.code = "client_request_timeout"` with `{ method, timeoutMs, relatedTaskId }` in `details`
- `experimentalTasks.maxQueueSize` now also produces a canonical overflow failure for task-side messages:
  - when a queued task-side `notifications/*`, `sampling/createMessage`, or `elicitation/create` would exceed the queue cap, the tool result now fails with `structuredContent.error.code = "task_message_queue_overflow"`
  - overflow failures include `{ method, relatedTaskId, queueSize?, maxQueueSize? }` in `details`
- when `experimentalTasks.enabled` uses the built-in in-memory task runtime:
  - `experimentalTasks.defaultTtlMs` now defaults to a bounded retention window instead of leaving tasks immortal unless the caller overrides it
  - `experimentalTasks.taskMessageRetentionMs` and `experimentalTasks.taskMessagePruneIntervalMs` configure age-based retention for the built-in task-message queue
  - passing a custom `taskStore` or `taskMessageQueue` still preserves caller-owned lifecycle/retention behavior
  - if a bounded TTL is requested through the request payload or `experimentalTasks.defaultTtlMs`, a custom `taskStore` must return that bounded lifetime in the created `task.ttl`; returning `null` now fails task creation as a backend contract violation
  - if a custom `taskStore` or `taskMessageQueue` owns timers, sockets, or external handles, exposing an optional `cleanup()` hook lets the core runtime release those resources on shutdown
- if callers replace the default SSE replay store through `eventStoreFactory`:
  - the factory is treated as per-session, matching the current `Streamable HTTP` session lifecycle
  - the runtime only assumes the MCP `EventStore` contract plus optional `cleanup()`
  - if `cleanup()` is exposed, it is called on session close and runtime shutdown

Known gap:

- experimental tasks are now covered over `stdio` and `Streamable HTTP`, including cooperative cancellation hooks for adapter work and optional `io.modelcontextprotocol/model-immediate-response` hints on task creation
- task-augmented client-side `sampling/createMessage` / `elicitation/create` is now covered over `stdio` and `Streamable HTTP`, including fallback when the client lacks `tasks.requests.*`, cancelled child-task propagation, direct no-parent-request transport routing, URL-mode completion notifications, task-associated URL-mode completion notifications, multi-turn sampling `tool_use` / `tool_result` loops, `elicitation` `decline` / `cancel` branches, and a first sampling follow-up policy guardrail (`maxTurns` + optional `toolChoice: { mode: "none" }` on the final turn)
- task-side `sampling/createMessage` / `elicitation/create` now also have explicit child-request timeout coverage over `stdio` and `Streamable HTTP`, with canonical `client_request_timeout` failures instead of indefinite waits when the client never resolves the pending request
- task-side `sampling/createMessage` / `elicitation/create` now also have explicit queue-overflow coverage over `stdio` and `Streamable HTTP`, with canonical `task_message_queue_overflow` failures when the runtime-side task message queue is saturated
- `roots/list` queued task messages and `roots/list_changed` invalidation are now covered, and the mixed ordering `notification -> roots/list -> sampling/createMessage -> final result` is now fixed in TDD for both `stdio` and `Streamable HTTP`, including replay on the correct `tasks/result` stream after disconnect
- the mixed task-side interaction chain `notification -> URL-mode elicitation -> completion notification -> roots/list -> pending sampling -> parent tasks/cancel` is now covered over both `stdio` and `Streamable HTTP`, including parent-task cancellation propagation into the pending client request and the current `tasks/result` cancellation outcome over HTTP
- richer follow-up policies beyond the current sampling iteration guardrail still remain outside the current test surface
- the registry/preflight slice now covers adapter resolution, startup gating, tool-list changes, logging, and an observable adapter-state resource, but it still does not publish richer lifecycle surfaces beyond the current adapter-state snapshot
- the server now exposes the MCP/OAuth protected-resource side correctly, but it still relies on a caller-supplied token validator; hosting a production authorization server remains external to this package
