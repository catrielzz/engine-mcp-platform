# Journal Resources

## Purpose

This slice exposes the durable core hardening state through standard MCP `resources/list` and `resources/read`.

The goal is not to add a query API yet. The goal is to make the current persisted journal and snapshot metadata inspectable by clients, tests, and operators without reaching into local files directly.

## Functional Specification

### User-visible outcome

After this slice, the core server should publish two additional runtime resources:

- a journal index resource
- a snapshot metadata index resource

These resources are read-only and intended for inspection, debugging, auditability, and future Codex context selection.

### In scope

- standard MCP `resources/list`
- standard MCP `resources/read`
- custom runtime URIs for durable core state
- JSON payloads for journal and snapshot metadata indexes
- resource-not-found behavior aligned with the MCP resources spec

### Out of scope

- filtering, search, or pagination for journal entries
- resource templates
- subscriptions specific to journal changes
- list-changed notifications for persistence state
- write APIs for journal or snapshots

### Functional rules

1. The core server must continue to expose the adapter-state resource.
2. The core server must additionally expose:
   - a journal index resource
   - a snapshot metadata index resource
3. `resources/read` for these URIs must return JSON text content.
4. Unknown resource URIs must return MCP resource-not-found semantics instead of generic invalid-params behavior.
5. The resource payloads must be stable enough for automated inspection, but they do not yet need pagination or query arguments.

## Technical Specification

### Affected modules

- [packages/core-server](E:/engine-mcp-platform/packages/core-server)
- [docs/platform/security/core-hardening](E:/engine-mcp-platform/docs/platform/security/core-hardening)

### Proposed runtime resources

- `engine-mcp://runtime/journal-index`
- `engine-mcp://runtime/snapshot-metadata-index`

Both resources should use `application/json`.

### Proposed payload shape

The first cut should prefer simple index payloads:

- journal index:
  - `entries`
- snapshot metadata index:
  - `records`

This keeps the resource surface stable while avoiding a premature query API.

### Design constraints

- keep resource ownership in `core-server`, not in the adapter
- keep resource routing decomposed from `protocol-server.ts`
- do not widen the persistence contract just to serve resources
- preserve in-memory behavior when persistence is disabled

## Acceptance Criteria

This slice is done when:

1. `resources/list` includes the journal and snapshot metadata runtime resources.
2. `resources/read` returns JSON content for both resources.
3. Unknown resource reads return MCP resource-not-found behavior.
4. `stdio` and `Streamable HTTP` coverage prove the resource payloads from real journal/snapshot state.

## Sources

- [MCP Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
