using System.Text.Json;
using System.Xml.Serialization;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using Jellyfin.Plugin.FranchiseExplorer.Services;

internal static class AutomationPlannerTests
{
    public static void Run()
    {
        DefaultsAndPersistence();
        WholeShowsAndSourceOrder();
        ConsecutiveBundlesAndFormats();
        PersistentExclusions();
        ManualChoicesAndTombstones();
        ConservativeReconciliation();
        SelectedRangeReplacements();
        SanitizedPlaybackMetadata();
        JellyfinGuidFormats();
        Console.WriteLine("PASS Auto Franchises planner: registry/defaults, source order, whole shows, formats, exclusions, safe reconciliation, manual edits/deletions, repeated runs and failures");
    }

    private static void JellyfinGuidFormats()
    {
        var test = new Case();
        var ids = test.Library.ToDictionary(item => item.Id, _ => Guid.NewGuid());
        foreach (var item in test.Library)
        {
            var original = item.Id;
            item.Id = ids[original].ToString("D");
            if (item.SeriesId.Length > 0) item.SeriesId = ids[item.SeriesId].ToString("N");
        }
        test.SetChronologicalFormat("Bundles");
        var movies = new FranchiseRow { ParentNodeId = test.Registration.FranchiseNodeId, Name = "Movies", Category = "Movies", RowType = "Media" };
        movies.Items.Add(new() { JellyfinItemId = ids["movie1"].ToString("N"), ItemType = "Movie", DisplayName = "Manual movie" });
        test.Config.Rows.Add(movies);
        test.Registration.Rows.Add(new() { Kind = "Movies", RowId = Guid.Parse(movies.Id).ToString("N") });
        test.Settings.Exclusions.Add(new() { RegistrationId = test.Registration.Id, Scope = "Episode", JellyfinItemId = ids["e2"].ToString("N") });
        var plan = test.Plan();
        Check(!plan.SafeAdditions.Any(change => change.RowKind == "Movies" && change.ProviderId == "tt201"), "A manual N-format media ID covers the same D-format library item without a duplicate");
        Check(!plan.SafeAdditions.Where(change => change.RowKind == "ChronologicalOrder").SelectMany(change => change.EpisodeIds).Contains(ids["e2"].ToString("D")), "An N-format episode exclusion blocks its D-format library ID before whole-show expansion");
        test.Apply(plan);
        Check(test.Config.Rows.Count(row => Guid.Parse(row.Id) == Guid.Parse(movies.Id)) == 1 && movies.Items.Count(item => Guid.Parse(item.JellyfinItemId) == ids["movie1"]) == 1, "Alternate row-ID spellings do not create duplicate rows or replace manual media");
        test.Settings.Exclusions.Add(new() { RegistrationId = test.Registration.Id, Scope = "WholeShow", JellyfinItemId = ids["show"].ToString("N") });
        Check(test.Plan().SafeAdditions.All(change => change.ItemType != "Series"), "N-format whole-show exclusions also match D-format series IDs");

        var duplicate = new Case();
        duplicate.Library.Add(Episode("alternate-e2", "tt102", 1, 2));
        Check(duplicate.Plan().Missing.Any(change => change.Reason.Contains("version", StringComparison.OrdinalIgnoreCase)), "Overlapping physical episode versions require review before adding a whole-show bundle");
    }

