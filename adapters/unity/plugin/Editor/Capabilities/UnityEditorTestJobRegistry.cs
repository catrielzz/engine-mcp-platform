#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace EngineMcp.Unity.Plugin.Editor
{
    public interface IUnityEditorTestRunObserver
    {
        void OnRunStarted(int totalTests);

        void OnTestFinished(UnityEditorTestCaseRecord result);

        void OnRunFinished(UnityEditorTestRunCompletion completion);
    }

    public interface IUnityEditorTestRunner
    {
        string Execute(UnityEditorTestRunRequest request, IUnityEditorTestRunObserver observer);
    }

    public sealed class UnityEditorTestRunRequest
    {
        public string NamePattern { get; set; }

        public TestMode TestMode { get; set; }
    }

    public sealed class UnityEditorTestCaseRecord
    {
        public string Name { get; set; } = string.Empty;

        public string Status { get; set; } = "passed";

        public double DurationMs { get; set; }

        public string Message { get; set; }
    }

    public sealed class UnityEditorTestRunCompletion
    {
        public string Status { get; set; } = "completed";

        public int Passed { get; set; }

        public int Failed { get; set; }

        public int Skipped { get; set; }
    }

    public static class UnityEditorTestJobRegistry
    {
        private static readonly object Sync = new();
        private static readonly Dictionary<string, TestJobRecord> Jobs = new(StringComparer.Ordinal);

        private static IUnityEditorTestRunner _runner;
        private static IUnityEditorTestRunner _runnerOverride;
        private static TestJobRecord _activeJob;

        public static TestRunOutput Start(TestRunInput input)
        {
            if (input == null)
            {
                throw new ArgumentNullException(nameof(input));
            }

            lock (Sync)
            {
                if (_activeJob != null && !_activeJob.IsTerminal)
                {
                    throw new InvalidOperationException("validation_error: another Unity test job is already running.");
                }

                if (input.WaitForCompletion.GetValueOrDefault())
                {
                    throw new InvalidOperationException(
                        "validation_error: test.run waitForCompletion is not supported by the Unity adapter yet.");
                }

                var acceptedFilter = NormalizeFilter(input.Filter);
                var testMode = MapExecutionTarget(input.ExecutionTarget);
                var job = new TestJobRecord
                {
                    Status = "queued",
                    AcceptedFilter = acceptedFilter
                };

                _activeJob = job;

                try
                {
                    var jobId = GetRunner().Execute(
                        new UnityEditorTestRunRequest
                        {
                            NamePattern = acceptedFilter?.NamePattern,
                            TestMode = testMode
                        },
                        new JobObserver(job));

                    if (string.IsNullOrWhiteSpace(jobId))
                    {
                        throw new InvalidOperationException("bridge_transport_error: Unity test runner returned an empty job identifier.");
                    }

                    job.JobId = jobId;
                    Jobs[jobId] = job;

                    return job.ToRunOutput();
                }
                catch
                {
                    _activeJob = null;
                    throw;
                }
            }
        }

        public static TestJobReadOutput Read(TestJobReadInput input)
        {
            if (input == null)
            {
                throw new ArgumentNullException(nameof(input));
            }

            if (string.IsNullOrWhiteSpace(input.JobId))
            {
                throw new ArgumentException("test.job.read requires a non-empty jobId.", nameof(input));
            }

            lock (Sync)
            {
                if (!Jobs.TryGetValue(input.JobId, out var job))
                {
                    throw new InvalidOperationException("target_not_found: test job could not be resolved.");
                }

                return job.ToReadOutput(input.MaxResults);
            }
        }

        public static void SetRunnerForTests(IUnityEditorTestRunner runner)
        {
            lock (Sync)
            {
                _runnerOverride = runner ?? throw new ArgumentNullException(nameof(runner));
                ResetState();
            }
        }

        public static void ResetForTests()
        {
            lock (Sync)
            {
                _runnerOverride = null;
                ResetState();
            }
        }

        private static void ResetState()
        {
            Jobs.Clear();
            _activeJob = null;
            _runner = null;
        }

        private static IUnityEditorTestRunner GetRunner()
        {
            if (_runnerOverride != null)
            {
                return _runnerOverride;
            }

            return _runner ??= new UnityEditorTestRunnerApiAdapter();
        }

        private static TestFilterInput NormalizeFilter(TestFilterInput filter)
        {
            if (filter == null)
            {
                return null;
            }

            if (filter.Paths != null && filter.Paths.Length > 0)
            {
                throw new InvalidOperationException(
                    "validation_error: Unity test.run does not yet support filter.paths.");
            }

            if (filter.Tags != null && filter.Tags.Length > 0)
            {
                throw new InvalidOperationException(
                    "validation_error: Unity test.run does not yet support filter.tags.");
            }

            return string.IsNullOrWhiteSpace(filter.NamePattern)
                ? null
                : new TestFilterInput
                {
                    NamePattern = filter.NamePattern.Trim()
                };
        }

        private static TestMode MapExecutionTarget(string executionTarget)
        {
            return string.IsNullOrWhiteSpace(executionTarget) || string.Equals(executionTarget, "editor", StringComparison.Ordinal)
                ? TestMode.EditMode
                : string.Equals(executionTarget, "runtime", StringComparison.Ordinal)
                    ? TestMode.PlayMode
                    : throw new InvalidOperationException(
                        $"validation_error: Unity test.run does not support executionTarget '{executionTarget}'.");
        }

        private sealed class JobObserver : IUnityEditorTestRunObserver
        {
            private readonly TestJobRecord _job;

            public JobObserver(TestJobRecord job)
            {
                _job = job;
            }

            public void OnRunStarted(int totalTests)
            {
                lock (Sync)
                {
                    _job.Status = "running";
                    _job.TotalTests = Math.Max(totalTests, 0);
                }
            }

            public void OnTestFinished(UnityEditorTestCaseRecord result)
            {
                if (result == null)
                {
                    return;
                }

                lock (Sync)
                {
                    _job.Results.Add(result);

                    switch (result.Status)
                    {
                        case "passed":
                            _job.Passed += 1;
                            break;
                        case "failed":
                            _job.Failed += 1;
                            break;
                        case "skipped":
                            _job.Skipped += 1;
                            break;
                    }
                }
            }

            public void OnRunFinished(UnityEditorTestRunCompletion completion)
            {
                if (completion == null)
                {
                    return;
                }

                lock (Sync)
                {
                    _job.Status = completion.Status;
                    _job.Passed = completion.Passed;
                    _job.Failed = completion.Failed;
                    _job.Skipped = completion.Skipped;
                    _job.TotalTests = Math.Max(_job.TotalTests, completion.Passed + completion.Failed + completion.Skipped);
                    _activeJob = null;
                }
            }
        }

        private sealed class TestJobRecord
        {
            public string JobId { get; set; } = string.Empty;

            public string Status { get; set; } = "queued";

            public TestFilterInput AcceptedFilter { get; set; }

            public int TotalTests { get; set; }

            public int Passed { get; set; }

            public int Failed { get; set; }

            public int Skipped { get; set; }

            public List<UnityEditorTestCaseRecord> Results { get; } = new();

            public bool IsTerminal =>
                string.Equals(Status, "completed", StringComparison.Ordinal)
                || string.Equals(Status, "failed", StringComparison.Ordinal)
                || string.Equals(Status, "canceled", StringComparison.Ordinal);

            public TestRunOutput ToRunOutput()
            {
                return new TestRunOutput
                {
                    JobId = JobId,
                    Status = Status,
                    AcceptedFilter = AcceptedFilter
                };
            }

            public TestJobReadOutput ToReadOutput(int? maxResults)
            {
                var results = maxResults.HasValue
                    ? Results.Take(maxResults.Value).Select(ToOutput).ToArray()
                    : Results.Select(ToOutput).ToArray();

                return new TestJobReadOutput
                {
                    JobId = JobId,
                    Status = Status,
                    Progress = CalculateProgress(),
                    Summary = new TestSummaryOutput
                    {
                        Passed = Passed,
                        Failed = Failed,
                        Skipped = Skipped
                    },
                    Results = results
                };
            }

            private double CalculateProgress()
            {
                if (IsTerminal)
                {
                    return 1d;
                }

                if (TotalTests <= 0)
                {
                    return 0d;
                }

                return Math.Min(1d, Results.Count / (double)TotalTests);
            }

            private static TestCaseResultOutput ToOutput(UnityEditorTestCaseRecord record)
            {
                return new TestCaseResultOutput
                {
                    Name = record.Name,
                    Status = record.Status,
                    DurationMs = record.DurationMs,
                    Message = record.Message
                };
            }
        }

        private sealed class UnityEditorTestRunnerApiAdapter : IUnityEditorTestRunner
        {
            private readonly TestRunnerApi _testRunnerApi;
            private readonly CallbackForwarder _callbacks;
            private bool _callbacksRegistered;

            public UnityEditorTestRunnerApiAdapter()
            {
                _testRunnerApi = ScriptableObject.CreateInstance<TestRunnerApi>();
                _callbacks = new CallbackForwarder();
            }

            public string Execute(UnityEditorTestRunRequest request, IUnityEditorTestRunObserver observer)
            {
                if (request == null)
                {
                    throw new ArgumentNullException(nameof(request));
                }

                if (observer == null)
                {
                    throw new ArgumentNullException(nameof(observer));
                }

                if (!_callbacksRegistered)
                {
                    _testRunnerApi.RegisterCallbacks(_callbacks);
                    _callbacksRegistered = true;
                }

                _callbacks.Assign(observer);

                try
                {
                    var filter = new Filter
                    {
                        testMode = request.TestMode
                    };

                    if (!string.IsNullOrWhiteSpace(request.NamePattern))
                    {
                        filter.groupNames = new[]
                        {
                            $".*{Regex.Escape(request.NamePattern)}.*"
                        };
                    }

                    return _testRunnerApi.Execute(new ExecutionSettings(filter));
                }
                catch
                {
                    _callbacks.Clear();
                    throw;
                }
            }

            private sealed class CallbackForwarder : ICallbacks
            {
                private IUnityEditorTestRunObserver _observer;

                public void Assign(IUnityEditorTestRunObserver observer)
                {
                    _observer = observer;
                }

                public void Clear()
                {
                    _observer = null;
                }

                public void RunStarted(ITestAdaptor testsToRun)
                {
                    _observer?.OnRunStarted(CountLeafTests(testsToRun));
                }

                public void RunFinished(ITestResultAdaptor result)
                {
                    _observer?.OnRunFinished(new UnityEditorTestRunCompletion
                    {
                        Status = result.FailCount > 0 ? "failed" : "completed",
                        Passed = result.PassCount,
                        Failed = result.FailCount,
                        Skipped = result.SkipCount
                    });
                    _observer = null;
                }

                public void TestStarted(ITestAdaptor test)
                {
                }

                public void TestFinished(ITestResultAdaptor result)
                {
                    if (result?.Test == null || result.Test.IsSuite)
                    {
                        return;
                    }

                    _observer?.OnTestFinished(new UnityEditorTestCaseRecord
                    {
                        Name = result.Test.FullName,
                        Status = MapTestStatus(result.TestStatus),
                        DurationMs = result.Duration * 1000d,
                        Message = string.IsNullOrWhiteSpace(result.Message) ? null : result.Message
                    });
                }

                private static int CountLeafTests(ITestAdaptor test)
                {
                    if (test == null)
                    {
                        return 0;
                    }

                    if (!test.IsSuite)
                    {
                        return 1;
                    }

                    var count = 0;

                    if (!test.HasChildren)
                    {
                        return count;
                    }

                    foreach (var child in test.Children)
                    {
                        count += CountLeafTests(child);
                    }

                    return count;
                }

                private static string MapTestStatus(TestStatus status)
                {
                    return status switch
                    {
                        TestStatus.Failed => "failed",
                        TestStatus.Skipped => "skipped",
                        _ => "passed"
                    };
                }
            }
        }
    }
}
#endif
