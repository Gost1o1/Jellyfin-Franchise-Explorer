using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

internal static class AutoRecoveryTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static AutomationLibraryItem Item(string name, string type = "Movie", int? year = 2020, string imdb = "tt123") => new()
    { Id = Guid.NewGuid().ToString("D"), Name = name, ItemType = type, Year = year, ProviderIds = new() { ["Imdb"] = imdb } };
    private static MediaLink Link(string title, string type = "Movie") => new()
    { JellyfinItemId = Guid.NewGuid().ToString("D"), DisplayName = title, ItemType = type };
    private static MediaRecoveryEntry Review(MediaLink link, params AutomationLibraryItem[] items)
    {
        var config = new PluginConfiguration(); config.MediaLinks.Add(link);
        return MediaRecoveryPlanner.Review(config, new(items, "title-tests", true, "Available")).Entries.Single();
    }

    public static async Task Run()
    {
        ExactMatchingPolicy();
        await RecoverAll127References();
        await MixedBatchKeepsOnlyUnresolvedReferences();
        await ScheduledAndOfflineRecovery();
        await ExplicitPreferenceAndEndpoint();
        await AutomaticRollback();
        Console.WriteLine("PASS automatic recovery: 127 legacy title references, exact matching, duplicate/year/conflict holds, offline originals, startup, admin Auto endpoint and transactional rollback");
    }

    private static void ExactMatchingPolicy()
    {
        var iron = Link("  Iron\tMan 3  ");
        Check(Review(iron, Item("Iron Man 3")) is { CanAutoRemap: true, MatchMethod: "Exact title and type" }, "Case and whitespace normalization must recover a unique exact movie title");
        Check(!Review(Link("Iron Man"), Item("Iron Man 3")).CanAutoRemap, "Partial and fuzzy titles must never be automatic matches");
        Check(Review(Link("Thor The Dark World"), Item("Thor: The Dark World")).CanAutoRemap, "Subtitle separators may vary when the entire title word sequence and type agree");
        Check(!Review(Link("The Worlds End"), Item("The World's End")).CanAutoRemap, "Normalization must retain punctuation within words");
        Check(Review(Link("Dune"), Item("Dune", year: 1984), Item("Dune", year: 2021)) is { Status: "Ambiguous", CanAutoRemap: false }, "Remakes without a stored production year must remain ambiguous");
        var year = Link("Dune"); year.Identity = new() { ItemType = "Movie", Year = 2021 };
        Check(Review(year, Item("Dune", year: 1984), Item("Dune", year: 2021)).CanAutoRemap, "A stored production year may disambiguate otherwise exact titles");
        Check(!Review(year, Item("Dune", year: 2021), Item("Dune", year: 2021)).CanAutoRemap, "Two editions in the same production year must remain an explicit choice");
        Check(!Review(year, Item("Dune", year: 1984)).CanAutoRemap, "An exact title must not bypass a saved production year");
        Check(Review(Link("Same name"), Item("Same name"), Item("Same name", "Series")).CanAutoRemap, "An exact title must also match the saved media type");
        var offlineDuplicate = Item("Edition"); offlineDuplicate.IsAvailable = false;
        Check(Review(Link("Edition"), Item("Edition"), offlineDuplicate) is { Status: "Ambiguous", CanAutoRemap: false }, "An offline duplicate must not silently select another edition by title");
        var conflict = Link("Iron Man 3"); conflict.Identity = MediaRecoveryPlanner.Capture(Item("Old custom title", imdb: "tt111"));
        Check(!Review(conflict, Item("Iron Man 3", imdb: "tt222")).CanAutoRemap, "An exact title must never bypass conflicting durable provider identity");
        Check(Review(conflict, Item("Renamed library title", imdb: "tt111")) is { CanAutoRemap: true, MatchMethod: "Provider identity" }, "Provider identity must retain priority over changed titles");
        var offlineVersion = Item("Iron Man 3", imdb: "tt111"); offlineVersion.IsAvailable = false;
        Check(Review(conflict, Item("Iron Man 3", imdb: "tt111"), offlineVersion) is { Status: "Ambiguous", CanAutoRemap: false }, "Provider identity must not silently choose an available edition while another matching version is offline");
        Check(!Review(Link("Pilot", "Episode"), Item("Pilot", "Episode")).CanAutoRemap, "An episode title alone must never establish its parent or episode coordinates");

        var series = Link("Agents of S.H.I.E.L.D. · S01E01–S01E07", "Series");
        series.RangeMode = "Episodes"; series.StartSeason = series.EndSeason = 1; series.StartEpisode = 1; series.EndEpisode = 7;
        Check(Review(series, Item("Agents of S.H.I.E.L.D.", "Series")).CanAutoRemap, "A stored series bundle suffix may be stripped only when it agrees with the saved episode range");
        series.EndEpisode = 8;
        Check(!Review(series, Item("Agents of S.H.I.E.L.D.", "Series")).CanAutoRemap, "A conflicting bundle suffix must remain for review");
        series.EndEpisode = 7; series.RangeMode = "Full";
        Check(!Review(series, Item("Agents of S.H.I.E.L.D.", "Series")).CanAutoRemap, "A title suffix must not be stripped without stored range evidence");
        var collection = new PluginConfiguration(); var box = Item("Marvel", "BoxSet");
        collection.Nodes.Add(new() { Name = "Marvel", CollectionId = Guid.NewGuid().ToString("D") });
        Check(MediaRecoveryPlanner.Review(collection, new(new[] { box }, "boxes", true, "Available")).Entries.Single().CanAutoRemap, "Collection references may recover from a unique exact collection title");

        var shared = new PluginConfiguration(); var first = Link("First"); var other = Link("Other"); other.JellyfinItemId = first.JellyfinItemId;
        shared.MediaLinks.AddRange(new[] { first, other });
        var sharedStatus = MediaRecoveryPlanner.Review(shared, new(new[] { Item("First"), Item("Other") }, "shared", true, "Available"));
        Check(sharedStatus.Entries.All(e => !e.CanAutoRemap && e.Status == "ManualReview"), "References sharing an old ID with conflicting titles must be held together");
    }

    private static async Task MixedBatchKeepsOnlyUnresolvedReferences()
    {
        using var fixture = new Fixture();
        var clear = Link("Iron Man 3"); var thor = Link("Thor: The Dark World");
        var duplicate = Link("Two editions"); var conflict = Link("Durable conflict");
        conflict.Identity = MediaRecoveryPlanner.Capture(Item("Durable conflict", imdb: "tt111"));
        var series = Link("A series · S01E02–S02E03", "Series"); series.RangeMode = "Episodes";
        series.StartSeason = 1; series.EndSeason = 2; series.StartEpisode = 2; series.EndEpisode = 3;
        fixture.Plugin.Configuration.MediaLinks.AddRange(new[] { clear, thor, duplicate, conflict, series });
        var first = await fixture.AddMovie(clear.DisplayName); await fixture.AddMovie(thor.DisplayName);
        await fixture.AddMovie(duplicate.DisplayName); await fixture.AddMovie(duplicate.DisplayName); await fixture.AddMovie(conflict.DisplayName);
        var show = fixture.AddSeries("A series");
        var result = await fixture.Service.AutoAsync();
        Check(result.RemappedCount == 3 && result.Status.HealthyCount == 3 && result.Status.AttentionCount == 2,
            "One batch must recover clear movies and a series bundle while holding ambiguous editions and conflicting durable evidence");
        Check(result.Status.Entries.Where(e => e.Status != "Healthy").All(e => !e.CanAutoRemap), "Only unresolved references must remain after an automatic batch");
        var restored = fixture.Plugin.Configuration.MediaLinks.Single(l => l.Id == series.Id);
        Check(restored.JellyfinItemId == show.Id.ToString("D") && restored.DisplayName == series.DisplayName && restored.RangeMode == "Episodes"
            && restored.StartSeason == 1 && restored.EndSeason == 2 && restored.StartEpisode == 2 && restored.EndEpisode == 3,
            "Automatic series title recovery must retain the exact bundle title and stored range coordinates");
        Check(fixture.Plugin.Configuration.MediaLinks.Single(l => l.Id == clear.Id).JellyfinItemId == first.Id.ToString("D"), "A conflict elsewhere in the batch must not block a clear title replacement");
    }

    private static async Task RecoverAll127References()
    {
        using var fixture = new Fixture();
        var config = fixture.Plugin.Configuration;
        var row = new FranchiseRow { RowType = "Timeline" }; config.Rows.Add(row);
        for (var index = 0; index < 240; index++)
        {
            var healthy = await fixture.AddMovie("Healthy " + index);
            config.MediaLinks.Add(new() { JellyfinItemId = healthy.Id.ToString("D"), DisplayName = healthy.Name, ItemType = "Movie" });
        }
        var replacements = new Dictionary<string, string>();
        for (var index = 0; index < 127; index++)
        {
            var title = index == 0 ? "Iron Man 3" : index == 1 ? "Thor: The Dark World" : "Moved movie " + index;
            var movie = await fixture.AddMovie(title);
            var oldId = Guid.NewGuid().ToString("D"); replacements.Add(oldId, movie.Id.ToString("D"));
            if (index % 2 == 0)
            {
                var link = Link(title); link.JellyfinItemId = oldId; link.Position = 127 - index;
                link.Artwork.LogoUrl = "/FranchiseExplorer/Artwork/Assets/kept-" + index;
                config.MediaLinks.Add(link); row.MediaLinkIds.Add(link.Id); row.MediaOrder.Add(link.Id);
            }
            else
            {
                var entry = new FranchiseRowEntry { JellyfinItemId = oldId, DisplayName = title, ItemType = "Movie" };
                row.Items.Add(entry); row.MediaOrder.Add(entry.Id);
            }
        }
        var expectedOrder = row.MediaOrder.ToArray();
        var firstOld = replacements.First();
        var progressPath = fixture.ProgressPath;
        await File.WriteAllTextAsync(progressPath, JsonSerializer.Serialize(new FranchiseTimelineController.TimelineProgress
        {
            ItemId = firstOld.Key, QueueKeys = new() { "reference:" + firstOld.Key }, CompletedKeys = new() { "reference:" + firstOld.Key },
            Index = 0, Total = 1, PositionTicks = 654321, SessionId = "old-session", PlaybackMode = "playing"
        }, JsonOptions));
        var status = await fixture.Service.StatusAsync();
        Check(status.ReferenceCount == 367 && status.HealthyCount == 240 && status.Entries.Count(e => e.CanAutoRemap) == 127,
            "The reported 367-reference scenario must identify all 127 unique legacy titles without individual selection");
        var result = await fixture.Service.AutoAsync();
        Check(result.RemappedCount == 127 && result.Status.HealthyCount == 367 && result.Status.AttentionCount == 0,
            "One Auto pass must reconnect every one of the 127 clear legacy references");
        var after = fixture.Plugin.Configuration;
        Check(after.Rows.Single().MediaOrder.SequenceEqual(expectedOrder) && after.MediaLinks.All(l => l.Identity is not null), "Automatic remapping must preserve reference order and capture durable replacement identities");
        Check(after.MediaLinks.Where(l => replacements.Values.Contains(l.JellyfinItemId)).All(l => l.Position > 0 && l.Artwork.LogoUrl.Contains("kept-")), "Automatic remapping must preserve positions and custom artwork");
        var progress = JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(await File.ReadAllTextAsync(progressPath), JsonOptions)!;
        Check(progress.ItemId == firstOld.Value && progress.QueueKeys.Single().EndsWith(firstOld.Value) && progress.CompletedKeys.Single().EndsWith(firstOld.Value) && progress.PositionTicks == 654321,
            "Automatic recovery must remap saved user progress while retaining its exact playback position");
        var revision = after.ConfigurationRevision;
        Check((await fixture.Service.AutoAsync()).RemappedCount == 0 && fixture.Plugin.Configuration.ConfigurationRevision == revision, "A second Auto pass must be idempotent");
    }

    private static async Task ScheduledAndOfflineRecovery()
    {
        using var fixture = new Fixture();
        var link = Link("Startup title"); fixture.Plugin.Configuration.MediaLinks.Add(link);
        var replacement = await fixture.AddMovie(link.DisplayName);
        await fixture.AddMovie("Unrelated offline file", available: false);
        await fixture.Service.ProcessPendingAsync();
        Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == replacement.Id.ToString("D"), "Startup must recover exact legacy titles even when unrelated library media is offline");

        var original = await fixture.AddMovie("Offline original", available: false);
        var alternative = await fixture.AddMovie("Offline original");
        var offlineLink = Link(original.Name); offlineLink.JellyfinItemId = original.Id.ToString("D"); fixture.Plugin.Configuration.MediaLinks.Add(offlineLink);
        var status = await fixture.Service.StatusAsync();
        Check(!status.Entries.Single(e => e.ReferenceId == offlineLink.Id).CanAutoRemap, "An original ID that remains in the library but is offline must stay for review");
        await fixture.Service.ProcessPendingAsync();
        Check(fixture.Plugin.Configuration.MediaLinks.Single(l => l.Id == offlineLink.Id).JellyfinItemId == original.Id.ToString("D"), "Scheduled recovery must never retarget an offline original to an available duplicate");
        fixture.Remove(original); await fixture.Service.ProcessPendingAsync();
        Check(fixture.Plugin.Configuration.MediaLinks.Single(l => l.Id == offlineLink.Id).JellyfinItemId == alternative.Id.ToString("D"), "A later periodic pass may reconnect after the original native ID has actually been removed");
    }

    private static async Task ExplicitPreferenceAndEndpoint()
    {
        using var fixture = new Fixture();
        var link = Link("Explicit Auto"); fixture.Plugin.Configuration.MediaLinks.Add(link);
        var movie = await fixture.AddMovie(link.DisplayName);
        fixture.Plugin.Configuration.MediaRecovery.AutoReconnect = false;
        await fixture.Service.ProcessPendingAsync();
        Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == link.JellyfinItemId, "Scheduled recovery must respect the automatic reconnect preference");
        var user = new User("Auto tester", "default", "default") { Id = Guid.NewGuid() };
        var users = DispatchProxy.Create<IUserManager, Proxy>(); ((Proxy)(object)users).Call = (method, _) => method.Name == "GetUserById" ? user : null;
        var controller = new FranchiseRecoveryController(fixture.Service, users) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        Check(await controller.Auto(default) is UnauthorizedResult, "Auto must reject an anonymous caller");
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("Jellyfin-UserId", user.Id.ToString()) }, "fixture"));
        Check(await controller.Auto(default) is UnauthorizedResult, "Auto must reject a non-administrator");
        user.SetPermission(PermissionKind.IsAdministrator, true);
        var response = await controller.Auto(default) as ContentResult;
        using var json = JsonDocument.Parse(response?.Content ?? "{}");
        Check(json.RootElement.GetProperty("remappedCount").GetInt32() == 1 && json.RootElement.GetProperty("status").GetProperty("healthyCount").GetInt32() == 1,
            "The administrator Auto endpoint must return web-cased status and the remapped reference count");
        Check(!fixture.Plugin.Configuration.MediaRecovery.AutoReconnect && fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == movie.Id.ToString("D"), "Explicit Auto must work without changing a disabled scheduled recovery preference");
        fixture.Plugin.Configuration.MediaRecovery.Enabled = false;
        Check(await controller.Auto(default) is ConflictObjectResult, "Explicit Auto must not implicitly enable disabled media recovery");
    }

    private static async Task AutomaticRollback()
    {
        using var fixture = new Fixture();
        var link = Link("Rollback title"); fixture.Plugin.Configuration.MediaLinks.Add(link);
        await fixture.AddMovie(link.DisplayName);
        var json = JsonSerializer.Serialize(new FranchiseTimelineController.TimelineProgress { ItemId = link.JellyfinItemId, QueueKeys = new() { "reference:" + link.JellyfinItemId }, PositionTicks = 123 }, JsonOptions);
        await File.WriteAllTextAsync(fixture.ProgressPath, json);
        fixture.FailSave = true;
        var rejected = false;
        try { await fixture.Service.AutoAsync(); } catch (IOException) { rejected = true; }
        Check(rejected && fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == link.JellyfinItemId && await File.ReadAllTextAsync(fixture.ProgressPath) == json,
            "A failed automatic configuration write must restore both the old reference and exact original timeline bytes");
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private sealed class Fixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "franchise-auto-recovery-" + Guid.NewGuid().ToString("N"));
        private readonly List<BaseItem> _media = new();
        public Plugin Plugin { get; }
        public FranchiseLibrarySnapshotService Snapshots { get; }
        public MediaRecoveryService Service { get; }
        public bool FailSave { get; set; }
        public string ProgressPath { get; }
        public Fixture()
        {
            Directory.CreateDirectory(_root);
            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>(); ((Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? _root : null;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>(); ((Proxy)(object)xml).Call = (method, _) =>
            { if (method.Name == "SerializeToFile" && FailSave) throw new IOException("Automatic recovery save failure"); return method.ReturnType == typeof(object) ? new PluginConfiguration() : null; };
            Plugin = new Plugin(paths, xml);
            var library = DispatchProxy.Create<ILibraryManager, Proxy>(); ((Proxy)(object)library).Call = (method, _) => method.Name == "GetItemList" ? _media : method.Name == "get_IsScanRunning" ? false : null;
            Snapshots = new FranchiseLibrarySnapshotService(library); Service = new MediaRecoveryService(library, Snapshots, NullLogger<MediaRecoveryService>.Instance);
            ProgressPath = Path.Combine(Plugin.DataFolderPath, "timeline-progress", Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N") + ".json"); Directory.CreateDirectory(Path.GetDirectoryName(ProgressPath)!);
        }
        public async Task<Movie> AddMovie(string title, bool available = true)
        {
            var path = Path.Combine(_root, Guid.NewGuid().ToString("N") + ".mp4"); if (available) await File.WriteAllTextAsync(path, "media");
            var movie = new Movie { Id = Guid.NewGuid(), Name = title, Path = path, ProductionYear = 2020, ProviderIds = new() { ["Imdb"] = "tt" + (_media.Count + 1000) } };
            _media.Add(movie); Snapshots.Invalidate(); return movie;
        }
        public MediaBrowser.Controller.Entities.TV.Series AddSeries(string title)
        {
            var series = new MediaBrowser.Controller.Entities.TV.Series { Id = Guid.NewGuid(), Name = title, Path = _root, ProductionYear = 2020, ProviderIds = new() { ["Imdb"] = "tt" + (_media.Count + 1000) } };
            _media.Add(series); Snapshots.Invalidate(); return series;
        }
        public void Remove(BaseItem item) { _media.Remove(item); Snapshots.Invalidate(); }
        public void Dispose() { Service.Dispose(); Directory.Delete(_root, true); }
    }
    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = (_, _) => null;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => method is null ? null : Call(method, args)
            ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null);
    }
}
