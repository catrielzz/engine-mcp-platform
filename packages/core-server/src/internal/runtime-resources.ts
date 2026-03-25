import type {
  EngineMcpAdapterResourceContent,
  EngineMcpAdapterResourceDefinition,
  EngineMcpAdapterStateResource,
  EngineMcpJournalService,
  EngineMcpSnapshotMetadataStore
} from "../shared.js";
import {
  CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
  CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
  CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
  CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI
} from "../shared.js";

const CORE_RUNTIME_RESOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
    name: "adapter-state",
    title: "Adapter State",
    description:
      "Current adapter selection, health, and conformance snapshot for the Engine MCP core server.",
    mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE
  }),
  Object.freeze({
    uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
    name: "journal-index",
    title: "Journal Index",
    description:
      "Append-only core journal entries currently available to the Engine MCP core server runtime.",
    mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE
  }),
  Object.freeze({
    uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI,
    name: "snapshot-metadata-index",
    title: "Snapshot Metadata Index",
    description:
      "Snapshot metadata records currently retained by the Engine MCP core server runtime.",
    mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE
  })
] satisfies readonly EngineMcpAdapterResourceDefinition[]);

export function listCoreRuntimeResources(): readonly EngineMcpAdapterResourceDefinition[] {
  return CORE_RUNTIME_RESOURCE_DEFINITIONS;
}

export async function readCoreRuntimeResource(options: {
  uri: string;
  getAdapterStateResource: () => EngineMcpAdapterStateResource;
  journalService: EngineMcpJournalService;
  snapshotMetadataStore: EngineMcpSnapshotMetadataStore;
}): Promise<EngineMcpAdapterResourceContent | undefined> {
  switch (options.uri) {
    case CORE_SERVER_ADAPTER_STATE_RESOURCE_URI:
      return {
        uri: CORE_SERVER_ADAPTER_STATE_RESOURCE_URI,
        mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
        text: JSON.stringify(options.getAdapterStateResource(), null, 2)
      };
    case CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI:
      return {
        uri: CORE_SERVER_JOURNAL_INDEX_RESOURCE_URI,
        mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
        text: JSON.stringify(
          {
            entries: await options.journalService.list()
          },
          null,
          2
        )
      };
    case CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI:
      return {
        uri: CORE_SERVER_SNAPSHOT_METADATA_INDEX_RESOURCE_URI,
        mimeType: CORE_SERVER_ADAPTER_STATE_RESOURCE_MIME_TYPE,
        text: JSON.stringify(
          {
            records: await options.snapshotMetadataStore.list()
          },
          null,
          2
        )
      };
    default:
      return undefined;
  }
}
