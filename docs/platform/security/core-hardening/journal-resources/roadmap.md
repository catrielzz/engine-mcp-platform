# Journal Resources Roadmap

## Scope

This roadmap covers the bounded slice that turns durable journal and snapshot metadata into standard MCP runtime resources.

## Deliverables

- resource specification for journal and snapshot metadata indexes
- runtime resource URIs and MIME types in `core-server`
- read-only resource routing over `stdio` and `Streamable HTTP`
- tests covering:
  - resource listing
  - resource reads
  - resource-not-found semantics

## Phase 1 - Documentation

Deliverables:

- [README.md](E:/engine-mcp-platform/docs/platform/security/core-hardening/journal-resources/README.md)
- linkage from [core hardening README](E:/engine-mcp-platform/docs/platform/security/core-hardening/README.md)

Exit criteria:

- slice boundaries are explicit
- out-of-scope items are documented before code lands

## Phase 2 - Runtime Wiring

Deliverables:

- a small runtime resource module in `packages/core-server`
- journal index resource
- snapshot metadata index resource
- MCP-compliant resource-not-found handling

Exit criteria:

- `resources/list` and `resources/read` work through the server runtime
- the adapter resource path stays separated from core-owned persistence resources

## Phase 3 - Validation

Deliverables:

- dedicated stdio coverage
- dedicated Streamable HTTP coverage

Exit criteria:

- journal and snapshot metadata can be inspected through MCP without reading persistence files directly

## Non-Goals

- journal query language
- pagination
- subscriptions/list-changed expansion
- live adapter conformance work