    private static void DefaultsAndPersistence()
    {
        var settings = new AutoFranchiseSettings();
        var expected = new[] { "ls579565194", "ls526615193", "ls526781175", "ls024885449", "ls592604450", "ls4104275763", "ls539646485", "ls087871200", "ls521872135", "ls539977081", "ls072034866" };
        Check(!settings.Enabled && settings.Registry.Count == 11, "Automation is opt-in and has exactly the approved initial registry");
        Check(settings.Registry.Select(r => r.Url).SequenceEqual(expected.Select(id => "https://www.imdb.com/list/" + id + "/")), "Registry must contain only the eleven approved source lists in order");
        Check(settings.Registry.All(r => r.Enabled) && settings.Registry.Select(r => r.Id).SequenceEqual(new AutoFranchiseSettings().Registry.Select(r => r.Id)), "Seed identities must be stable across server restarts");
        using var oldReader = new StringReader("<PluginConfiguration><NavigationLabel>Legacy</NavigationLabel></PluginConfiguration>");
        var legacy = (PluginConfiguration)new XmlSerializer(typeof(PluginConfiguration)).Deserialize(oldReader)!;
        Check(legacy.NavigationLabel == "Legacy" && !legacy.AutoFranchises.Enabled && legacy.AutoFranchises.Registry.Count == 11, "Legacy XML receives disabled automation defaults without changing existing choices");
        settings.Enabled = true;
        settings.Registry[0].Deleted = true;
        settings.Registry[0].Rows.Add(new() { Kind = "Movies", RowId = "deleted-row", Deleted = true });
        settings.Exclusions.Add(new() { RegistrationId = settings.Registry[0].Id, Scope = "AllowedRange", ProviderId = "tt100", StartSeason = 1, EndSeason = 1, StartEpisode = 2, EndEpisode = 3 });
        settings.PendingChanges.Add(new() { Id = "kept", RegistrationId = settings.Registry[0].Id, Status = "Kept", Kind = "Remove", Reason = "Keep my choices" });
        settings.Ownership.Add(new() { RegistrationId = settings.Registry[0].Id, ReferenceId = "owned", Signature = "original", MediaKey = "stable" });
        settings.LastCompletedLocalDay = "2026-11-09";
        using var writer = new StringWriter();
        new XmlSerializer(typeof(AutoFranchiseSettings)).Serialize(writer, settings);
        using var reader = new StringReader(writer.ToString());
        var restored = (AutoFranchiseSettings)new XmlSerializer(typeof(AutoFranchiseSettings)).Deserialize(reader)!;
        Check(restored.Enabled && restored.Registry.Count == 11 && restored.Registry[0].Deleted && restored.Registry[0].Rows[0].Deleted, "XML backups retain franchise and row deletion decisions");
        Check(restored.Exclusions[0].Scope == "AllowedRange" && restored.Exclusions[0].StartEpisode == 2 && restored.PendingChanges[0].Status == "Kept" && restored.Ownership[0].Signature == "original" && restored.LastCompletedLocalDay == settings.LastCompletedLocalDay, "XML retains range locks, kept review changes, ownership and scheduled-day state");
        var disabled = new Case();
        disabled.Settings.Enabled = false;
        Check(disabled.Plan().SafeAdditions.Count == 0, "A disabled global registry must not plan automatic additions");
        disabled.Settings.Enabled = true;
        disabled.Registration.Enabled = false;
        Check(disabled.Plan().SafeAdditions.Count == 0, "Disabled registrations must not plan automatic additions");
    }

    private static void WholeShowsAndSourceOrder()
    {
        var test = new Case();
        test.Library.Add(Episode("e4", "tt104", 2, 1));
        test.Source = new()
        {
            Source("tt202", "Second movie", "Movie", 4),
            Source("tt102", "Second episode", "Episode", 3),
            Source("tt100", "Show", "Series", 1),
            Source("tt201", "First movie", "Movie", 2),
            Source("tt101", "First episode", "Episode", 5)
        };
        var before = test.Snapshot();
        var plan = test.Plan();
        Check(test.Snapshot() == before, "Planning must not mutate caller configuration, settings or registration");
        var chronological = plan.SafeAdditions.Where(c => c.RowKind == "ChronologicalOrder").ToList();
        var episodes = chronological.SelectMany(c => c.EpisodeIds).ToList();
        Check(episodes.Count == 4 && episodes.Distinct().Count() == 4 && episodes.Contains("e4"), "Whole-show source entries expand accessible episodes once even when individual entries repeat them");
        Check(chronological.Where(c => c.ItemType == "Movie").Select(c => c.ItemId).SequenceEqual(new[] { "movie1", "movie2" }), "IMDb explicit positions, rather than transport order, determine chronology");
        Check(chronological.First().SourcePosition == 1 && chronological.Last().SourcePosition == 4, "Expanded show episodes keep the show's source-list position");
        test.Apply(plan);
        Check(test.Config.Rows.Count == 3 && test.Registration.Rows.Select(r => r.Kind).Order().SequenceEqual(new[] { "ChronologicalOrder", "Movies", "TVShows" }), "First apply creates all three stable standard rows");
        Check(test.Row("TVShows").Items.Count == 1 && test.Row("TVShows").Items[0].JellyfinItemId == "show", "TV Shows contains one card for the matching series");
        Check(test.Row("Movies").Items.Select(i => i.JellyfinItemId).SequenceEqual(new[] { "movie1", "movie2" }), "Movies contains matching movies in explicit source order");
        var persisted = test.Snapshot();
        Check(test.Plan().SafeAdditions.Count == 0, "Repeated runs must not propose owned references again");
        test.Apply(test.Plan());
        Check(test.Snapshot() == persisted, "A completed unchanged plan is idempotent");
    }

