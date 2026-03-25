#if UNITY_EDITOR
using System;
using System.Threading.Tasks;
using EngineMcp.Unity.Plugin.Protocol;
using Newtonsoft.Json;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal static class UnityEditorBridgeResourceReader
    {
        internal static async Task<BridgeResourceContent> ReadAsync(string uri)
        {
            if (string.IsNullOrWhiteSpace(uri))
            {
                throw new ArgumentException("resource.read requires a non-empty uri.", nameof(uri));
            }

            return uri switch
            {
                LocalBridgeProtocol.SnapshotIndexResourceUri => CreateJsonResource(
                    uri,
                    new SnapshotIndexResourcePayload
                    {
                        AdapterId = "unity-plugin-local-http",
                        Snapshots = UnityEditorDeleteSnapshotStore.ListSnapshotIds()
                    }),
                LocalBridgeProtocol.TestCatalogResourceUri => CreateJsonResource(
                    uri,
                    new TestCatalogResourcePayload
                    {
                        AdapterId = "unity-plugin-local-http",
                        Tests = await UnityEditorTestCatalog.ListTestNamesAsync()
                    }),
                _ => throw new InvalidOperationException("target_not_found: resource could not be resolved.")
            };
        }

        private static BridgeResourceContent CreateJsonResource(string uri, object payload)
        {
            return new BridgeResourceContent
            {
                Uri = uri,
                MimeType = LocalBridgeProtocol.DiscoveryResourceMimeType,
                Text = JsonConvert.SerializeObject(payload, Formatting.Indented)
            };
        }

        [Serializable]
        private sealed class SnapshotIndexResourcePayload
        {
            [JsonProperty("adapterId")]
            public string AdapterId { get; set; } = string.Empty;

            [JsonProperty("snapshots")]
            public string[] Snapshots { get; set; } = Array.Empty<string>();
        }

        [Serializable]
        private sealed class TestCatalogResourcePayload
        {
            [JsonProperty("adapterId")]
            public string AdapterId { get; set; } = string.Empty;

            [JsonProperty("tests")]
            public string[] Tests { get; set; } = Array.Empty<string>();
        }
    }
}
#endif
