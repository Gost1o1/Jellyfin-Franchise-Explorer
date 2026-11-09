using System.Reflection;
using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using Jellyfin.Plugin.FranchiseExplorer.Tasks;
using MediaBrowser.Common.Api;
using MediaBrowser.Model.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

internal static class AutomationRuntimeTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    public static async Task Run()
    {
        Schedule();
        await DisabledAndRegistry();
        await AllowlistAndSourceFailures();
        await DayPersistenceAndScanWait();
        await CancellationAndTimeout();
        await OverlapAndStaleConfiguration();
        await SettingsAndReview();
        await PreviewSelectiveApply();
        await AdminAndJson();
        Console.WriteLine("PASS automation runtime: local midnight, restart/day guard, scan wait, enabled registry, source safety, overlap, optimistic commits, review and admin JSON");
    }

    private static void Schedule()
    {
        var harness = new Harness();
        var triggers = new AutoFranchisesTask(harness.Service()).GetDefaultTriggers().ToArray();
        Check(triggers.Any(t => t.Type == TaskTriggerInfoType.DailyTrigger && t.TimeOfDayTicks == 0), "Midnight daily server task trigger");
        Check(triggers.Any(t => t.Type == TaskTriggerInfoType.StartupTrigger), "Restart catch-up trigger");
        var zone = TimeZoneInfo.CreateCustomTimeZone("test+14", TimeSpan.FromHours(14), "test+14", "test+14");
        Check(AutoFranchiseService.LocalDay(DateTimeOffset.Parse("2026-11-09T12:00:00Z"), zone) == "2026-11-10", "Scheduled day uses server timezone, not UTC");
        Check(AutoFranchiseService.IsScheduledDayDue("2026-11-09", "2026-11-10"), "Next local day is due");
        Check(!AutoFranchiseService.IsScheduledDayDue("2026-11-10", "2026-11-10"), "Duplicate same-day run suppressed");
        Check(!AutoFranchiseService.IsScheduledDayDue("2026-11-10", "2026-11-09"), "Clock reversal does not repeat completed days");
    }

    private static async Task DisabledAndRegistry()
    {
        var h = new Harness(); h.Config.AutoFranchises.Enabled = false;
        var result = await h.Service().RunAsync(true, default);
        Check(result.Status == "Disabled" && h.SourceCalls.Count == 0 && h.Config.Nodes.Count == 0, "Automation starts disabled and never fetches without opt-in");
        h.Config.AutoFranchises.Enabled = true;
        h.Config.AutoFranchises.Registry.Add(new() { Name = "Disabled", Url = "https://www.imdb.com/list/ls2/", Enabled = false });
        h.Config.ImdbLists.Add(new() { Name = "Reusable only", Url = "https://www.imdb.com/list/ls3/" });
        result = await h.Service().RunAsync(false, default);
        Check(result.Status == "Completed" && h.SourceCalls.SequenceEqual(new[] { "ls1" }), "Only enabled automation registrations are fetched");
        Check(h.Config.Nodes.Count == 1 && h.Config.Rows.Count == 3, "Runtime creates the three standard rows");
        var count = h.Config.Rows.Sum(r => r.Items.Count) + h.Config.MediaLinks.Count;
        await h.Service().RunAsync(false, default);
        Check(h.Config.Rows.Sum(r => r.Items.Count) + h.Config.MediaLinks.Count == count, "Repeated manual runs retain stable references");
    }

    private static async Task AllowlistAndSourceFailures()
    {
        foreach (var url in new[] { "http://www.imdb.com/list/ls1/", "https://evil.example/list/ls1/", "https://www.imdb.com.evil.example/list/ls1/", "https://user@www.imdb.com/list/ls1/", "https://www.imdb.com:444/list/ls1/", "https://www.imdb.com/list/ls1/?token=secret", "https://www.imdb.com/list/ls1/#fragment", "https://www.imdb.com/title/tt1/", "https://www.imdb.com/list/%6cs1/" })
            Check(!AutoFranchiseService.TryCanonicalListUrl(url, out _, out _), "Reject arbitrary source URL before any network: " + url);
        Check(AutoFranchiseService.TryCanonicalListUrl("https://www.imdb.com/list/ls1", out var canonical, out var listId)
            && canonical == "https://www.imdb.com/list/ls1/" && listId == "ls1", "Canonical IMDb list allowlist");
        var invalid = new Harness(); invalid.Config.AutoFranchises.Registry[0].Url = "https://evil.example/list/ls1/";
        var invalidResult = await invalid.Service().RunAsync(false, default);
        Check(invalidResult.Errors == 1 && invalid.SourceCalls.Count == 0 && invalid.Config.Nodes.Count == 0, "Invalid persisted source never reaches HTTP client");

        foreach (var failure in new[] { "private", "incomplete", "empty", "invalidOrder" })
        {
            var h = new Harness(); await h.Service().RunAsync(false, default);
            var before = JsonSerializer.Serialize(new { h.Config.Nodes, h.Config.Rows, h.Config.MediaLinks, h.Config.AutoFranchises.Ownership });
            h.ReadSource = (_, _) => failure switch
            {
                "empty" => Task.FromResult(new List<FranchiseAutoAddController.Entry>()),
                "invalidOrder" => Task.FromResult(new List<FranchiseAutoAddController.Entry> { new("tt1", "Movie", 2000, "Movie", null) }),
                _ => Task.FromException<List<FranchiseAutoAddController.Entry>>(new InvalidOperationException("IMDb source " + failure))
            };
            var result = await h.Service().RunAsync(false, default);
            Check(result.Status == "CompletedWithErrors" && before == JsonSerializer.Serialize(new { h.Config.Nodes, h.Config.Rows, h.Config.MediaLinks, h.Config.AutoFranchises.Ownership }), "Failed/private/incomplete source preserves existing content: " + failure);
            Check(h.Config.AutoFranchises.PendingChanges.Any(c => c.Kind == "SourceError"), "Source failures persist a separate review notification");
        }
        var unavailable = new Harness(); unavailable.Library[0].IsAvailable = false;
        var deferred = await unavailable.Service().RunAsync(false, default);
        Check(deferred.Status == "Deferred" && unavailable.SourceCalls.Count == 0 && unavailable.Config.Nodes.Count == 0, "Unavailable media defers automation before source planning");
    }

    private static async Task DayPersistenceAndScanWait()
    {
        var h = new Harness(); var service = h.Service();
        var first = await service.RunAsync(true, default);
        Check(first.Status == "Completed" && h.Config.AutoFranchises.LastCompletedLocalDay == "2026-11-09", "Successful scheduled day persists");
        var calls = h.SourceCalls.Count;
        var restarted = await h.Service().RunAsync(true, default);
        Check(restarted.Status == "AlreadyCompleted" && h.SourceCalls.Count == calls, "Restart does not duplicate catch-up");
        h.Now = h.Now.AddDays(-1);
        Check((await h.Service().RunAsync(true, default)).Status == "AlreadyCompleted", "Backward server clock keeps durable day protection");
        h.Now = h.Now.AddDays(2);
        await h.Service().RunAsync(true, default);
        Check(h.Config.AutoFranchises.LastCompletedLocalDay == "2026-11-10" && h.SourceCalls.Count == calls + 1, "One execution on the next local day");

        var waiting = new Harness { Scanning = true };
        var waits = 0;
        service = waiting.Service(async (_, token) =>
        {
            waits++;
            Check(waiting.Config.AutoFranchises.LastRun?.Status == "WaitingForLibraryScan" && waiting.SourceCalls.Count == 0, "Scan waiting is visible and never fetches early");
            waiting.Scanning = false;
            await Task.CompletedTask;
        });
        Check((await service.RunAsync(true, default)).Status == "Completed" && waits == 1, "Automatic server task waits for scan completion");
    }

    private static async Task OverlapAndStaleConfiguration()
    {
        var h = new Harness();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        h.ReadSource = async (_, token) => { started.SetResult(); await release.Task.WaitAsync(token); return Source(); };
        var service = h.Service(); var run = service.RunAsync(false, default);
        await started.Task;
        Check((await service.RunAsync(false, default)).Status == "Busy", "Overlapping server runs are rejected");
        release.SetResult(); await run;

        h = new Harness(); var stale = h;
        h.ReadSource = (_, _) =>
        {
            stale.Mutate(config => { config.NavigationLabel = "My manual edit"; config.Nodes.Add(new() { Name = "Custom Phase", NodeType = "Phase" }); });
            return Task.FromResult(Source());
        };
        var result = await h.Service().RunAsync(false, default);
        Check(result.Status == "Deferred" && result.Added == 0 && h.Config.NavigationLabel == "My manual edit"
            && h.Config.Nodes.Count == 1 && h.Config.Rows.Count == 0, "A concurrent manual edit wins over an old automation snapshot");

        h = new Harness(); var changing = h;
        h.ReadSource = (_, _) => { changing.Library[0].Name = "Changed during source fetch"; return Task.FromResult(Source()); };
        result = await h.Service().RunAsync(false, default);
        Check(result.Status == "Deferred" && h.Config.Rows.Count == 0, "Library changes invalidate the plan before committing");
    }

    private static async Task CancellationAndTimeout()
    {
        var h = new Harness { Scanning = true };
        using var cancellation = new CancellationTokenSource();
        var service = h.Service((_, token) => { cancellation.Cancel(); return Task.FromCanceled(token); });
        await Expect<OperationCanceledException>(() => service.RunAsync(true, cancellation.Token), "Scheduled scan waiting observes server cancellation");
        Check(h.Config.AutoFranchises.LastRun?.Status == "Cancelled" && h.Config.AutoFranchises.LastCompletedLocalDay.Length == 0 && h.SourceCalls.Count == 0,
            "Cancellation remains visible and does not claim a completed scheduled day");
        h.Scanning = false;
        Check((await service.RunAsync(true, default)).Status == "Completed", "Cancellation releases the operation gate for a later run");

        var timeout = new Harness();
        timeout.ReadSource = (_, _) => Task.FromException<List<FranchiseAutoAddController.Entry>>(new TaskCanceledException("IMDb source deadline expired."));
        var result = await timeout.Service().RunAsync(false, default);
        Check(result.Status == "CompletedWithErrors" && timeout.Config.Nodes.Count == 0 && timeout.Config.AutoFranchises.PendingChanges.Any(c => c.Kind == "SourceError"),
            "A source's own deadline is a visible source failure, not permission to import partial content");
    }

    private static async Task SettingsAndReview()
    {
        var h = new Harness(); var service = h.Service();
        var status = await service.StatusAsync(default);
        await Expect<AutomationConflictException>(() => service.SaveSettingsAsync(new() { ExpectedFingerprint = new string('0', 64), Registry = new() }, default), "Stale settings are rejected");
        var registration = h.Config.AutoFranchises.Registry[0];
        h.Config.AutoFranchises.Exclusions.Add(new() { RegistrationId = registration.Id, ProviderId = "tt1", Scope = "Movie" });
        status = await service.StatusAsync(default);
        await service.SaveSettingsAsync(new()
        {
            ExpectedFingerprint = status.Fingerprint, Enabled = true,
            Registry = new() { new() { Id = registration.Id, Name = "Renamed", Url = registration.Url, Enabled = true, EpisodeFormat = "Individual" } }
        }, default);
        Check(h.Config.AutoFranchises.Exclusions.Count == 1 && h.Config.AutoFranchises.Registry[0].EpisodeFormat == "Individual", "Saving editable settings preserves backend saved choices");
        await service.RunAsync(false, default);
        Check(h.Config.Nodes.Count == 0 && h.Config.AutoFranchises.PendingChanges.Count == 2, "Protected movie additions are held in both affected rows");
        var ids = h.Config.AutoFranchises.PendingChanges.Select(c => c.Id).ToList();
        status = await service.StatusAsync(default);
        await service.DecideAsync(new() { ExpectedFingerprint = status.Fingerprint, Decision = "Keep", ChangeIds = ids }, default);
        await service.RunAsync(false, default);
        Check(h.Config.AutoFranchises.PendingChanges.Count == ids.Count && h.Config.AutoFranchises.PendingChanges.All(c => c.Status == "Kept"), "Keep acknowledgment deduplicates across nights");
        h.Config.AutoFranchises.Enabled = false;
        status = await service.StatusAsync(default);
        await Expect<AutomationConflictException>(() => service.DecideAsync(new() { ExpectedFingerprint = status.Fingerprint, Decision = "Restore", ChangeIds = new() { Guid.NewGuid().ToString("D") } }, default), "Unknown restore candidate is rejected");
        await Expect<ArgumentException>(() => service.DecideAsync(new() { ExpectedFingerprint = status.Fingerprint, Decision = "Restore", ChangeIds = new() { ids[0] } }, default), "A pending item cannot implicitly clear its broad saved restriction");
        await service.DecideAsync(new() { ExpectedFingerprint = status.Fingerprint, Decision = "Restore", ExclusionIds = new() { h.Config.AutoFranchises.Exclusions[0].Id } }, default);
        Check(h.Config.AutoFranchises.Exclusions.All(e => !e.Enabled) && h.Config.Nodes.Count == 0 && !h.Config.AutoFranchises.Enabled,
            "Explicit selected rule restore revalidates source/library, adds no media and preserves the disabled daily schedule");

        var removal = new Harness(); var removalService = removal.Service();
        await removalService.RunAsync(false, default);
        removal.ReadSource = (_, _) => Task.FromResult(new List<FranchiseAutoAddController.Entry> { new("tt2", "Unavailable new title", 2001, "Movie", 1) });
        await removalService.RunAsync(false, default);
        removal.Config.AutoFranchises.Enabled = false;
        var removalStatus = await removalService.StatusAsync(default);
        var removalChange = removal.Config.AutoFranchises.PendingChanges.First(c => c.Kind == "Remove");
        await removalService.DecideAsync(new() { ExpectedFingerprint = removalStatus.Fingerprint, Decision = "Apply", ChangeIds = new() { removalChange.Id } }, default);
        Check(!removal.Config.AutoFranchises.Enabled && removal.Config.AutoFranchises.PendingChanges.Single(c => c.Id == removalChange.Id).Status == "Applied", "Explicit reviewed apply works while daily automation remains disabled");

        var scoped = new Harness(); var scopedService = scoped.Service();
        var scopeRegistration = scoped.Config.AutoFranchises.Registry[0].Id;
        scoped.Config.AutoFranchises.Exclusions.Add(new() { RegistrationId = scopeRegistration, ProviderId = "tt1", Scope = "Movie" });
        scoped.Config.AutoFranchises.Exclusions.Add(new() { RegistrationId = scopeRegistration, ProviderId = "tt1", Scope = "Movie" });
        await scopedService.RunAsync(false, default);
        var scopedStatus = await scopedService.StatusAsync(default);
        var selectedRule = scoped.Config.AutoFranchises.Exclusions[0].Id;
        await scopedService.DecideAsync(new() { ExpectedFingerprint = scopedStatus.Fingerprint, Decision = "Restore", ExclusionIds = new() { selectedRule } }, default);
        Check(!scoped.Config.AutoFranchises.Exclusions[0].Enabled && scoped.Config.AutoFranchises.Exclusions[1].Enabled && scoped.Config.Nodes.Count == 0, "Restoring one selected rule retains all other restrictions");

        var atomic = new Harness(); var atomicService = atomic.Service();
        await atomicService.RunAsync(false, default);
        atomic.Library.Add(new() { Id = Guid.NewGuid().ToString("D"), Name = "Protected second movie", ItemType = "Movie", ProviderIds = new() { ["Imdb"] = "tt2" } });
        atomic.Config.AutoFranchises.Exclusions.Add(new() { RegistrationId = atomic.Config.AutoFranchises.Registry[0].Id, ProviderId = "tt2", Scope = "Movie" });
        atomic.ReadSource = (_, _) => Task.FromResult(new List<FranchiseAutoAddController.Entry> { new("tt2", "Protected second movie", 2001, "Movie", 1) });
        await atomicService.RunAsync(false, default);
        var atomicStatus = await atomicService.StatusAsync(default);
        var beforeAtomic = JsonSerializer.Serialize(atomic.Config);
        var mixedIds = new List<string> { atomic.Config.AutoFranchises.PendingChanges.First(c => c.Kind == "Remove").Id, atomic.Config.AutoFranchises.PendingChanges.First(c => c.Kind == "Excluded").Id };
        await Expect<ArgumentException>(() => atomicService.DecideAsync(new() { ExpectedFingerprint = atomicStatus.Fingerprint, Decision = "Apply", ChangeIds = mixedIds }, default), "A mixed review cannot bypass a protected candidate");
        Check(JsonSerializer.Serialize(atomic.Config) == beforeAtomic, "Refusing a blocked candidate atomically preserves every selected change");

        var mismatch = new Harness(); var mismatchService = mismatch.Service();
        mismatch.Config.AutoFranchises.Exclusions.Add(new() { RegistrationId = mismatch.Config.AutoFranchises.Registry[0].Id, Scope = "Movie", ProviderId = "tt1" });
        await mismatchService.RunAsync(false, default);
        mismatch.ReadSource = (_, _) => Task.FromResult(new List<FranchiseAutoAddController.Entry> { new("tt2", "Elsewhere", 2001, "Movie", 1) });
        status = await mismatchService.StatusAsync(default);
        await Expect<AutomationConflictException>(() => mismatchService.DecideAsync(new() { ExpectedFingerprint = status.Fingerprint, Decision = "Restore", ExclusionIds = new() { mismatch.Config.AutoFranchises.Exclusions[0].Id } }, default), "Restore rechecks candidate source membership");
        Check(mismatch.Config.AutoFranchises.Exclusions[0].Enabled, "A stale restored proposal cannot clear a saved restriction");
    }

    private static async Task AdminAndJson()
    {
        var attribute = typeof(FranchiseAutomationController).GetCustomAttribute<AuthorizeAttribute>();
        Check(attribute?.Policy == Policies.RequiresElevation, "Every automation endpoint requires Jellyfin administrative elevation");
        foreach (var method in typeof(FranchiseAutomationController).GetMethods(BindingFlags.Public | BindingFlags.Instance).Where(m => new[] { "Settings", "Preview", "Run", "Decision", "Exclusion" }.Contains(m.Name)))
            Check(method.GetCustomAttribute<HttpPostAttribute>() is not null, "All automation mutations use POST");
        var controller = new FranchiseAutomationController(new Harness().Service());
        var response = await controller.Status(default) as ContentResult;
        Check(response?.StatusCode == 200 && response.ContentType?.StartsWith("application/json") == true, "Explicit controller JSON response");
        using var json = JsonDocument.Parse(response!.Content!);
        Check(json.RootElement.TryGetProperty("settings", out var settings) && settings.TryGetProperty("pendingChanges", out _)
            && json.RootElement.TryGetProperty("fingerprint", out _), "CamelCase contract is independent of Jellyfin MVC defaults");
        var rejected = await controller.Settings(new() { ExpectedFingerprint = "stale", Registry = new() }, default) as ContentResult;
        Check(rejected?.StatusCode == 409, "Controller exposes optimistic conflicts without overwriting current settings");
    }

    private static async Task PreviewSelectiveApply()
    {
        var h = new Harness(); h.Config.AutoFranchises.Enabled = false;
        var service = h.Service();
        var before = JsonSerializer.Serialize(h.Config);
        var preview = await service.PreviewAsync(new(), default);
        Check(JsonSerializer.Serialize(h.Config) == before && preview.Plans.Single().SafeAdditions.Count == 2, "Explicit preview is read-only and works before schedule opt-in");
        var selected = preview.Plans.Single().SafeAdditions[0];
        await service.DecideAsync(new()
        {
            ExpectedFingerprint = preview.Fingerprint, Decision = "Apply", RegistrationIds = new() { h.Config.AutoFranchises.Registry[0].Id }, ChangeIds = new() { selected.Id }
        }, default);
        Check(!h.Config.AutoFranchises.Enabled && h.Config.Rows.Sum(r => r.Items.Count) + h.Config.MediaLinks.Count == 1,
            "Preview Apply revalidates selected safe additions without applying other candidates or enabling the schedule");
        Check(h.Config.AutoFranchises.Exclusions.Count == 0, "Unchecked or cancelled preview candidates never become persistent exclusions");

        var stale = new Harness(); stale.Config.AutoFranchises.Enabled = false;
        var staleService = stale.Service(); var stalePreview = await staleService.PreviewAsync(new(), default);
        stale.ReadSource = (_, _) => Task.FromResult(new List<FranchiseAutoAddController.Entry> { new("tt2", "Different source member", 2001, "Movie", 1) });
        await Expect<AutomationConflictException>(() => staleService.DecideAsync(new()
        {
            ExpectedFingerprint = stalePreview.Fingerprint, Decision = "Apply", RegistrationIds = new() { stale.Config.AutoFranchises.Registry[0].Id },
            ChangeIds = new() { stalePreview.Plans.Single().SafeAdditions[0].Id }
        }, default), "Preview safe candidates are checked against current complete source membership");
        Check(stale.Config.Nodes.Count == 0, "A stale safe preview cannot create an unavailable franchise");
    }

    private static async Task Expect<T>(Func<Task> action, string message) where T : Exception
    {
        try { await action(); } catch (T) { return; }
        throw new Exception(message);
    }

    private static List<FranchiseAutoAddController.Entry> Source() => new() { new("tt1", "Movie", 2000, "Movie", 1) };

    private sealed class Harness
    {
        public PluginConfiguration Config = new()
        {
            AutoFranchises = new()
            {
                Enabled = true,
                Registry = new() { new() { Name = "Test", Url = "https://www.imdb.com/list/ls1/", Enabled = true } }
            }
        };
        public List<AutomationLibraryItem> Library = new() { new() { Id = Guid.NewGuid().ToString("D"), Name = "Movie", ItemType = "Movie", ProviderIds = new() { ["Imdb"] = "tt1" } } };
        public DateTimeOffset Now = DateTimeOffset.Parse("2026-11-09T12:00:00Z");
        public bool Scanning;
        public List<string> SourceCalls = new();
        public Func<string, CancellationToken, Task<List<FranchiseAutoAddController.Entry>>> ReadSource = (_, _) => Task.FromResult(Source());

        public AutoFranchiseService Service(Func<TimeSpan, CancellationToken, Task>? delay = null) => new(
            () => Config,
            config =>
            {
                if (config.ConfigurationRevision != Config.ConfigurationRevision) throw new InvalidOperationException("Stale test configuration revision.");
                config.ConfigurationRevision++; Config = AutoFranchiseService.Clone(config);
            },
            () => Scanning,
            () => AutoFranchiseService.Clone(Library),
            async (id, token) => { SourceCalls.Add(id); return await ReadSource(id, token); },
            () => Now, TimeZoneInfo.Utc, delay);

        public void Mutate(Action<PluginConfiguration> action)
        {
            FranchiseConfigurationGate.Gate.Wait();
            try { var clone = AutoFranchiseService.Clone(Config); action(clone); clone.ConfigurationRevision++; Config = clone; }
            finally { FranchiseConfigurationGate.Gate.Release(); }
        }
    }
}
