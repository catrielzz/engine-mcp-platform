using Newtonsoft.Json;

namespace EngineMcp.Unity.Plugin.Protocol
{
    internal static class LocalBridgeJson
    {
        internal static readonly JsonSerializerSettings SerializerSettings = new()
        {
            NullValueHandling = NullValueHandling.Ignore
        };

        internal static string Serialize(object value)
        {
            return JsonConvert.SerializeObject(value, SerializerSettings);
        }

        internal static T Deserialize<T>(string json)
        {
            return JsonConvert.DeserializeObject<T>(json, SerializerSettings);
        }
    }
}