    private static void ConsecutiveBundlesAndFormats()
    {
        var bundles = new Case();
        bundles.Source = new()
        {
            Source("tt101", "One", "Episode", 1), Source("tt102", "Two", "Episode", 2),
            Source("tt201", "Movie", "Movie", 3), Source("tt103", "Three", "Episode", 4)
        };
        bundles.Apply(bundles.Plan());
        var links = bundles.Links("ChronologicalOrder");
        Check(links.Count == 3 && links[0].StartEpisode == 1 && links[0].EndEpisode == 2 && links[1].ItemType == "Movie" && links[2].StartEpisode == 3, "Bundles combine adjacent episodes and split at an intervening movie");
        Check(links[0].RangeMode == "Episodes" && links[0].JellyfinItemId == "show", "Bundled references retain the existing series range playback format");
        var gap = new Case();
        gap.Source = new() { Source("tt101", "One", "Episode", 1), Source("tt103", "Three", "Episode", 2) };
        Check(gap.Plan().SafeAdditions.Count(c => c.RowKind == "ChronologicalOrder") == 2, "Episode gaps must split bundles");
        var individual = new Case();
        individual.Registration.EpisodeFormat = "Individual";
        individual.Source = new() { Source("tt100", "Show", "Series", 1) };
        individual.Apply(individual.Plan());
        Check(individual.Links("ChronologicalOrder").Count == 3 && individual.Links("ChronologicalOrder").All(l => l.ItemType == "Series" && l.StartEpisode == l.EndEpisode), "Individual format stores one series episode range per available episode");
        var rowOverride = new Case();
        rowOverride.SetChronologicalFormat("Individual");
        rowOverride.Source = new() { Source("tt100", "Show", "Series", 1) };
        rowOverride.Apply(rowOverride.Plan());
        Check(rowOverride.Links("ChronologicalOrder").Count == 3, "The chronological row's explicit format overrides the registration default");
        var bundledOverride = new Case();
        bundledOverride.Registration.EpisodeFormat = "Individual";
        bundledOverride.SetChronologicalFormat("Bundles");
        bundledOverride.Source = new() { Source("tt100", "Show", "Series", 1) };
        bundledOverride.Apply(bundledOverride.Plan());
        Check(bundledOverride.Links("ChronologicalOrder").Count == 1, "A Bundles row override also takes precedence over Individual inheritance");

        var doubleEpisode = new Case();
        doubleEpisode.Registration.EpisodeFormat = "Individual";
        doubleEpisode.Library.RemoveAll(i => i.Id is "e2" or "e3");
        var doubleItem = Episode("double", "tt105", 1, 2);
        doubleItem.EpisodeEnd = 3;
        doubleEpisode.Library.Add(doubleItem);
        doubleEpisode.Source = new() { Source("tt101", "One", "Episode", 1), Source("tt105", "Double episode", "Episode", 2) };
        doubleEpisode.Apply(doubleEpisode.Plan());
        Check(doubleEpisode.Links("ChronologicalOrder").Count == 2 && doubleEpisode.Links("ChronologicalOrder")[1].StartEpisode == 2 && doubleEpisode.Links("ChronologicalOrder")[1].EndEpisode == 3, "Individual format retains a supplied double episode's complete playback range");
    }

