using System.Reflection;
using System.Text.Json;
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
using Microsoft.Extensions.Logging.Abstractions;

internal static class RecoveryFailureRegressionTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static AutomationLibraryItem Item(string type = "Movie", string imdb = "tt123") => new()
    {
        Id = Guid.NewGuid().ToString("D"), Name = "Moved title", ItemType = type, Year = 2020,
        ProviderIds = new() { ["Imdb"] = imdb }, IsAvailable = true
    };
    private static MediaLink Link(AutomationLibraryItem old, bool snapshot = false) => new()
    {
        JellyfinItemId = old.Id, ItemType = old.ItemType, DisplayName = old.Name,
        Identity = snapshot ? MediaRecoveryPlanner.Capture(old) : null
    };
    private static FranchiseLibrarySnapshot Library(params AutomationLibraryItem[] items) => new(items, "regression-library", true, "Healthy");
    private static MediaRecoveryEntry Review(PluginConfiguration config, params AutomationLibraryItem[] items)
        => MediaRecoveryPlanner.Review(config, Library(items)).Entries.Single();

    private static (PluginConfiguration Config, MediaLink Link, FranchiseAutoAddRecord Record) Legacy(AutomationLibraryItem old, params string[] imdbIds)
    {
        var config = new PluginConfiguration();
        var node = new FranchiseNode();
        var link = Link(old); link.NodeId = node.Id;
        var record = new FranchiseAutoAddRecord { ReferenceId = link.Id, ImdbIds = imdbIds.ToList() };
        config.Nodes.Add(node); config.MediaLinks.Add(link); node.AutoAddRecords.Add(record);
        record.Signature = MediaRecoveryPlanner.LegacySignature(config, record);
        return (config, link, record);
    }

    public static async Task Run()
    {
        LegacyIdentities();
        OwnershipIdentities();
        PausedReviews();
        await ExplicitRecoveryWithUnrelatedOfflineMedia();
        await StartupCatchupAndRetry();
        Console.WriteLine("PASS recovery failure regressions: pre-snapshot imports, stale evidence, paused reviews, explicit offline-library recovery and startup retry");
    }

    private static void LegacyIdentities()
    {
        var old = Item(); var replacement = Item();
        var (config, link, record) = Legacy(old, "tt123");
        Check(Review(config, replacement).Status == "Verified", "A moved legacy movie must use its saved IMDb import identity even when recovery was installed after the move");
        link.DisplayName = "My custom title"; link.Artwork.LogoUrl = "/FranchiseExplorer/Artwork/Assets/kept";
        Check(Review(config, replacement).Status == "Verified", "Editing a title or custom artwork must not discard the original imported item identity");
        Check(Review(config, replacement, Item()).Status == "Ambiguous", "Several versions of a legacy movie must remain an explicit version choice");
        link.JellyfinItemId = Guid.NewGuid().ToString("D");
        Check(Review(config, replacement).Status == "ManualReview", "A manually retargeted reference must not reuse the previous import's IMDb evidence");
        link.JellyfinItemId = old.Id; link.ItemType = "Series";
        Check(Review(config, Item("Series")).Status == "ManualReview", "A changed media type must not reuse an old import fingerprint");
        link.ItemType = "Movie"; record.Signature = "";
        Check(Review(config, replacement).Status == "ManualReview", "Legacy evidence without a saved item baseline must require explicit selection");
        record.Signature = "{damaged";
        Check(Review(config, replacement).Status == "ManualReview", "A damaged import fingerprint must retain the reference for manual review");
        record.Signature = MediaRecoveryPlanner.LegacySignature(config, record);
        record.ImdbIds.Add("tt999");
        Check(Review(config, replacement, Item(imdb: "tt999")).Status == "ManualReview", "Conflicting movie provider evidence must not choose the first imported ID");
        record.ImdbIds.Remove("tt999"); record.RowId = Guid.NewGuid().ToString("D");
        Check(Review(config, replacement).Status == "ManualReview", "An import record attached to another row must not supply identity evidence");

        var reusedId = Item(imdb: "tt999"); reusedId.Id = old.Id;
        var reused = Legacy(old, "tt123");
        MediaRecoveryPlanner.CaptureSnapshots(reused.Config, new[] { reusedId, replacement });
        Check(Review(reused.Config, reusedId, replacement).Status == "ManualReview"
            && reused.Link.Identity is null && reused.Config.MediaRecovery.KnownItems.All(i => MediaRecoveryPlanner.Id(i.ItemId) != MediaRecoveryPlanner.Id(old.Id)),
            "Capturing a reused native ID must preserve conflicting historical provider evidence for explicit review");

        var oldShow = Item("Series", "tt777"); var newShow = Item("Series", "tt777");
        var newEpisode = Item("Episode", "tt778");
        newEpisode.SeriesId = newShow.Id; newEpisode.SeriesProviderIds = new() { ["Imdb"] = "tt777" };
        newEpisode.SeasonNumber = 1; newEpisode.EpisodeNumber = 2;
        var series = Legacy(oldShow, "tt778");
        series.Link.RangeMode = "Episodes"; series.Link.StartSeason = series.Link.EndSeason = 1;
        series.Link.StartEpisode = series.Link.EndEpisode = 2;
        Check(Review(series.Config, newShow, newEpisode).Status == "Verified", "Consistent legacy episode import IDs must recover their exact parent series");
        series.Record.ImdbIds.Add("tt404");
        Check(Review(series.Config, newShow, newEpisode).Status == "ManualReview", "Partially unresolved legacy series evidence must not guess a show parent");

        var episode = Legacy(Item("Episode", "tt778"), "tt778");
        Check(Review(episode.Config, newShow, newEpisode).Status == "Verified", "A legacy individual episode must recover from its exact IMDb ID and consistent parent coordinates");
        var conflictingEpisode = Item("Episode", "tt778");
        conflictingEpisode.SeriesId = newShow.Id; conflictingEpisode.SeriesProviderIds = new() { ["Imdb"] = "tt777" };
        conflictingEpisode.SeasonNumber = 1; conflictingEpisode.EpisodeNumber = 3;
        Check(Review(episode.Config, newShow, newEpisode, conflictingEpisode).Status == "ManualReview", "A reused episode IMDb ID with conflicting coordinates must not manufacture a durable identity");
        conflictingEpisode.EpisodeNumber = 2;
        Check(Review(episode.Config, newShow, newEpisode, conflictingEpisode).Status == "Ambiguous", "Duplicate episode versions sharing one exact identity still require explicit review");

        var manual = new PluginConfiguration(); manual.MediaLinks.Add(Link(old));
        var manualStatus = Review(manual, replacement);
        Check(manualStatus is { Status: "Verified", CanAutoRemap: true } && manualStatus.Candidates.Count == 1, "One unique exact title and type can reconnect an old manual reference with no provider evidence");
    }

    private static void OwnershipIdentities()
    {
        var old = Item(); var replacement = Item(); var config = new PluginConfiguration();
        var row = new FranchiseRow(); config.Rows.Add(row);
        var entry = new FranchiseRowEntry { JellyfinItemId = old.Id, ItemType = "Movie", DisplayName = "Imported movie" };
        row.Items.Add(entry); row.MediaOrder.Add(entry.Id);
        var owner = new AutoFranchiseOwnership
        {
            RowId = row.Id, ReferenceId = entry.Id, ItemId = old.Id, ItemType = "Movie", ProviderId = "tt123"
        };
        config.AutoFranchises.Ownership.Add(owner); owner.Signature = AutoFranchisePlanner.Signature(config, owner);
        Check(Review(config, replacement).Status == "Verified", "Pre-snapshot automation ownership must preserve a moved movie's provider identity");
        entry.DisplayName = "My title"; entry.Artwork.PrimaryUrl = "/FranchiseExplorer/Artwork/Assets/custom";
        Check(Review(config, replacement).Status == "Verified", "Presentation edits must preserve ownership identity when the saved item and type are unchanged");
        entry.JellyfinItemId = Guid.NewGuid().ToString("D");
        Check(Review(config, replacement).Status == "ManualReview", "Retargeted automation ownership must not recover the former item");
        entry.JellyfinItemId = old.Id; owner.RowId = Guid.NewGuid().ToString("D");
        Check(Review(config, replacement).Status == "ManualReview", "Ownership outside the current presentation row must not supply a provider identity");
        owner.RowId = row.Id; owner.ItemType = "Series";
        Check(Review(config, replacement).Status == "ManualReview", "Ownership with the wrong saved item type must not supply identity");
        owner.ItemType = "Movie";
        config.AutoFranchises.Ownership.Add(new()
        {
            RowId = row.Id, ReferenceId = entry.Id, ItemId = old.Id, ItemType = "Movie", ProviderId = "tt999"
        });
        Check(Review(config, replacement, Item(imdb: "tt999")).Status == "ManualReview", "Conflicting ownership identities must require review instead of selecting a replacement");

        var linked = new PluginConfiguration(); var linkedRow = new FranchiseRow(); linked.Rows.Add(linkedRow);
        var link = Link(old); linked.MediaLinks.Add(link); linkedRow.MediaLinkIds.Add(link.Id);
        var linkedOwner = new AutoFranchiseOwnership
        {
            RowId = linkedRow.Id, ReferenceId = link.Id, ItemId = old.Id, ItemType = "Movie", ProviderId = "tt123"
        };
        linked.AutoFranchises.Ownership.Add(linkedOwner); linkedOwner.Signature = AutoFranchisePlanner.Signature(linked, linkedOwner);
        Check(Review(linked, replacement).Status == "Verified", "Ownership for a row's linked timeline item must resolve even though the link itself has no RowId");
        linkedRow.MediaLinkIds.Clear();
        Check(Review(linked, replacement).Status == "ManualReview", "A detached link must not reuse ownership from a row that no longer contains it");
    }

    private static void PausedReviews()
    {
        var config = new PluginConfiguration(); config.MediaLinks.Add(Link(Item(), snapshot: true));
        config.Rows.Add(new() { Items = new() { new() { JellyfinItemId = Guid.NewGuid().ToString("D"), DisplayName = "Manual old item" } } });
        var paused = MediaRecoveryPlanner.Review(config, new([], "scanning:1", false, "Wait for the Jellyfin library scan to finish."));
        Check(paused.Entries.Count == 2 && paused.ReferenceCount == 2 && paused.AttentionCount == 2 && paused.HealthyCount == 0,
            "A paused scan must still report every saved reference and accurate recovery counts");
        Check(!paused.CanSearch && !paused.LibraryHealthy && paused.Message.Contains("scan", StringComparison.OrdinalIgnoreCase),
            "Paused recovery must expose why replacements cannot be selected yet");
    }

    private static async Task ExplicitRecoveryWithUnrelatedOfflineMedia()
    {
        using var fixture = new Fixture();
        var old = Item(); var link = Link(old, snapshot: true);
        link.DisplayName = "My preserved title"; link.Position = 19;
        link.Artwork.LogoUrl = "/FranchiseExplorer/Artwork/Assets/preserved";
        fixture.Plugin.Configuration.MediaLinks.Add(link);
        var replacement = await fixture.AddMovie("tt123", "Available replacement");
        await fixture.AddMovie("tt999", "Unrelated offline movie", available: false);
        var status = await fixture.Service.CheckAsync();
        Check(!status.LibraryHealthy && status.CanSearch && status.ReferenceCount == 1 && status.AttentionCount == 1,
            "An unrelated offline file must keep available replacement recovery and complete reference counts available");
        var candidates = await fixture.Service.CandidatesAsync(link.Id, "Available", status.Revision, status.LibraryRevision);
        Check(candidates.Single().ItemId == replacement.Id.ToString("D") && candidates.Single().Verified,
            "An administrator must be able to find an available verified replacement while unrelated media is offline");
        var request = Request(status, link.Id, replacement.Id.ToString("D"));
        Check(status.Entries.Single().CanAutoRemap, "An unrelated offline item must not block a clear replacement for a removed saved ID");
        await fixture.Service.ApplyAsync(request);
        var restored = fixture.Plugin.Configuration.MediaLinks.Single();
        Check(restored.JellyfinItemId == replacement.Id.ToString("D") && restored.Id == link.Id && restored.DisplayName == link.DisplayName
            && restored.Position == 19 && restored.Artwork.LogoUrl == link.Artwork.LogoUrl,
            "Explicit recovery must update the native ID while preserving plugin metadata and custom artwork");
        fixture.Scanning = true;
        status = await fixture.Service.CheckAsync();
        Check(!status.CanSearch && status.Entries.Count == 1, "An active scan must block candidate selection without hiding saved references");
        Check(await Rejects(async () => { await fixture.Service.CandidatesAsync(link.Id, "Available", status.Revision, status.LibraryRevision); }),
            "Candidate search must reject an active scan even if the previous snapshot was searchable");
    }

    private static async Task StartupCatchupAndRetry()
    {
        using (var fixture = new Fixture())
        {
            var old = Item(); fixture.Plugin.Configuration.MediaLinks.Add(Link(old, snapshot: true));
            var replacement = await fixture.AddMovie("tt123", "Startup replacement");
            await fixture.Service.ProcessPendingAsync();
            Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == replacement.Id.ToString("D"),
                "Startup must reconnect an already missing reference with one verified match without requiring a new library event");
            var revision = fixture.Plugin.Configuration.ConfigurationRevision;
            await fixture.Service.ProcessPendingAsync();
            Check(fixture.Plugin.Configuration.ConfigurationRevision == revision, "A settled startup pass must not keep rewriting configuration");
        }
        using (var fixture = new Fixture())
        {
            var old = Item(); fixture.Plugin.Configuration.MediaLinks.Add(Link(old, snapshot: true));
            var replacement = await fixture.AddMovie("tt123", "Deferred replacement");
            var offline = await fixture.AddMovie("tt999", "Drive returns later", available: false);
            await fixture.Service.ProcessPendingAsync();
            Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == replacement.Id.ToString("D"),
                "An unrelated offline item must not prevent startup from reconnecting a removed ID to a verified available replacement");
            await File.WriteAllTextAsync(offline.Path, "restored"); fixture.Snapshots.Invalidate();
            await fixture.Service.ProcessPendingAsync();
            Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == replacement.Id.ToString("D"),
                "A later retry after unrelated storage returns must retain the successful replacement");
        }
        using (var fixture = new Fixture())
        {
            var old = Item(); fixture.Plugin.Configuration.MediaLinks.Add(Link(old, snapshot: true));
            var replacement = await fixture.AddMovie("tt123", "After-scan replacement");
            fixture.Scanning = true; await fixture.Service.ProcessPendingAsync();
            Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == old.Id, "Startup must not reconnect while Jellyfin is scanning");
            fixture.Scanning = false; fixture.Snapshots.Invalidate(); await fixture.Service.ProcessPendingAsync();
            Check(fixture.Plugin.Configuration.MediaLinks.Single().JellyfinItemId == replacement.Id.ToString("D"),
                "A startup check deferred by a scan must resume when the completed library is available");
        }
    }

    private static MediaRecoveryApplyRequest Request(MediaRecoveryStatus status, string referenceId, string itemId) => new()
    {
        Revision = status.Revision, LibraryRevision = status.LibraryRevision,
        Choices = new() { new() { ReferenceId = referenceId, ItemId = itemId } }
    };
    private static async Task<bool> Rejects(Func<Task> action)
    {
        try { await action(); return false; }
        catch (InvalidOperationException) { return true; }
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "franchise-recovery-failure-" + Guid.NewGuid().ToString("N"));
        private readonly List<BaseItem> _media = new();
        public Plugin Plugin { get; }
        public FranchiseLibrarySnapshotService Snapshots { get; }
        public MediaRecoveryService Service { get; }
        public bool Scanning { get; set; }
        public Fixture()
        {
            Directory.CreateDirectory(_root);
            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>();
            ((Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? _root : null;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>();
            ((Proxy)(object)xml).Call = (method, _) => method.ReturnType == typeof(object) ? new PluginConfiguration() : null;
            Plugin = new Plugin(paths, xml);
            var library = DispatchProxy.Create<ILibraryManager, Proxy>();
            ((Proxy)(object)library).Call = (method, _) => method.Name == "GetItemList" ? _media : method.Name == "get_IsScanRunning" ? Scanning : null;
            Snapshots = new FranchiseLibrarySnapshotService(library);
            Service = new MediaRecoveryService(library, Snapshots, NullLogger<MediaRecoveryService>.Instance);
        }
        public async Task<Movie> AddMovie(string imdb, string name, bool available = true)
        {
            var path = Path.Combine(_root, Guid.NewGuid().ToString("N") + ".mp4");
            if (available) await File.WriteAllTextAsync(path, "media");
            var movie = new Movie { Id = Guid.NewGuid(), Name = name, Path = path, ProductionYear = 2020, ProviderIds = new() { ["Imdb"] = imdb } };
            _media.Add(movie); Snapshots.Invalidate(); return movie;
        }
        public void Dispose() { Service.Dispose(); Directory.Delete(_root, recursive: true); }
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = (_, _) => null;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
            => method is null ? null : Call(method, args) ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null);
    }
}
