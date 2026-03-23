using System.Threading;
using System.Threading.Tasks;

namespace EngineMcp.Unity.Plugin.Client
{
    public interface IUnityBridgeTransport
    {
        Task<string> SendAsync(string requestJson, CancellationToken cancellationToken = default);
    }
}