    private static void PersistentExclusions()
    {
        var test = new Case();
        test.Library.Add(Episode("e4", "tt104", 2, 1));
        test.Exclude("Episode", "tt100", 1, 1, 2, 2);
        test.Exclude("Season", "tt100", 2, 2);
        test.Exclude("Movie", "tt202");
        var plan = test.Plan();
        Check(plan.SafeAdditions.Where(c => c.RowKind == "ChronologicalOrder").SelectMany(c => c.EpisodeIds).Order().SequenceEqual(new[] { "e1", "e3" }), "Season and episode exclusions apply before whole-show expansion and bundling");
        Check(plan.SafeAdditions.All(c => c.ItemId != "movie2"), "Excluded movies must stay out of every affected row");
        Check(plan.SafeAdditions.Count(c => c.RowKind == "ChronologicalOrder" && c.EpisodeIds.Count > 0) == 2, "An excluded episode splits the allowed bundles");
        test.Apply(plan);
        Check(test.Links("ChronologicalOrder").All(l => l.ItemType == "Movie" || l.StartSeason == 1 && l.EndSeason == 1 && l.StartEpisode == l.EndEpisode), "Applied series ranges cannot span an excluded episode or season");
        var whole = new Case();
        whole.Exclude("WholeShow", "tt100");
        Check(whole.Plan().SafeAdditions.All(c => c.ItemId != "show" && c.SeriesId != "show" && c.EpisodeIds.Count == 0), "Whole-show exclusions suppress both TV cards and expanded episodes");
        var locked = new Case();
        locked.Exclude("AllowedRange", "tt100", 1, 1, 2, 3);
        locked.Exclude("Episode", "tt100", 1, 1, 3, 3);
        Check(locked.Plan().SafeAdditions.Where(c => c.RowKind == "ChronologicalOrder").SelectMany(c => c.EpisodeIds).SequenceEqual(new[] { "e2" }), "AllowedRange locks and episode exclusions intersect without restoring other restrictions");
        var scoped = new Case();
        scoped.SetChronologicalFormat("Bundles");
        scoped.Exclude("Movie", "tt201", rowId: scoped.Row("ChronologicalOrder").Id);
        var scopedPlan = scoped.Plan();
        Check(scopedPlan.SafeAdditions.Any(c => c.RowKind == "Movies" && c.ItemId == "movie1") && scopedPlan.SafeAdditions.All(c => c.RowKind != "ChronologicalOrder" || c.ItemId != "movie1"), "Row-scoped exclusions must not suppress another row's independent selection");
    }

