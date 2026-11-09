using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Xml.Serialization;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.FranchiseExplorer;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using Jellyfin.Plugin.FranchiseExplorer.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

internal static class MediaRecoveryTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static AutomationLibraryItem Item(string type = "Movie", string imdb = "tt123", string? id = null) => new()
    { Id = id ?? Guid.NewGuid().ToString("D"), Name = "A title", ItemType = type, Year = 2020, ProviderIds = new() { ["Imdb"] = imdb }, IsAvailable = true };
    private static FranchiseLibrarySnapshot Library(params AutomationLibraryItem[] items) => new(items, "library-version", true, "Healthy");
    private static MediaLink Link(AutomationLibraryItem old) => new() { JellyfinItemId = old.Id, ItemType = old.ItemType, DisplayName = old.Name, Identity = MediaRecoveryPlanner.Capture(old) };

    public static async Task Run()
    {
        var old = Item(); var replacement = Item(); var config = new PluginConfiguration(); var link = Link(old); config.MediaLinks.Add(link);
        Check(MediaRecoveryPlanner.Review(config, Library(replacement)).Entries.Single().Status == "Verified", "One exact provider match should be verified after an ID changes");
        Check(MediaRecoveryPlanner.Review(config, Library(replacement, Item())).Entries.Single().Status == "Ambiguous", "Different versions with the same provider identity require explicit review");
        Check(MediaRecoveryPlanner.Review(config, Library(Item(imdb: "tt999"))).Entries.Single().Status == "Missing", "A known conflicting provider must not fall back to title and year");
        Check(!MediaRecoveryPlanner.Verified(link.Identity, Item("Series")), "Provider matches must also match media type");
        var wrongYear = Item(); wrongYear.Year = 2021;
        Check(!MediaRecoveryPlanner.Verified(link.Identity, wrongYear), "Known production years must agree");
        replacement.IsAvailable = false;
        Check(!MediaRecoveryPlanner.Verified(link.Identity, replacement), "An offline replacement cannot reconnect a reference"); replacement.IsAvailable = true;
        link.Identity = null;
        Check(MediaRecoveryPlanner.Review(config, Library(replacement)).Entries.Single().Status == "ManualReview", "Legacy manual media without identity must not be guessed from title"); link.Identity = MediaRecoveryPlanner.Capture(old);
        var polluted = Item(); polluted.ProviderIds["Path"] = "/private/library"; polluted.ProviderIds["Tmdb"] = "token=secret";
        Check(MediaRecoveryPlanner.Capture(polluted).ProviderIds.Count == 1, "Snapshots store validated provider identity without paths or tokens");

        var oldShow = Item("Series", "tt777"); var newShow = Item("Series", "tt777");
        var oldEpisode = Item("Episode", "tt778"); oldEpisode.SeriesId = oldShow.Id; oldEpisode.SeriesProviderIds = new() { ["Imdb"] = "tt777" }; oldEpisode.SeasonNumber = 1; oldEpisode.EpisodeNumber = 2;
        var newEpisode = Item("Episode", "tt778"); newEpisode.SeriesId = newShow.Id; newEpisode.SeriesProviderIds = new() { ["Imdb"] = "tt777" }; newEpisode.SeasonNumber = 1; newEpisode.EpisodeNumber = 2;
        Check(MediaRecoveryPlanner.Verified(MediaRecoveryPlanner.Capture(oldEpisode), newEpisode), "Episodes require stable parent series identity and exact coordinates");
        newEpisode.EpisodeNumber = 3;
        Check(!MediaRecoveryPlanner.Verified(MediaRecoveryPlanner.Capture(oldEpisode), newEpisode), "A different episode cannot reuse a provider identity"); newEpisode.EpisodeNumber = 2;
        newEpisode.SeriesProviderIds["Imdb"] = "tt888";
        Check(!MediaRecoveryPlanner.Verified(MediaRecoveryPlanner.Capture(oldEpisode), newEpisode), "An episode with a conflicting series cannot reconnect"); newEpisode.SeriesProviderIds["Imdb"] = "tt777";
        var legacy = new PluginConfiguration(); var range = Link(oldShow); range.Identity = null; range.RangeMode = "Episodes"; range.StartSeason = range.EndSeason = 1; range.StartEpisode = 2; range.EndEpisode = 3;
        legacy.MediaLinks.Add(range); var node = new FranchiseNode(); legacy.Nodes.Add(node); node.AutoAddRecords.Add(new() { ReferenceId = range.Id, ImdbIds = new() { "tt778" } });
        Check(MediaRecoveryPlanner.Review(legacy, Library(newShow, newEpisode)).Entries.Single().Status == "Verified", "Consistent legacy episode IDs may recover their exact show parent");
        node.AutoAddRecords[0].ImdbIds.Add("tt404");
        Check(MediaRecoveryPlanner.Review(legacy, Library(newShow, newEpisode)).Entries.Single().Status == "ManualReview", "Unresolved legacy evidence must not infer a show parent");

        config.Nodes.Add(new FranchiseNode { Id = "collection-node", CollectionId = old.Id });
        var row = new FranchiseRow { Items = new() { new() { JellyfinItemId = old.Id, Identity = MediaRecoveryPlanner.Capture(old), DisplayName = "manual title", RangeMode = "Episodes", StartSeason = 2, EndSeason = 2, StartEpisode = 3, EndEpisode = 7 } } };
        config.Rows.Add(row); row.MediaLinkIds.Add(link.Id); row.MediaOrder.Add(row.Items[0].Id); row.MediaOrder.Add(link.Id); row.NodeIds.Add(config.Nodes[0].Id);
        link.Position = 9; link.ViewingOrder = "Custom"; link.RangeMode = "Seasons"; link.StartSeason = 2; link.EndSeason = 4;
        link.Artwork.PrimaryUrl = "/Items/" + old.Id + "/Images/Primary?tag=existing"; link.Artwork.LogoUrl = "/FranchiseExplorer/Artwork/Assets/custom"; link.Artwork.BackdropVideoItemId = old.Id;
        var clean = new FranchiseAutoAddRecord { ReferenceId = link.Id }; var edited = new FranchiseAutoAddRecord { ReferenceId = row.Items[0].Id, RowId = row.Id, Signature = "{\"changed\":true}" }; config.Nodes[0].AutoAddRecords.Add(clean); config.Nodes[0].AutoAddRecords.Add(edited);
        clean.Signature = MediaRecoveryPlanner.LegacySignature(config, clean);
        var ownership = new AutoFranchiseOwnership { RowId = row.Id, ReferenceId = link.Id, ItemId = old.Id, EpisodeIds = new() { old.Id } }; config.AutoFranchises.Ownership.Add(ownership); ownership.Signature = AutoFranchisePlanner.Signature(config, ownership);
        var changedOwner = new AutoFranchiseOwnership { RowId = row.Id, ReferenceId = row.Items[0].Id, ItemId = old.Id, Signature = "edited-fingerprint" }; config.AutoFranchises.Ownership.Add(changedOwner);
        config.AutoFranchises.Exclusions.Add(new() { JellyfinItemId = old.Id, ProviderId = "tt123" });
        config.AutoFranchises.PendingChanges.Add(new() { ItemId = old.Id, SeriesId = old.Id, EpisodeIds = new() { old.Id } });
        var mapped = MediaRecoveryPlanner.ApplyMappings(config, new Dictionary<string, string> { [old.Id] = replacement.Id }, new[] { replacement });
        Check(config.MediaLinks[0].JellyfinItemId == old.Id && mapped.MediaLinks[0].JellyfinItemId == replacement.Id, "Mapping must leave the old configuration available for rollback");
        Check(mapped.MediaLinks[0].Id == link.Id && mapped.MediaLinks[0].Position == 9 && mapped.MediaLinks[0].StartSeason == 2 && mapped.MediaLinks[0].EndSeason == 4 && mapped.Rows[0].MediaOrder.SequenceEqual(row.MediaOrder) && mapped.Rows[0].NodeIds.SequenceEqual(row.NodeIds), "Recovery preserves plugin IDs, order, row membership and ranges");
        Check(mapped.Rows[0].Items[0].DisplayName == "manual title" && mapped.Rows[0].Items[0].EndEpisode == 7 && mapped.Nodes[0].CollectionId == replacement.Id, "Independent row metadata and collection dependencies must survive recovery");
        Check(mapped.MediaLinks[0].Artwork.PrimaryUrl.Contains(replacement.Id) && mapped.MediaLinks[0].Artwork.BackdropVideoItemId == replacement.Id && mapped.MediaLinks[0].Artwork.LogoUrl == link.Artwork.LogoUrl, "Only dependent Jellyfin artwork IDs change; custom artwork remains intact");
        Check(MediaRecoveryPlanner.LegacySignatureMatches(mapped, mapped.Nodes[0].AutoAddRecords[0]) && mapped.Nodes[0].AutoAddRecords[1].Signature == edited.Signature, "Only previously unmodified legacy ownership fingerprints are refreshed");
        Check(mapped.AutoFranchises.Ownership[0].Signature == AutoFranchisePlanner.Signature(mapped, mapped.AutoFranchises.Ownership[0]) && mapped.AutoFranchises.Ownership[1].Signature == "edited-fingerprint", "Recovery must not unlock edited automation imports");
        Check(mapped.AutoFranchises.Exclusions[0].JellyfinItemId == replacement.Id && mapped.AutoFranchises.Exclusions[0].ProviderId == "tt123" && mapped.AutoFranchises.Ownership[0].EpisodeIds.Single() == replacement.Id && mapped.AutoFranchises.PendingChanges[0].SeriesId == replacement.Id && mapped.AutoFranchises.PendingChanges[0].EpisodeIds.Single() == replacement.Id, "Recovery keeps durable restrictions and pending proposals attached to the replacement IDs");
        var legacyDefaults = new PluginConfiguration(); var legacyLink = Link(old); legacyLink.Identity = null; legacyDefaults.MediaLinks.Add(legacyLink);
        var legacyRecord = new FranchiseAutoAddRecord { ReferenceId = legacyLink.Id }; var legacyJson = JsonNodeFrom(MediaRecoveryPlanner.LegacySignature(legacyDefaults, legacyRecord)); legacyJson["ref"]!.AsObject().Remove("Identity"); legacyRecord.Signature = legacyJson.ToJsonString();
        Check(MediaRecoveryPlanner.LegacySignatureMatches(legacyDefaults, legacyRecord), "Old editor fingerprints omit null identities and empty default artwork");
        var serializer = new XmlSerializer(typeof(PluginConfiguration)); using var writer = new StringWriter(); serializer.Serialize(writer, mapped); using var reader = new StringReader(writer.ToString()); var xmlRoundtrip = (PluginConfiguration)serializer.Deserialize(reader)!;
        Check(xmlRoundtrip.MediaLinks[0].Identity!.ProviderIds[0].Value == "tt123" && xmlRoundtrip.MediaRecovery.Enabled && xmlRoundtrip.Rows[0].Items[0].Identity!.Year == 2020, "Durable identity snapshots must survive Jellyfin XML serialization");

        var root = Path.Combine(Path.GetTempPath(), "franchise-recovery-tests-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root);
        try
        {
            var progressPath = Path.Combine(root, "timeline-progress", Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N") + ".json"); Directory.CreateDirectory(Path.GetDirectoryName(progressPath)!);
            var progress = new FranchiseTimelineController.TimelineProgress { RowId = row.Id, ItemId = old.Id, QueueKeys = new() { link.Id + ":" + old.Id }, CompletedKeys = new() { "another:" + old.Id }, QueueSourceItemIds = new() { oldShow.Id }, QueueLengths = new() { 700 }, PositionTicks = 321, Index = 0, Total = 1, PlaybackMode = "playing", SessionId = "stale-session", ArmedUtc = DateTimeOffset.UtcNow, PendingAutoAdvanceFromKey = "old:" + old.Id, PendingAutoAdvanceToKey = "next:" + old.Id, PendingAutoAdvanceUtc = DateTimeOffset.UtcNow };
            var json = JsonSerializer.Serialize(progress, new JsonSerializerOptions(JsonSerializerDefaults.Web)); await File.WriteAllTextAsync(progressPath, json);
            var mapping = new Dictionary<string, string> { [old.Id] = replacement.Id, [oldShow.Id] = newShow.Id };
            await using (var rollback = await FranchiseTimelineController.RemapItemIdsAsync(root, mapping)) Check(rollback.ChangedFiles == 1, "Timeline transaction should stage every affected stored record");
            Check(await File.ReadAllTextAsync(progressPath) == json, "Uncommitted timeline recovery must restore the exact original bytes");
            var secondPath = Path.Combine(root, "timeline-progress", Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N") + ".json"); Directory.CreateDirectory(Path.GetDirectoryName(secondPath)!); await File.WriteAllTextAsync(secondPath, json);
            await using (var transaction = await FranchiseTimelineController.RemapItemIdsAsync(root, mapping)) { Check(transaction.ChangedFiles == 2, "Timeline repair must cover all users"); transaction.Commit(); }
            var restored = JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(await File.ReadAllTextAsync(progressPath), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
            Check(restored.ItemId == replacement.Id && restored.QueueKeys.Single() == link.Id + ":" + replacement.Id && restored.CompletedKeys.Single() == "another:" + replacement.Id && restored.QueueSourceItemIds.Single() == newShow.Id, "Timeline queue, completed and source IDs must all reconnect together");
            Check(restored.PositionTicks == 321 && restored.Index == 0 && restored.QueueLengths.Single() == 700 && restored.PlaybackMode == "paused" && restored.SessionId == "" && restored.ArmedUtc is null && restored.PendingAutoAdvanceUtc is null, "Recovery retains current ticks and clears stale session intent");
            var unrelatedItem = Guid.NewGuid().ToString("D");
            var unrelated = new FranchiseTimelineController.TimelineProgress { ItemId = unrelatedItem, QueueKeys = new() { "current:" + unrelatedItem, "future:" + old.Id }, Index = 0, Total = 2, PositionTicks = 777, SessionId = "valid-current-session", PlaybackMode = "playing" };
            await File.WriteAllTextAsync(secondPath, JsonSerializer.Serialize(unrelated, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            await using (var transaction = await FranchiseTimelineController.RemapItemIdsAsync(root, mapping)) transaction.Commit();
            var unrelatedAfter = JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(await File.ReadAllTextAsync(secondPath), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
            Check(unrelatedAfter.SessionId == "valid-current-session" && unrelatedAfter.PlaybackMode == "playing" && unrelatedAfter.PositionTicks == 777 && unrelatedAfter.QueueKeys[1].EndsWith(replacement.Id), "Changing only a future queue item must preserve the current unaffected playback session");
            await File.WriteAllTextAsync(secondPath, "malformed"); var stableBytes = await File.ReadAllBytesAsync(progressPath); var failed = false;
            try { await using var transaction = await FranchiseTimelineController.RemapItemIdsAsync(root, new Dictionary<string, string> { [replacement.Id] = old.Id }); transaction.Commit(); }
            catch (JsonException) { failed = true; }
            var afterDamaged = await File.ReadAllBytesAsync(progressPath);
            Check(failed && stableBytes.SequenceEqual(afterDamaged), "A damaged user's state must abort the complete progress transaction");
            File.Delete(secondPath);

            var paths = DispatchProxy.Create<IApplicationPaths, Proxy>(); ((Proxy)(object)paths).Call = (method, _) => method.ReturnType == typeof(string) ? root : null;
            var failSave = false;
            var xml = DispatchProxy.Create<IXmlSerializer, Proxy>(); ((Proxy)(object)xml).Call = (method, _) =>
            { if (method.Name == "SerializeToFile" && failSave) throw new IOException("fixture save failure"); return method.ReturnType == typeof(object) ? new PluginConfiguration() : null; };
            var plugin = new Plugin(paths, xml); plugin.Configuration.MediaLinks.Add(Link(old));
            progressPath = Path.Combine(plugin.DataFolderPath, "timeline-progress", Guid.NewGuid().ToString("N"), Guid.NewGuid().ToString("N") + ".json");
            Directory.CreateDirectory(Path.GetDirectoryName(progressPath)!);
            var moviePath = Path.Combine(root, "candidate.mp4"); await File.WriteAllBytesAsync(moviePath, new byte[] { 0 });
            var movie = new Movie { Id = Guid.Parse(replacement.Id), Name = replacement.Name, Path = moviePath, ProductionYear = 2020, ProviderIds = new() { ["Imdb"] = "tt123" } };
            var media = new List<BaseItem> { movie }; var scanning = false;
            var manager = DispatchProxy.Create<ILibraryManager, Proxy>(); ((Proxy)(object)manager).Call = (method, _) => method.Name == "GetItemList" ? media : method.Name == "get_IsScanRunning" ? scanning : null;
            var snapshots = new FranchiseLibrarySnapshotService(manager); var service = new MediaRecoveryService(manager, snapshots, NullLogger<MediaRecoveryService>.Instance);
            var status = await service.CheckAsync(); var request = new MediaRecoveryApplyRequest { Revision = status.Revision, LibraryRevision = status.LibraryRevision, Choices = new() { new() { ReferenceId = plugin.Configuration.MediaLinks[0].Id, ItemId = replacement.Id } } };
            plugin.Configuration.NavigationLabel = "changed"; failed = false;
            try { await service.ApplyAsync(request); } catch (InvalidOperationException) { failed = true; }
            Check(failed && plugin.Configuration.MediaLinks[0].JellyfinItemId == old.Id, "Stale configuration revisions must not apply an old recovery choice");
            status = await service.CheckAsync(); request.Revision = status.Revision; request.LibraryRevision = status.LibraryRevision;
            movie.ProviderIds["Imdb"] = "tt999"; failed = false;
            try { await service.ApplyAsync(request); } catch (InvalidOperationException) { failed = true; }
            Check(failed, "A changed library revision must reject a previously selected candidate"); movie.ProviderIds["Imdb"] = "tt123";
            status = await service.CheckAsync(); request.Revision = status.Revision; request.LibraryRevision = status.LibraryRevision;
            scanning = true; failed = false; try { await service.ApplyAsync(request); } catch (InvalidOperationException) { failed = true; }
            Check(failed, "Active Jellyfin scans must block recovery"); scanning = false;
            status = await service.CheckAsync(); request.Revision = status.Revision; request.LibraryRevision = status.LibraryRevision;
            await File.WriteAllTextAsync(progressPath, json); failSave = true; failed = false;
            try { await service.ApplyAsync(request); } catch (IOException) { failed = true; }
            Check(failed && plugin.Configuration.MediaLinks[0].JellyfinItemId == old.Id && await File.ReadAllTextAsync(progressPath) == json, "Configuration write failures must roll back both item references and user progress"); failSave = false;
            status = await service.CheckAsync(); request.Revision = status.Revision; request.LibraryRevision = status.LibraryRevision;
            await service.ApplyAsync(request);
            Check(plugin.Configuration.MediaLinks[0].JellyfinItemId == replacement.Id && (await File.ReadAllTextAsync(progressPath)).Contains(replacement.Id), "An explicit current verified selection must persist both configuration and progress");

            var user = new User("recovery tester", "default", "default") { Id = Guid.NewGuid() }; var users = DispatchProxy.Create<IUserManager, Proxy>(); ((Proxy)(object)users).Call = (method, _) => method.Name == "GetUserById" ? user : null;
            var controller = new FranchiseRecoveryController(service, users) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            Check(await controller.Check(default) is UnauthorizedResult, "Recovery must reject a missing verified Jellyfin user");
            controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("Jellyfin-UserId", user.Id.ToString()) }, "fixture"));
            Check(await controller.Apply(request, default) is UnauthorizedResult && await controller.Status(default) is UnauthorizedResult, "Read and write recovery endpoints must reject non-administrators directly");
            user.SetPermission(PermissionKind.IsAdministrator, true);
            plugin.Configuration.MediaLinks.Add(new() { JellyfinItemId = replacement.Id, DisplayName = "New current item", ItemType = "Movie" });
            var beforeStatusRevision = plugin.Configuration.ConfigurationRevision;
            Check(await controller.Status(default) is ContentResult { ContentType: "application/json; charset=utf-8" }, "An administrator should receive explicit web-cased recovery JSON");
            Check(plugin.Configuration.ConfigurationRevision == beforeStatusRevision && plugin.Configuration.MediaLinks.Last().Identity is null, "GET recovery status must not capture metadata or write the configuration");
            Check(typeof(FranchiseRecoveryController).GetCustomAttributes<AuthorizeAttribute>().Any(a => a.Policy == Policies.RequiresElevation), "Every recovery route must require Jellyfin elevation");

            // Moving a show also reconnects saved episode progress; its current ticks remain unchanged.
            plugin.Configuration.MediaLinks.Clear(); var showLink = Link(oldShow); showLink.RangeMode = "Episodes"; showLink.StartSeason = showLink.EndSeason = 1; showLink.StartEpisode = showLink.EndEpisode = 2; plugin.Configuration.MediaLinks.Add(showLink);
            MediaRecoveryPlanner.CaptureSnapshots(plugin.Configuration, new[] { oldShow, oldEpisode }, new[] { oldEpisode.Id });
            media.Clear(); media.Add(new MediaBrowser.Controller.Entities.TV.Series { Id = Guid.Parse(newShow.Id), Name = newShow.Name, Path = root, ProductionYear = 2020, ProviderIds = new() { ["Imdb"] = "tt777" } });
            media.Add(new MediaBrowser.Controller.Entities.TV.Episode { Id = Guid.Parse(newEpisode.Id), SeriesId = Guid.Parse(newShow.Id), Name = "Episode 2", Path = moviePath, ProductionYear = 2020, ParentIndexNumber = 1, IndexNumber = 2, ProviderIds = new() { ["Imdb"] = "tt778" } });
            progress.ItemId = oldEpisode.Id; progress.QueueKeys = new() { showLink.Id + ":" + oldEpisode.Id }; progress.CompletedKeys = new() { showLink.Id + ":" + oldEpisode.Id }; progress.QueueSourceItemIds = new() { oldShow.Id }; progress.PositionTicks = 456;
            await File.WriteAllTextAsync(progressPath, JsonSerializer.Serialize(progress, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            status = await service.CheckAsync(); request = new() { Revision = status.Revision, LibraryRevision = status.LibraryRevision, Choices = new() { new() { ReferenceId = showLink.Id, ItemId = newShow.Id } } };
            await service.ApplyAsync(request);
            restored = JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(await File.ReadAllTextAsync(progressPath), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
            Check(plugin.Configuration.MediaLinks.Single().JellyfinItemId == newShow.Id && restored.ItemId == newEpisode.Id && restored.QueueSourceItemIds.Single() == newShow.Id && restored.PositionTicks == 456 && restored.CompletedKeys.Single().EndsWith(newEpisode.Id), "Show recovery must map its verified episode dependencies and retain per-user progress");
        }
        finally { Directory.Delete(root, true); }
        Console.WriteLine("PASS media recovery: exact identities, duplicate versions, legacy evidence, preserved metadata/XML, all-user progress, transaction rollback, admin checks and stale revisions");
    }

    private static System.Text.Json.Nodes.JsonObject JsonNodeFrom(string value) => System.Text.Json.Nodes.JsonNode.Parse(value)!.AsObject();

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = (_, _) => null;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method is null) return null;
            return Call(method, args) ?? (method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null);
        }
    }
}
