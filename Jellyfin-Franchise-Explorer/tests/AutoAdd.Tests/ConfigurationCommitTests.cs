using System.Reflection;
using System.Xml.Serialization;
using Jellyfin.Plugin.FranchiseExplorer;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;

internal static class ConfigurationCommitTests
{
    private static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
    }

    public static async Task Run()
    {
        // Other controller tests use Plugin.Instance. Keep their fixture intact
        // even when a transaction assertion or simulated disk write fails.
        var previous = Plugin.Instance;
        var root = Path.Combine(Path.GetTempPath(), "franchise-configuration-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            await SuccessfulAndStaleCommits(Path.Combine(root, "existing"));
            await NativeWriteWaitsForGate(Path.Combine(root, "gate"));
            await FailedCommitsRestoreDisk(Path.Combine(root, "rollback"));
            await FailedFirstWriteRemovesPartialFile(Path.Combine(root, "first-write"));
            FailedDraftCanRetry(Path.Combine(root, "retry-draft"));
            Console.WriteLine("PASS configuration commits: shared gate, optimistic revisions, real XML writes, stale rejection and disk/in-memory rollback");
        }
        finally
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!
                .SetValue(null, previous);
            Directory.Delete(root, recursive: true);
        }
    }

    private static async Task SuccessfulAndStaleCommits(string root)
    {
        var storage = new Storage(root);
        var plugin = storage.Plugin;
        var first = new PluginConfiguration { NavigationLabel = "First & saved", ConfigurationRevision = 0 };
        plugin.UpdateConfiguration(first);
        Check(plugin.Configuration.ConfigurationRevision == 1 && first.ConfigurationRevision == 1,
            "A native settings write must increment its revision exactly once");
        Check(storage.Read().NavigationLabel == first.NavigationLabel && storage.Read().ConfigurationRevision == 1,
            "Successful native settings writes must persist their data and revision as XML");
        Check(FranchiseConfigurationGate.Gate.CurrentCount == 1,
            "The native settings entry point must release the shared gate after success");

        var second = new PluginConfiguration { NavigationLabel = "Background update", ConfigurationRevision = 1 };
        await UnderGate(() => plugin.CommitConfigurationUnderGate(second));
        Check(plugin.Configuration.ConfigurationRevision == 2 && storage.Read().ConfigurationRevision == 2,
            "A caller-held gate commit must increment and persist the same revision contract");
        var before = File.ReadAllBytes(plugin.ConfigurationFilePath);
        var live = plugin.Configuration;
        var attempts = storage.WriteAttempts;
        var stale = new PluginConfiguration { NavigationLabel = "Stale browser draft", ConfigurationRevision = 1 };
        ExpectStale(() => plugin.UpdateConfiguration(stale));
        await UnderGate(() => ExpectStale(() => plugin.CommitConfigurationUnderGate(stale)));
        Check(ReferenceEquals(plugin.Configuration, live) && plugin.Configuration.NavigationLabel == second.NavigationLabel,
            "Both stale entry points must preserve the current in-memory configuration");
        Check(storage.WriteAttempts == attempts && File.ReadAllBytes(plugin.ConfigurationFilePath).SequenceEqual(before),
            "Stale revisions must be rejected before any disk write");
        Check(stale.ConfigurationRevision == 1 && FranchiseConfigurationGate.Gate.CurrentCount == 1,
            "Stale rejection must preserve the draft revision and release the shared gate");
    }

    private static async Task FailedCommitsRestoreDisk(string root)
    {
        var storage = new Storage(root);
        var plugin = storage.Plugin;
        plugin.UpdateConfiguration(new PluginConfiguration { NavigationLabel = "Durable original" });
        var original = plugin.Configuration;
        var bytes = File.ReadAllBytes(plugin.ConfigurationFilePath);
        foreach (var nativeEntryPoint in new[] { true, false })
        {
            storage.FailNextWrite = true;
            var draft = new PluginConfiguration
            {
                NavigationLabel = "Must roll back",
                ConfigurationRevision = original.ConfigurationRevision
            };
            if (nativeEntryPoint) ExpectWriteFailure(() => plugin.UpdateConfiguration(draft));
            else await UnderGate(() => ExpectWriteFailure(() => plugin.CommitConfigurationUnderGate(draft)));
            Check(ReferenceEquals(plugin.Configuration, original) &&
                plugin.Configuration.ConfigurationRevision == 1 && plugin.Configuration.NavigationLabel == "Durable original",
                "A failed XML write must restore the prior in-memory configuration and revision");
            Check(File.ReadAllBytes(plugin.ConfigurationFilePath).SequenceEqual(bytes),
                "A failed, partially written XML file must be restored byte for byte");
            Check(storage.Read().ConfigurationRevision == 1 && storage.Read().NavigationLabel == "Durable original",
                "The restored file must remain readable by the real XML serializer");
            Check(!Directory.EnumerateFiles(root, "*.rollback-*").Any(),
                "Rollback must remove its temporary backup file");
            Check(FranchiseConfigurationGate.Gate.CurrentCount == 1,
                "Either failed entry point must leave the shared gate available");
        }
        // A subsequent valid edit must remain possible after each failed write.
        plugin.UpdateConfiguration(new PluginConfiguration { NavigationLabel = "Retry succeeded", ConfigurationRevision = 1 });
        Check(plugin.Configuration.ConfigurationRevision == 2 && storage.Read().ConfigurationRevision == 2,
            "Persistence failure must not consume the committed revision or prevent a later retry");
    }

    private static async Task NativeWriteWaitsForGate(string root)
    {
        var storage = new Storage(root);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Task? pending = null;
        await FranchiseConfigurationGate.Gate.WaitAsync();
        try
        {
            pending = Task.Run(() =>
            {
                started.SetResult();
                storage.Plugin.UpdateConfiguration(new PluginConfiguration { NavigationLabel = "Waited for background work" });
            });
            await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await Task.Delay(50);
            Check(!pending.IsCompleted && storage.WriteAttempts == 0,
                "A native settings write must wait while a background operation owns the shared gate");
        }
        finally
        {
            FranchiseConfigurationGate.Gate.Release();
            if (pending is not null) await pending.WaitAsync(TimeSpan.FromSeconds(5));
        }
        Check(storage.Plugin.Configuration.ConfigurationRevision == 1 && storage.Read().ConfigurationRevision == 1,
            "The waiting settings write must commit once the gate becomes available");
    }

    private static async Task FailedFirstWriteRemovesPartialFile(string root)
    {
        var storage = new Storage(root);
        var plugin = storage.Plugin;
        var original = plugin.Configuration;
        Check(!File.Exists(plugin.ConfigurationFilePath), "The first-write fixture must begin without a configuration file");
        storage.FailNextWrite = true;
        await UnderGate(() => ExpectWriteFailure(() => plugin.CommitConfigurationUnderGate(
            new PluginConfiguration { NavigationLabel = "Incomplete first save", ConfigurationRevision = 0 })));
        Check(ReferenceEquals(plugin.Configuration, original) && plugin.Configuration.ConfigurationRevision == 0,
            "A failed first write must retain the original live defaults and revision");
        Check(!File.Exists(plugin.ConfigurationFilePath), "A failed first write must remove the partial file it created");
    }

    private static void FailedDraftCanRetry(string root)
    {
        var storage = new Storage(root);
        storage.Plugin.UpdateConfiguration(new PluginConfiguration { NavigationLabel = "Before failed edit" });
        var draft = new PluginConfiguration { NavigationLabel = "Retry this edit", ConfigurationRevision = 1 };
        storage.FailNextWrite = true;
        ExpectWriteFailure(() => storage.Plugin.UpdateConfiguration(draft));
        Check(draft.ConfigurationRevision == 1,
            "A failed save must restore the caller draft revision so the same edit can be retried");
        storage.Plugin.UpdateConfiguration(draft);
        Check(storage.Plugin.Configuration.NavigationLabel == draft.NavigationLabel && storage.Read().ConfigurationRevision == 2,
            "Retrying the same draft after a failed save must commit successfully without an extra revision");
        var live = storage.Plugin.Configuration;
        var bytes = File.ReadAllBytes(storage.Plugin.ConfigurationFilePath);
        storage.FailNextWrite = true;
        ExpectWriteFailure(() => storage.Plugin.UpdateConfiguration(live));
        Check(live.ConfigurationRevision == 2 && ReferenceEquals(storage.Plugin.Configuration, live) &&
            File.ReadAllBytes(storage.Plugin.ConfigurationFilePath).SequenceEqual(bytes),
            "Passing the live configuration itself must also restore its revision and disk bytes after failure");
    }

    private static async Task UnderGate(Action action)
    {
        await FranchiseConfigurationGate.Gate.WaitAsync();
        try { action(); }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private static void ExpectStale(Action action)
    {
        try { action(); }
        catch (InvalidOperationException error) when (error.Message.Contains("configuration changed", StringComparison.OrdinalIgnoreCase)) { return; }
        throw new Exception("A stale configuration revision must fail with an optimistic concurrency error");
    }

    private static void ExpectWriteFailure(Action action)
    {
        try { action(); }
        catch (IOException error) when (error.Message == Storage.FailureMessage) { return; }
        throw new Exception("The XML persistence failure must propagate to its caller");
    }

    private sealed class Storage
    {
        public const string FailureMessage = "Injected XML persistence failure";
        public Plugin Plugin { get; }
        public bool FailNextWrite { get; set; }
        public int WriteAttempts { get; private set; }

        public Storage(string root)
        {
            Directory.CreateDirectory(root);
            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>();
            ((Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? root : null;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>();
            ((Proxy)(object)xml).Call = (method, args) =>
            {
                if (method.Name == "DeserializeFromFile")
                {
                    var type = (Type)args![0]!;
                    var filename = (string)args[1]!;
                    if (!File.Exists(filename)) return Activator.CreateInstance(type);
                    using var stream = File.OpenRead(filename);
                    return new XmlSerializer(type).Deserialize(stream);
                }
                if (method.Name == "SerializeToFile")
                {
                    Check(FranchiseConfigurationGate.Gate.CurrentCount == 0,
                        "Both configuration entry points must serialize under the shared gate");
                    WriteAttempts++;
                    var filename = (string)args![1]!;
                    Directory.CreateDirectory(Path.GetDirectoryName(filename)!);
                    if (FailNextWrite)
                    {
                        FailNextWrite = false;
                        File.WriteAllText(filename, "<truncated-configuration>");
                        throw new IOException(FailureMessage);
                    }
                    using var stream = File.Create(filename);
                    new XmlSerializer(args[0]!.GetType()).Serialize(stream, args[0]);
                    return null;
                }
                throw new NotSupportedException("Unexpected serializer operation: " + method.Name);
            };
            Plugin = new Plugin(paths, xml);
        }

        public PluginConfiguration Read()
        {
            using var stream = File.OpenRead(Plugin.ConfigurationFilePath);
            return (PluginConfiguration)new XmlSerializer(typeof(PluginConfiguration)).Deserialize(stream)!;
        }
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = (_, _) => null;

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method is null) return null;
            var result = Call(method, args);
            return result ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void)
                ? Activator.CreateInstance(method.ReturnType) : null);
        }
    }
}