    private static void ManualChoicesAndTombstones()
    {
        var edited = new Case();
        edited.Source = new() { Source("tt100", "Show", "Series", 1) };
        edited.Apply(edited.Plan());
        var row = edited.Row("ChronologicalOrder");
        var link = edited.Links("ChronologicalOrder").Single();
        row.Name = "My timeline";
        row.Artwork.PrimaryUrl = "my-row-art";
        link.EndEpisode = 1;
        link.Artwork.PrimaryUrl = "my-card-art";
        var held = edited.Plan();
        Check(held.Pending.Count > 0 && held.SafeAdditions.All(c => c.RowKind != "ChronologicalOrder"), "A manually restricted owned range must be held instead of restored or bypassed");
        edited.Apply(held);
        Check(link.EndEpisode == 1 && link.Artwork.PrimaryUrl == "my-card-art" && row.Name == "My timeline" && row.Artwork.PrimaryUrl == "my-row-art", "Safe apply preserves manual ranges, names and artwork");
        var repeat = edited.Plan();
        Check(repeat.SafeAdditions.All(c => c.RowKind != "ChronologicalOrder"), "Persisted restrictions prevent another reference from bypassing a manual range");
        var pendingIds = edited.Settings.PendingChanges.Select(c => c.Id).ToHashSet();
        edited.Apply(repeat);
        Check(edited.Settings.PendingChanges.Select(c => c.Id).Distinct().Count() == edited.Settings.PendingChanges.Count && edited.Settings.PendingChanges.Select(c => c.Id).All(pendingIds.Contains), "Repeated held proposals deduplicate by stable operation identity");
        foreach (var change in edited.Settings.PendingChanges) change.Status = "Kept";
        edited.Apply(edited.Plan());
        Check(edited.Settings.PendingChanges.All(c => c.Status == "Kept"), "Nightly planning must retain acknowledgement of kept choices");

        var deletedReference = new Case();
        deletedReference.Apply(deletedReference.Plan());
        var deletedRow = deletedReference.Row("Movies");
        deletedRow.Items.RemoveAll(i => i.JellyfinItemId == "movie1");
        deletedReference.Apply(deletedReference.Plan());
        Check(deletedRow.Items.All(i => i.JellyfinItemId != "movie1") && deletedReference.Plan().SafeAdditions.All(c => c.RowKind != "Movies" || c.ItemId != "movie1"), "Manually deleted owned references become protected and stay deleted");

        var deletedShelf = new Case();
        deletedShelf.Apply(deletedShelf.Plan());
        var missingRowId = deletedShelf.Row("ChronologicalOrder").Id;
        deletedShelf.Config.Rows.RemoveAll(r => r.Id == missingRowId);
        deletedShelf.Apply(deletedShelf.Plan());
        Check(deletedShelf.Config.Rows.All(r => r.Id != missingRowId) && deletedShelf.Registration.Rows.Single(r => r.Kind == "ChronologicalOrder").Deleted, "Deleting a mapped row creates a persistent tombstone rather than recreating it");
        var otherDeletedRowId = deletedShelf.Row("Movies").Id;
        deletedShelf.Config.Rows.RemoveAll(r => r.Id == otherDeletedRowId);
        deletedShelf.Apply(deletedShelf.Plan());
        var restoreRowPlan = deletedShelf.Plan();
        var restoreRow = restoreRowPlan.Pending.First(c => c.Kind == "Restore" && c.RowId == missingRowId);
        deletedShelf.Planner.Apply(deletedShelf.Config, deletedShelf.Settings, deletedShelf.Registration, restoreRowPlan, new[] { restoreRow.Id });
        Check(deletedShelf.Config.Rows.Any(r => r.Id == missingRowId) && !deletedShelf.Registration.Rows.Single(r => r.Kind == "ChronologicalOrder").Deleted, "Explicit Restore recreates the selected deleted row with its stable mapping");
        Check(deletedShelf.Config.Rows.All(r => r.Id != otherDeletedRowId) && deletedShelf.Registration.Rows.Single(r => r.Kind == "Movies").Deleted, "Restoring one selected row must retain another row's deletion protection");
        Check(deletedShelf.Settings.PendingChanges.Single(c => c.Id == restoreRow.Id).Status == "Applied", "Selected row restoration is recorded as applied");

        var deletedFranchise = new Case();
        deletedFranchise.Apply(deletedFranchise.Plan());
        var nodeId = deletedFranchise.Registration.FranchiseNodeId;
        deletedFranchise.Config.Nodes.RemoveAll(n => n.Id == nodeId);
        deletedFranchise.Apply(deletedFranchise.Plan());
        Check(deletedFranchise.Config.Nodes.All(n => n.Id != nodeId) && deletedFranchise.Registration.Deleted, "Deleting an automatically built franchise must prevent silent recreation");
        var retainedRows = JsonSerializer.Serialize(deletedFranchise.Config.Rows);
        var restoreFranchisePlan = deletedFranchise.Plan();
        var restoreFranchise = restoreFranchisePlan.Pending.First(c => c.Kind == "Restore" && c.RowKind == "Movies");
        deletedFranchise.Planner.Apply(deletedFranchise.Config, deletedFranchise.Settings, deletedFranchise.Registration, restoreFranchisePlan, new[] { restoreFranchise.Id });
        Check(deletedFranchise.Config.Nodes.Any(n => n.Id == nodeId) && !deletedFranchise.Registration.Deleted, "Explicit Restore must recreate a deleted franchise even when its selected reference still exists in a retained row");
        Check(JsonSerializer.Serialize(deletedFranchise.Config.Rows) == retainedRows && deletedFranchise.Settings.PendingChanges.Single(c => c.Id == restoreFranchise.Id).Status == "Applied", "Restoring the franchise preserves retained row content and acknowledges the selected operation");
    }

