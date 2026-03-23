#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal sealed class UnityBridgeCallException : InvalidOperationException
    {
        internal UnityBridgeCallException(string code, string errorMessage, JToken details = null)
            : base($"{code}: {errorMessage}")
        {
            Code = code;
            ErrorMessage = errorMessage;
            Details = details;
        }

        internal string Code { get; }

        internal string ErrorMessage { get; }

        internal JToken Details { get; }
    }
}
#endif
