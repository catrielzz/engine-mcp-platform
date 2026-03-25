#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace EngineMcp.Unity.Plugin.Editor
{
    internal static class UnityEditorTestCatalog
    {
        private static readonly object Sync = new();
        private static TestRunnerApi _testRunnerApi;
        private static Func<Task<string[]>> _providerOverride;

        internal static async Task<string[]> ListTestNamesAsync()
        {
            Func<Task<string[]>> providerOverride;

            lock (Sync)
            {
                providerOverride = _providerOverride;
            }

            if (providerOverride != null)
            {
                var providedValues = await providerOverride().ConfigureAwait(false);
                return Normalize(providedValues);
            }

            var editModeTests = await RetrieveTestListAsync(TestMode.EditMode).ConfigureAwait(false);
            var playModeTests = await RetrieveTestListAsync(TestMode.PlayMode).ConfigureAwait(false);

            return Normalize(editModeTests.Concat(playModeTests));
        }

        internal static void SetProviderForTests(Func<Task<string[]>> provider)
        {
            lock (Sync)
            {
                _providerOverride = provider ?? throw new ArgumentNullException(nameof(provider));
            }
        }

        internal static void ResetForTests()
        {
            lock (Sync)
            {
                _providerOverride = null;
                if (_testRunnerApi != null)
                {
                    ScriptableObject.DestroyImmediate(_testRunnerApi);
                    _testRunnerApi = null;
                }
            }
        }

        private static async Task<IEnumerable<string>> RetrieveTestListAsync(TestMode testMode)
        {
            var completion = new TaskCompletionSource<ITestAdaptor>(
                TaskCreationOptions.RunContinuationsAsynchronously);

            GetTestRunnerApi().RetrieveTestList(
                testMode,
                (testRoot) => completion.TrySetResult(testRoot));

            var completedTask = await Task.WhenAny(completion.Task, Task.Delay(TimeSpan.FromSeconds(5)));

            if (completedTask != completion.Task)
            {
                throw new InvalidOperationException(
                    $"bridge_transport_error: timed out retrieving Unity {testMode} test catalog.");
            }

            var testRoot = await completion.Task;
            return FlattenLeafTestNames(testRoot);
        }

        private static TestRunnerApi GetTestRunnerApi()
        {
            lock (Sync)
            {
                return _testRunnerApi ??= ScriptableObject.CreateInstance<TestRunnerApi>();
            }
        }

        private static IEnumerable<string> FlattenLeafTestNames(ITestAdaptor test)
        {
            if (test == null)
            {
                yield break;
            }

            if (!test.IsSuite)
            {
                if (!string.IsNullOrWhiteSpace(test.FullName))
                {
                    yield return test.FullName;
                }

                yield break;
            }

            if (!test.HasChildren)
            {
                yield break;
            }

            foreach (var child in test.Children)
            {
                foreach (var name in FlattenLeafTestNames(child))
                {
                    yield return name;
                }
            }
        }

        private static string[] Normalize(IEnumerable<string> values)
        {
            return values
                .Where((value) => !string.IsNullOrWhiteSpace(value))
                .Select((value) => value.Trim())
                .Distinct(StringComparer.Ordinal)
                .OrderBy((value) => value, StringComparer.Ordinal)
                .ToArray();
        }
    }
}
#endif