    private static void ConservativeReconciliation()
    {
        var test = new Case();
        test.Apply(test.Plan());
        var node = test.Config.Nodes.Single();
        node.Artwork.PrimaryUrl = "custom-franchise-art";
        var custom = new FranchiseRow { ParentNodeId = node.Id, Name = "Phases", SortOrder = 99, MediaOrder = new() { "manual-one", "manual-two" } };
        test.Config.Rows.Add(custom);
        var originalChronology = test.Row("ChronologicalOrder").MediaOrder.ToList();
        test.Source = new() { Source("tt100", "Show", "Series", 1), Source("tt201", "First movie", "Movie", 2) };
        var removal = test.Plan();
        Check(removal.Pending.Any(c => c.Kind == "Remove" && c.ItemId == "movie2"), "A source removal requires explicit review");
        test.Apply(removal);
        Check(test.Row("Movies").Items.Any(i => i.JellyfinItemId == "movie2") && test.Row("ChronologicalOrder").MediaOrder.SequenceEqual(originalChronology), "Safe default apply must preserve removed-source references and existing order");
        Check(node.Artwork.PrimaryUrl == "custom-franchise-art" && custom.SortOrder == 99 && custom.MediaOrder.SequenceEqual(new[] { "manual-one", "manual-two" }), "Automation preserves custom rows, order and franchise artwork");
        var selected = removal.Pending.Where(c => c.Kind == "Remove" && c.ItemId == "movie2").Select(c => c.Id).ToList();
        test.Planner.Apply(test.Config, test.Settings, test.Registration, test.Plan(), selected);
        Check(test.Row("Movies").Items.All(i => i.JellyfinItemId != "movie2") && test.Links("ChronologicalOrder").All(l => l.JellyfinItemId != "movie2"), "Only an explicitly selected reviewed removal may remove owned source references");
        var beforeFailure = test.Snapshot();
        var failure = test.Planner.Plan(test.Config, test.Settings, test.Registration, test.Library, Array.Empty<FranchiseAutoAddController.Entry>(), true, "Source is private or incomplete");
        Check(failure.SourceFailed && failure.SafeAdditions.Count == 0, "A failed source must not become an empty successful franchise");
        test.Apply(failure);
        Check(test.Snapshot() == beforeFailure, "Failed-source apply must not mutate memberships, protections or pending state");
        var unverified = test.Planner.Plan(test.Config, test.Settings, test.Registration, test.Library, test.Source, false);
        Check(unverified.SafeAdditions.Count == 0, "Unverified list order cannot authorize unattended additions");

        var missing = new Case();
        missing.Source = new() { Source("tt999", "Unavailable title", "Movie", 1) };
        Check(missing.Plan().Missing.Any() && missing.Plan().SafeAdditions.Count == 0, "Unmatched source titles remain missing without invented media");
        var ambiguous = new Case();
        ambiguous.Library.Add(new() { Id = "duplicate", Name = "First movie duplicate", ItemType = "Movie", ProviderIds = new() { ["Imdb"] = "tt201" } });
        ambiguous.Source = new() { Source("tt201", "First movie", "Movie", 1) };
        var ambiguity = ambiguous.Plan();
        Check(ambiguity.SafeAdditions.Count == 0 && ambiguity.Pending.Concat(ambiguity.Missing).Any(), "Ambiguous provider matches require review rather than an arbitrary choice");
        var unavailable = new Case();
        unavailable.Library.Single(i => i.Id == "movie1").IsAvailable = false;
        unavailable.Source = new() { Source("tt201", "First movie", "Movie", 1) };
        Check(unavailable.Plan().SafeAdditions.Count == 0 && unavailable.Plan().Missing.Any(), "Offline library items must not be treated as available additions");
    }

