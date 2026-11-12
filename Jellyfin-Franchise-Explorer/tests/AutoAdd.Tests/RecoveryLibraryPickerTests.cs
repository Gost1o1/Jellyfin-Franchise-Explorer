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
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

internal static class RecoveryLibraryPickerTests
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }

    public static async Task Run()
    {
        await BrowseLibrary();
        await CorrectWrongSavedType();
        await RejectUnsafeTypeCorrections();
        ExactTitleSeparators();
        await EnforceAdministrator();
        Console.WriteLine("PASS recovery library picker: complete paged browsing, explicit type repair, preserved progress and metadata, evidence/range guards, revisions and administrator checks");
    }

    private static async Task BrowseLibrary()
    {
        using var fixture = new Fixture();
        var link = fixture.Link("Movie", "Old title");
        for (var index = 0; index < 55; index++) fixture.Add("Movie", $"Picker {index:00}");
        var series = fixture.Add("Series", "Picker series");
        fixture.Add("BoxSet", "Picker collection");
        var episode = fixture.Add("Episode", "Picker episode", series: series.Id);
        fixture.Add("Movie", "Picker offline", available: false);
        var status = await fixture.Service.StatusAsync();
        var before = MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration);
        var page = await fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision);
        Check(page.TotalRecordCount == 57 && page.StartIndex == 0 && page.Limit == 30 && page.Items.Count == 30,
            "Default recovery library browsing must page the complete available Movie/Series/BoxSet snapshot");
        Check(page.Items.All(i => i.ItemType != "Episode" && i.Title != "Picker offline"),
            "A normal media reference must not expose individual episodes or unavailable library files in its default browse results");
        var capped = await fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, limit: 200);
        Check(capped.Limit == 50 && capped.Items.Count == 50, "Recovery library browsing must cap requested pages at fifty items");
        var tail = await fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, startIndex: 51);
        Check(tail.TotalRecordCount == 57 && tail.StartIndex == 51 && tail.Items.Count == 6,
            "Recovery library paging must report the full filtered count and retain the requested offset");
        var empty = await fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, startIndex: 100);
        Check(empty.TotalRecordCount == 57 && empty.Items.Count == 0, "An offset beyond the available library must return an empty page with its total");
        var movies = await fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, itemType: "Movie", query: "  Picker 0  ");
        Check(movies.TotalRecordCount == 10 && movies.Items.All(i => i.ItemType == "Movie" && i.Title.StartsWith("Picker 0", StringComparison.Ordinal)),
            "Library type and trimmed title filters must apply before counting and pagination");
        var shows = await fixture.Service.CandidatesAsync(link.Id, "Picker", status.Revision, status.LibraryRevision, itemType: "Series");
        Check(shows.Count == 1 && shows[0].ItemType == "Series", "Candidate title search must accept an explicit media type for a wrongly typed reference");
        var defaultCandidates = await fixture.Service.CandidatesAsync(link.Id, "Picker", status.Revision, status.LibraryRevision);
        Check(defaultCandidates.All(i => i.ItemType == "Movie"), "Existing candidate searches must default to the saved reference type");
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, itemType: "Person")),
            "Unsupported library item types must fail server validation");
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, itemType: "Episode")),
            "A non-episode reference must not request an episode replacement through the browse endpoint");
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, startIndex: -1)),
            "Negative library offsets must fail server validation");
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision, limit: 0)),
            "Nonpositive library page limits must fail server validation");
        Check(MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration) == before && fixture.SaveCount == 0 && link.Identity is null,
            "GET library browsing and candidate search must not capture identities or save configuration");

        var savedEpisode = fixture.Link("Episode", "Old individual episode");
        status = await fixture.Service.StatusAsync();
        var episodes = await fixture.Service.LibraryAsync(savedEpisode.Id, status.Revision, status.LibraryRevision, itemType: "Episode");
        Check(episodes.Items.Single().ItemId == episode.Id.ToString("D"), "A saved individual episode may explicitly browse available individual episodes");
        var allForEpisode = await fixture.Service.LibraryAsync(savedEpisode.Id, status.Revision, status.LibraryRevision, limit: 50, query: "episode");
        Check(allForEpisode.Items.Any(i => i.ItemType == "Episode"), "All-types browsing must include episodes when repairing a saved individual episode");

        fixture.Plugin.Configuration.NavigationLabel = "Changed while browsing";
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision)),
            "Library browsing must reject a stale configuration revision");
        status = await fixture.Service.StatusAsync();
        fixture.Add("Movie", "New library content");
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision)),
            "Library browsing must force a fresh snapshot and reject a stale library revision");
        status = await fixture.Service.StatusAsync();
        fixture.Scanning = true;
        Check(await Rejects(() => fixture.Service.LibraryAsync(link.Id, status.Revision, status.LibraryRevision)),
            "Library browsing must reject an active library scan");
    }

    private static async Task CorrectWrongSavedType()
    {
        using var fixture = new Fixture();
        var link = fixture.Link("Series", "Captain America: The Winter Soldier");
        link.Identity = new() { ItemType = "Series", Year = 2014 };
        link.Position = 17;
        link.ViewingOrder = "Release";
        link.Artwork.LogoUrl = "/FranchiseExplorer/Artwork/Assets/my-logo";
        link.Artwork.PrimaryUrl = "/Items/" + link.JellyfinItemId + "/Images/Primary?tag=old";
        var row = new FranchiseRow { Name = "Marvel", ParentNodeId = "kept-node" };
        var entry = new FranchiseRowEntry { JellyfinItemId = link.JellyfinItemId, ItemType = "Series", DisplayName = "My movie label" };
        row.Items.Add(entry); row.MediaLinkIds.Add(link.Id); row.MediaOrder.Add(entry.Id); row.MediaOrder.Add(link.Id);
        fixture.Plugin.Configuration.Rows.Add(row);
        var movie = fixture.Add("Movie", "Captain America: The Winter Soldier", imdb: "tt1843866", year: 2014);
        var oldId = link.JellyfinItemId;
        var progressPath = fixture.WriteProgress(new FranchiseTimelineController.TimelineProgress
        {
            RowId = row.Id, ItemId = oldId, QueueKeys = new() { link.Id + ":" + oldId },
            QueueSourceItemIds = new() { oldId }, CompletedKeys = new() { entry.Id + ":" + oldId },
            QueueLengths = new() { 600 }, PositionTicks = 123456, Index = 0, Total = 1, PlaybackMode = "paused"
        });
        var status = await fixture.Service.StatusAsync();
        Check(!status.Entries.Any(e => e.CanAutoRemap), "A saved Series must never automatically match a Movie by title");
        var defaultCandidates = await fixture.Service.CandidatesAsync(link.Id, "Winter Soldier", status.Revision, status.LibraryRevision);
        Check(defaultCandidates.Count == 0, "Existing candidate search must retain the saved type until the administrator chooses another");
        var candidates = await fixture.Service.CandidatesAsync(link.Id, "Winter Soldier", status.Revision, status.LibraryRevision, itemType: "Movie");
        Check(candidates.Single().ItemId == movie.Id.ToString("D"), "The actual Captain America movie must be discoverable after choosing Movies");
        var before = MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration);
        Check(await Rejects(() => fixture.Service.ApplyAsync(Request(status, link.Id, movie.Id))),
            "A cross-type replacement must require the explicit CorrectItemType choice flag");
        Check(MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration) == before && fixture.SaveCount == 0,
            "Rejected type repair must leave every reference and configuration revision unchanged");
        await fixture.Service.ApplyAsync(Request(status, link.Id, movie.Id, correctType: true));
        var repaired = fixture.Plugin.Configuration.MediaLinks.Single();
        var repairedRow = fixture.Plugin.Configuration.Rows.Single();
        var repairedEntry = repairedRow.Items.Single();
        Check(repaired.JellyfinItemId == movie.Id.ToString("D") && repaired.ItemType == "Movie" && repaired.Identity?.ItemType == "Movie"
            && repaired.Identity.Year == 2014 && repaired.Identity.ProviderIds.Single().Value == "tt1843866",
            "Explicit type repair must replace both the saved item type and durable identity with the actual movie metadata");
        Check(repairedEntry.JellyfinItemId == repaired.JellyfinItemId && repairedEntry.ItemType == "Movie" && repairedEntry.Identity?.ItemType == "Movie",
            "Every compatible full-range reference to the same old native ID must be repaired consistently");
        Check(repaired.Id == link.Id && repaired.Position == 17 && repaired.ViewingOrder == "Release" && repaired.DisplayName == link.DisplayName
            && repaired.Artwork.LogoUrl == link.Artwork.LogoUrl && repaired.Artwork.PrimaryUrl.Contains(movie.Id.ToString("D"))
            && repairedEntry.Id == entry.Id && repairedEntry.DisplayName == "My movie label" && repairedRow.ParentNodeId == row.ParentNodeId
            && repairedRow.MediaOrder.SequenceEqual(row.MediaOrder) && repairedRow.MediaLinkIds.SequenceEqual(row.MediaLinkIds),
            "Type repair must preserve plugin IDs, presentation order, artwork and row membership");
        var progress = JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(await File.ReadAllTextAsync(progressPath), WebJson)!;
        Check(progress.ItemId == movie.Id.ToString("D") && progress.PositionTicks == 123456 && progress.QueueLengths.Single() == 600
            && progress.QueueKeys.Single() == link.Id + ":" + movie.Id.ToString("D") && progress.CompletedKeys.Single() == entry.Id + ":" + movie.Id.ToString("D"),
            "Explicit type repair must remap saved user progress while preserving position and completion metadata");

        using var agreeing = new Fixture();
        var agreeingLink = agreeing.Link("Series", "Same provider, old saved type");
        agreeingLink.Identity = new()
        {
            ItemType = "Series", Year = 2014, ProviderIds = new() { new() { Name = "Imdb", Value = "tt1843866" } }
        };
        var agreeingMovie = agreeing.Add("Movie", "Captain America: The Winter Soldier", imdb: "tt1843866", year: 2014);
        var agreeingStatus = await agreeing.Service.StatusAsync();
        await agreeing.Service.ApplyAsync(Request(agreeingStatus, agreeingLink.Id, agreeingMovie.Id, correctType: true));
        Check(agreeing.Plugin.Configuration.MediaLinks.Single().ItemType == "Movie"
            && agreeing.Plugin.Configuration.MediaLinks.Single().Identity?.ProviderIds.Single().Value == "tt1843866",
            "Explicit type repair may retain agreeing stable providers and year while replacing an incorrectly saved type");

        using var reused = new Fixture();
        var currentMovie = reused.Add("Movie", "Current movie saved as a show", imdb: "tt1843866", year: 2014);
        var reusedLink = reused.Link("Series", "Current movie saved as a show");
        reusedLink.JellyfinItemId = currentMovie.Id.ToString("D");
        reusedLink.Identity = new() { ItemType = "Series", Year = 2014, ProviderIds = new() { new() { Name = "Imdb", Value = "tt1843866" } } };
        var reusedRow = new FranchiseRow(); reusedRow.MediaLinkIds.Add(reusedLink.Id); reused.Plugin.Configuration.Rows.Add(reusedRow);
        var owner = new AutoFranchiseOwnership
        {
            RowId = reusedRow.Id, ReferenceId = reusedLink.Id, ItemId = reusedLink.JellyfinItemId,
            ItemType = "Series", ProviderId = "tt1843866", MediaKey = "Series:tt1843866"
        };
        reused.Plugin.Configuration.AutoFranchises.Ownership.Add(owner);
        owner.Signature = AutoFranchisePlanner.Signature(reused.Plugin.Configuration, owner);
        var reusedStatus = await reused.Service.StatusAsync();
        var currentPage = await reused.Service.LibraryAsync(reusedLink.Id, reusedStatus.Revision, reusedStatus.LibraryRevision, itemType: "Movie");
        Check(currentPage.Items.Single().ItemId == reusedLink.JellyfinItemId,
            "Library browsing must include a current native ID whose actual media type conflicts with the saved type");
        await reused.Service.ApplyAsync(Request(reusedStatus, reusedLink.Id, currentMovie.Id, correctType: true));
        var reusedRepair = reused.Plugin.Configuration.MediaLinks.Single();
        Check(reusedRepair.JellyfinItemId == currentMovie.Id.ToString("D") && reusedRepair.ItemType == "Movie" && reusedRepair.Identity?.ItemType == "Movie",
            "An explicit media type correction must work even when the Jellyfin native ID itself did not change");
        var repairedOwner = reused.Plugin.Configuration.AutoFranchises.Ownership.Single();
        Check(repairedOwner.ItemType == "Movie" && repairedOwner.MediaKey == "Movie:tt1843866"
            && repairedOwner.ProviderId == "tt1843866" && repairedOwner.Signature == AutoFranchisePlanner.Signature(reused.Plugin.Configuration, repairedOwner),
            "Matching unedited automation ownership must retain its provider while correcting its media type, media key and baseline");
    }

    private static async Task RejectUnsafeTypeCorrections()
    {
        foreach (var mode in new[] { "Seasons", "Episodes" })
        {
            using var fixture = new Fixture();
            var link = fixture.Link("Series", "Ranged show");
            link.RangeMode = mode; link.StartSeason = link.EndSeason = 1; link.StartEpisode = 2; link.EndEpisode = 3;
            var movie = fixture.Add("Movie", "Ranged show");
            await RejectCorrection(fixture, link.Id, movie.Id, "Ranged series references must never become movies");
        }
        using (var fixture = new Fixture())
        {
            var link = fixture.Link("Episode", "Individual episode");
            var movie = fixture.Add("Movie", "Individual episode");
            await RejectCorrection(fixture, link.Id, movie.Id, "Direct episode references must never change media type");
        }
        using (var fixture = new Fixture())
        {
            var node = new FranchiseNode { CollectionId = Guid.NewGuid().ToString("D"), Name = "Collection binding" };
            fixture.Plugin.Configuration.Nodes.Add(node);
            var movie = fixture.Add("Movie", "Collection binding");
            await RejectCorrection(fixture, "collection:" + node.Id, movie.Id, "Node collection bindings must always remain BoxSet references");
        }
        using (var fixture = new Fixture())
        {
            var link = fixture.Link("Series", "Stable identity conflict");
            link.Identity = new() { ItemType = "Series", ProviderIds = new() { new() { Name = "Imdb", Value = "tt999" } } };
            var movie = fixture.Add("Movie", "Stable identity conflict", imdb: "tt123");
            await RejectCorrection(fixture, link.Id, movie.Id, "Explicit type correction must not override conflicting stable provider evidence");
        }
        using (var fixture = new Fixture())
        {
            var link = fixture.Link("Series", "Known identity conflict");
            fixture.Plugin.Configuration.MediaRecovery.KnownItems.Add(new()
            {
                ItemId = link.JellyfinItemId,
                Identity = new() { ItemType = "Series", ProviderIds = new() { new() { Name = "Imdb", Value = "tt999" } } }
            });
            var movie = fixture.Add("Movie", "Known identity conflict", imdb: "tt123");
            await RejectCorrection(fixture, link.Id, movie.Id, "Explicit type correction must respect conflicting retained identity snapshots");
        }
        using (var fixture = new Fixture())
        {
            var link = fixture.Link("Series", "Saved year conflict");
            link.Identity = new() { ItemType = "Series", Year = 2014 };
            var movie = fixture.Add("Movie", "Saved year conflict", year: 2020);
            await RejectCorrection(fixture, link.Id, movie.Id, "Explicit type correction must not override a conflicting saved production year");
        }
        using (var fixture = new Fixture())
        {
            var link = fixture.Link("Series", "Ownership conflict");
            var row = new FranchiseRow(); row.MediaLinkIds.Add(link.Id); fixture.Plugin.Configuration.Rows.Add(row);
            fixture.Plugin.Configuration.AutoFranchises.Ownership.Add(new()
            {
                ReferenceId = link.Id, RowId = row.Id, ItemId = link.JellyfinItemId, ItemType = "Series", ProviderId = "tt999"
            });
            var movie = fixture.Add("Movie", "Ownership conflict", imdb: "tt123");
            await RejectCorrection(fixture, link.Id, movie.Id, "Explicit type correction must respect conflicting automation ownership evidence");
        }
        using (var fixture = new Fixture())
        {
            var link = fixture.Link("Series", "Shared ranged reference");
            fixture.Plugin.Configuration.Rows.Add(new() { Items = new() { new()
            {
                JellyfinItemId = link.JellyfinItemId, ItemType = "Series", DisplayName = "Keep this episode range", RangeMode = "Episodes",
                StartSeason = 1, EndSeason = 1, StartEpisode = 1, EndEpisode = 3
            } } });
            var movie = fixture.Add("Movie", "Shared ranged reference");
            await RejectCorrection(fixture, link.Id, movie.Id, "A shared old native ID must not silently convert another reference's episode range");
        }
        using (var fixture = new Fixture())
        {
            var first = fixture.Link("Series", "Conflicting choices");
            var second = fixture.Link("Series", "Another label"); second.JellyfinItemId = first.JellyfinItemId;
            var firstMovie = fixture.Add("Movie", "First choice"); var secondMovie = fixture.Add("Movie", "Second choice");
            var status = await fixture.Service.StatusAsync();
            var request = Request(status, first.Id, firstMovie.Id, correctType: true);
            request.Choices.Add(new() { ReferenceId = second.Id, ItemId = secondMovie.Id.ToString("D"), CorrectItemType = true });
            var before = MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration);
            Check(await Rejects(() => fixture.Service.ApplyAsync(request)) && MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration) == before,
                "References sharing an old native ID must reject contradictory replacement choices atomically");
        }
    }

    private static void ExactTitleSeparators()
    {
        static AutomationLibraryItem Movie(string title, string type = "Movie", int year = 1977, bool available = true) => new()
        {
            Id = Guid.NewGuid().ToString("D"), Name = title, ItemType = type, Year = year, IsAvailable = available
        };
        var config = new PluginConfiguration();
        config.MediaLinks.Add(new()
        {
            JellyfinItemId = Guid.NewGuid().ToString("D"), ItemType = "Movie", DisplayName = "Star Wars Episode IV A New Hope",
            Identity = new() { ItemType = "Movie", Year = 1977 }
        });
        static MediaRecoveryEntry Review(PluginConfiguration config, params AutomationLibraryItem[] items)
            => MediaRecoveryPlanner.Review(config, new(items, "punctuation-library", true, "Healthy")).Entries.Single();
        var punctuation = Movie("Star Wars: Episode IV – A New Hope");
        Check(Review(config, punctuation) is { CanAutoRemap: true, Status: "Verified" },
            "Colon and dash title separators may reconnect the same complete title word sequence with matching type and year");
        foreach (var different in new[]
        {
            Movie("Star Wars A New Hope Episode IV"), Movie("Star Wars Episode IV"),
            Movie("Star Wars: Episode IV – A New Hope", type: "Series"), Movie("Star Wars: Episode IV – A New Hope", year: 1997)
        })
            Check(!Review(config, different).CanAutoRemap && Review(config, different).Candidates.Count == 0,
                "Separator normalization must not permit reordered/partial words, another media type or another saved year");
        Check(Review(config, punctuation, Movie("Star Wars · Episode IV: A New Hope")).Status == "Ambiguous",
            "Duplicate complete titles that differ only in accepted separators still require an explicit version choice");
        Check(Review(config, punctuation, Movie("Star Wars · Episode IV: A New Hope", available: false)).Status == "Ambiguous",
            "An offline duplicate title must remain ambiguous after title separator normalization");
    }

    private static async Task EnforceAdministrator()
    {
        using var fixture = new Fixture();
        var link = fixture.Link("Series", "Wrong type"); fixture.Add("Movie", "Replacement");
        var status = await fixture.Service.StatusAsync();
        var user = new User("library picker tester", "default", "default") { Id = Guid.NewGuid() };
        var users = DispatchProxy.Create<IUserManager, Proxy>();
        ((Proxy)(object)users).Call = (method, _) => method.Name == "GetUserById" ? user : null;
        var controller = new FranchiseRecoveryController(fixture.Service, users)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var endpoint = typeof(FranchiseRecoveryController).GetMethod("Library") ?? throw new Exception("Recovery library endpoint is missing");
        Check(endpoint.GetCustomAttributes<HttpGetAttribute>().Any(a => a.Template == "Library"), "Library browsing must be exposed as an admin GET route");
        Check(await InvokeLibrary(endpoint, controller, link.Id, status) is UnauthorizedResult, "The library endpoint must reject a missing Jellyfin user");
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("Jellyfin-UserId", user.Id.ToString()) }, "fixture"));
        Check(await InvokeLibrary(endpoint, controller, link.Id, status) is UnauthorizedResult, "The library endpoint must reject a verified non-administrator");
        user.SetPermission(PermissionKind.IsAdministrator, true);
        var result = await InvokeLibrary(endpoint, controller, link.Id, status);
        Check(result is ContentResult { ContentType: "application/json; charset=utf-8" }, "The library endpoint must provide its administrator a web JSON response");
        using var json = JsonDocument.Parse(((ContentResult)result).Content!);
        Check(json.RootElement.GetProperty("items").GetArrayLength() == 1 && json.RootElement.GetProperty("totalRecordCount").GetInt32() == 1
            && json.RootElement.GetProperty("startIndex").GetInt32() == 0 && json.RootElement.GetProperty("limit").GetInt32() == 30,
            "The library endpoint must use the agreed camel-case paged candidate contract");
        Check(controller.Response.Headers.CacheControl == "no-store" && fixture.SaveCount == 0 && link.Identity is null,
            "Admin library browsing must prohibit response caching and configuration writes");
    }

    private static async Task<IActionResult> InvokeLibrary(MethodInfo endpoint, FranchiseRecoveryController controller, string referenceId, MediaRecoveryStatus status)
    {
        var arguments = endpoint.GetParameters().Select(parameter => parameter.Name switch
        {
            "referenceId" => (object?)referenceId,
            "revision" => status.Revision,
            "libraryRevision" => status.LibraryRevision,
            "startIndex" => 0,
            "limit" => 30,
            "cancellationToken" => default(CancellationToken),
            _ => null
        }).ToArray();
        return await (Task<IActionResult>)endpoint.Invoke(controller, arguments)!;
    }

    private static async Task RejectCorrection(Fixture fixture, string referenceId, Guid target, string reason)
    {
        var status = await fixture.Service.StatusAsync();
        var before = MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration);
        Check(await Rejects(() => fixture.Service.ApplyAsync(Request(status, referenceId, target, correctType: true))), reason);
        Check(MediaRecoveryPlanner.Revision(fixture.Plugin.Configuration) == before && fixture.SaveCount == 0, reason + ": rejection must be atomic");
    }

    private static MediaRecoveryApplyRequest Request(MediaRecoveryStatus status, string referenceId, Guid itemId, bool correctType = false) => new()
    {
        Revision = status.Revision, LibraryRevision = status.LibraryRevision,
        Choices = new() { new() { ReferenceId = referenceId, ItemId = itemId.ToString("D"), CorrectItemType = correctType } }
    };

    private static async Task<bool> Rejects(Func<Task> action)
    {
        try { await action(); return false; }
        catch (ArgumentException) { return true; }
        catch (InvalidOperationException) { return true; }
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "franchise-library-picker-" + Guid.NewGuid().ToString("N"));
        private readonly List<BaseItem> _media = new();
        public Plugin Plugin { get; }
        public FranchiseLibrarySnapshotService Snapshots { get; }
        public MediaRecoveryService Service { get; }
        public bool Scanning { get; set; }
        public int SaveCount { get; private set; }

        public Fixture()
        {
            Directory.CreateDirectory(_root);
            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>();
            ((Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? _root : null;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>();
            ((Proxy)(object)xml).Call = (method, _) =>
            {
                if (method.Name == "SerializeToFile") SaveCount++;
                return method.ReturnType == typeof(object) ? new PluginConfiguration() : null;
            };
            Plugin = new Plugin(paths, xml);
            var library = DispatchProxy.Create<ILibraryManager, Proxy>();
            ((Proxy)(object)library).Call = (method, _) => method.Name == "GetItemList" ? _media : method.Name == "get_IsScanRunning" ? Scanning : null;
            Snapshots = new FranchiseLibrarySnapshotService(library);
            Service = new MediaRecoveryService(library, Snapshots, NullLogger<MediaRecoveryService>.Instance);
        }

        public MediaLink Link(string type, string title)
        {
            var link = new MediaLink { JellyfinItemId = Guid.NewGuid().ToString("D"), ItemType = type, DisplayName = title };
            Plugin.Configuration.MediaLinks.Add(link);
            return link;
        }

        public BaseItem Add(string type, string name, string? imdb = null, int year = 2020, bool available = true, Guid? series = null)
        {
            BaseItem item = type switch
            {
                "Movie" => new Movie(), "Series" => new Series(), "Episode" => new Episode { SeriesId = series ?? Guid.Empty, ParentIndexNumber = 1, IndexNumber = 1 },
                "BoxSet" => new BoxSet(), _ => throw new ArgumentException("Unknown fixture type")
            };
            item.Id = Guid.NewGuid(); item.Name = name; item.ProductionYear = year;
            if (imdb is not null) item.ProviderIds = new() { ["Imdb"] = imdb };
            if (type == "Series")
            {
                item.Path = Path.Combine(_root, item.Id.ToString("N"));
                if (available) Directory.CreateDirectory(item.Path);
            }
            else if (type != "BoxSet")
            {
                item.Path = Path.Combine(_root, item.Id.ToString("N") + ".mp4");
                if (available) File.WriteAllText(item.Path, "fixture media");
            }
            _media.Add(item); Snapshots.Invalidate();
            return item;
        }

        public string WriteProgress(FranchiseTimelineController.TimelineProgress progress)
        {
            var path = Path.Combine(Plugin.DataFolderPath, "timeline-progress", Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N") + ".json");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(progress, WebJson));
            return path;
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