    private static void SanitizedPlaybackMetadata()
    {
        // The isolated pure-planner runner omits HTTP controllers. The full suite
        // also verifies that the authenticated catalog emits only queue rules.
        var controller = typeof(PluginConfiguration).Assembly.GetType("Jellyfin.Plugin.FranchiseExplorer.Api.FranchiseBrowseController");
        if (controller is null) return;
        var method = controller.GetMethod("PlaybackExclusions", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
        var node = new FranchiseNode { Name = "Private registry label" };
        var row = new FranchiseRow { ParentNodeId = node.Id };
        var sibling = new FranchiseRow { ParentNodeId = node.Id };
        var registration = new AutoFranchiseRegistration { Name = "Private source name", Url = "https://www.imdb.com/list/ls123/", FranchiseNodeId = node.Id };
        var config = new PluginConfiguration { Nodes = new() { node }, Rows = new() { row, sibling } };
        config.AutoFranchises.Registry = new() { registration };
        config.AutoFranchises.Exclusions = new()
        {
            new() { RegistrationId = registration.Id, Scope = "WholeShow", ProviderId = "tt100", JellyfinItemId = node.Id, Reason = "Private admin explanation" },
            new() { RegistrationId = registration.Id, RowId = row.Id, Scope = "Episode", ProviderId = "tt100", StartSeason = 1, EndSeason = 1, StartEpisode = 2, EndEpisode = 2 },
            new() { RegistrationId = registration.Id, Scope = "Movie", ProviderId = "tt201", Enabled = false },
            new() { RegistrationId = "another-registration", Scope = "Movie", ProviderId = "tt202" }
        };
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var payload = JsonSerializer.Serialize(method.Invoke(null, new object[] { config, row }), options);
        using var document = JsonDocument.Parse(payload);
        var rules = document.RootElement;
        Check(rules.GetArrayLength() == 2, "Catalog rules include only enabled exclusions belonging to this franchise and row");
        Check(rules[0].GetProperty("itemId").GetString() == Guid.Parse(node.Id).ToString("N") && rules[1].GetProperty("startEpisode").GetInt32() == 2, "Playback metadata retains canonical media identity and selected episode boundaries");
        var allowed = new HashSet<string> { "scope", "providerName", "providerId", "itemId", "itemIds", "startSeason", "endSeason", "startEpisode", "endEpisode" };
        Check(rules.EnumerateArray().All(rule => rule.EnumerateObject().All(property => allowed.Contains(property.Name))) && !payload.Contains("Private"), "Authenticated playback metadata must not expose registry names, source URLs, admin reasons or review state");
        var siblingRules = (object[])method.Invoke(null, new object[] { config, sibling })!;
        Check(siblingRules.Length == 1, "Row-scoped restrictions must not leak into a sibling catalog row");
    }

    private static void SelectedRangeReplacements()
    {
        var test = new Case();
        test.Apply(test.Plan());
        var original = test.Links("ChronologicalOrder").Single(l => l.ItemType == "Series");
        test.Library.Add(new() { Id = "new-movie", Name = "New movie", ItemType = "Movie", ProviderIds = new() { ["Imdb"] = "tt203" } });
        test.Source = new() { Source("tt101", "One", "Episode", 1), Source("tt103", "Three", "Episode", 2), Source("tt203", "New movie", "Movie", 3) };
        var plan = test.Plan();
        var replacement = plan.Pending.Single(c => c.Kind == "RangeReplacement");
        Check(plan.SafeAdditions.Any(c => c.ItemId == "new-movie"), "The range review fixture includes an independent safe addition");
        test.Planner.Apply(test.Config, test.Settings, test.Registration, plan, new[] { replacement.Id });
        var remaining = test.Links("ChronologicalOrder").Where(l => l.ItemType == "Series").ToList();
        Check(remaining.Count == 2 && remaining.All(l => l.StartEpisode == l.EndEpisode) && remaining.Select(l => l.StartEpisode).SequenceEqual(new[] { 1, 3 }), "Explicit range replacement applies all remaining allowed source fragments in the same transaction");
        Check(test.Config.MediaLinks.All(l => l.Id != original.Id) && test.Settings.Ownership.All(o => o.ReferenceId != original.Id), "Reviewed range replacement retires the prior reference and ownership");
        Check(test.Config.MediaLinks.All(l => l.JellyfinItemId != "new-movie") && test.Row("Movies").Items.All(i => i.JellyfinItemId != "new-movie"), "Apply selected must not apply unrelated safe additions");

        var directEpisode = new Case();
        directEpisode.Settings.Exclusions.Add(new() { RegistrationId = directEpisode.Registration.Id, Scope = "Episode", JellyfinItemId = "e2" });
        Check(directEpisode.Plan().SafeAdditions.Where(c => c.RowKind == "ChronologicalOrder").SelectMany(c => c.EpisodeIds).Order().SequenceEqual(new[] { "e1", "e3" }), "A provider-less direct episode exclusion remains protected by its Jellyfin identity");
    }

    private static AutomationLibraryItem Episode(string id, string imdb, int season, int episode) => new()
    {
        Id = id, Name = "Episode " + episode, ItemType = "Episode", ProviderIds = new() { ["Imdb"] = imdb },
        SeriesId = "show", SeriesProviderIds = new() { ["Imdb"] = "tt100" }, SeasonNumber = season, EpisodeNumber = episode, EpisodeEnd = episode
    };

    private static FranchiseAutoAddController.Entry Source(string imdb, string title, string type, int position) => new(imdb, title, null, type, position);
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    private sealed class Case
    {
        public PluginConfiguration Config { get; } = new();
        public AutoFranchiseSettings Settings { get; } = new() { Enabled = true, Registry = new() };
        public AutoFranchiseRegistration Registration { get; } = new() { Id = "test-registration", Name = "Test franchise", Url = "https://www.imdb.com/list/ls123/" };
        public AutoFranchisePlanner Planner { get; } = new();
        public List<AutomationLibraryItem> Library { get; } = new()
        {
            new() { Id = "show", Name = "Show", ItemType = "Series", ProviderIds = new() { ["Imdb"] = "tt100" } },
            Episode("e1", "tt101", 1, 1), Episode("e2", "tt102", 1, 2), Episode("e3", "tt103", 1, 3),
            new() { Id = "movie1", Name = "First movie", ItemType = "Movie", ProviderIds = new() { ["Imdb"] = "tt201" } },
            new() { Id = "movie2", Name = "Second movie", ItemType = "Movie", ProviderIds = new() { ["Imdb"] = "tt202" } }
        };
        public List<FranchiseAutoAddController.Entry> Source { get; set; } = new()
        {
            AutomationPlannerTests.Source("tt100", "Show", "Series", 1),
            AutomationPlannerTests.Source("tt201", "First movie", "Movie", 2),
            AutomationPlannerTests.Source("tt202", "Second movie", "Movie", 3)
        };
        public Case() { Settings.Registry.Add(Registration); }
        public AutoFranchisePlan Plan() => Planner.Plan(Config, Settings, Registration, Library, Source, true);
        public void Apply(AutoFranchisePlan plan) => Planner.Apply(Config, Settings, Registration, plan);
        public FranchiseRow Row(string kind) => Config.Rows.Single(r => r.Id == Registration.Rows.Single(m => m.Kind == kind).RowId);
        public List<MediaLink> Links(string kind) => Row(kind).MediaLinkIds.Select(id => Config.MediaLinks.Single(l => l.Id == id)).ToList();
        public string Snapshot() => JsonSerializer.Serialize(new { Config, Settings, Registration });
        public void SetChronologicalFormat(string format)
        {
            var node = new FranchiseNode { Name = Registration.Name };
            Config.Nodes.Add(node);
            Registration.FranchiseNodeId = node.Id;
            var row = new FranchiseRow { ParentNodeId = node.Id, Name = "Chronological Order", Category = "ChronologicalOrder", RowType = "Timeline", EpisodeFormat = format };
            Config.Rows.Add(row);
            Registration.Rows.Add(new() { Kind = "ChronologicalOrder", RowId = row.Id });
        }
        public void Exclude(string scope, string providerId, int startSeason = 0, int endSeason = 0, int startEpisode = 0, int endEpisode = 0, string rowId = "")
            => Settings.Exclusions.Add(new() { RegistrationId = Registration.Id, RowId = rowId, Scope = scope, ProviderId = providerId, StartSeason = startSeason, EndSeason = endSeason, StartEpisode = startEpisode, EndEpisode = endEpisode });
    }
}
