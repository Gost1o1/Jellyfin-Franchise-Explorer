using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

public sealed class MediaRecoveryCandidate
{
    public string ItemId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string ItemType { get; set; } = string.Empty;
    public int? Year { get; set; }
    public List<MediaProviderIdentity> ProviderIds { get; set; } = new();
    public bool Verified { get; set; }
}

public sealed class MediaRecoveryEntry
{
    public string ReferenceId { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
    public string NodeId { get; set; } = string.Empty;
    public string OldItemId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string ItemType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public bool CanAutoRemap { get; set; }
    public string MatchMethod { get; set; } = string.Empty;
    public List<MediaRecoveryCandidate> Candidates { get; set; } = new();
}

public sealed class MediaRecoveryStatus
{
    public string Revision { get; set; } = string.Empty;
    public string LibraryRevision { get; set; } = string.Empty;
    public bool LibraryHealthy { get; set; }
    public bool CanSearch { get; set; }
    public bool Enabled { get; set; }
    public bool AutoReconnect { get; set; }
    public DateTimeOffset CheckedUtc { get; set; }
    public string Message { get; set; } = string.Empty;
    public List<MediaRecoveryEntry> Entries { get; set; } = new();
    public int ReferenceCount => Entries.Count;
    public int HealthyCount => Entries.Count(e => e.Status == "Healthy");
    public int AttentionCount => ReferenceCount - HealthyCount;
}

public sealed class MediaRecoveryChoice
{
    public string ReferenceId { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
}

public sealed class MediaRecoveryApplyRequest
{
    public string Revision { get; set; } = string.Empty;
    public string LibraryRevision { get; set; } = string.Empty;
    public List<MediaRecoveryChoice> Choices { get; set; } = new();
}

public sealed class MediaRecoveryAutoResult
{
    public MediaRecoveryStatus Status { get; set; } = new();
    public int RemappedCount { get; set; }
}

/// <summary>Exact identity or unique exact title matching and reversible configuration transformation.</summary>
public static class MediaRecoveryPlanner
{
    public static string Id(string? value) => Guid.TryParse(value, out var id) ? id.ToString("N") : (value ?? string.Empty).ToLowerInvariant();
    public static string Revision(PluginConfiguration configuration) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(configuration))));
    public static PluginConfiguration Clone(PluginConfiguration configuration) => JsonSerializer.Deserialize<PluginConfiguration>(JsonSerializer.Serialize(configuration))!;

    private static List<MediaProviderIdentity> Providers(IEnumerable<KeyValuePair<string, string>> values)
        => values.Where(p => p.Key.Equals("Imdb", StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(p.Value ?? "", "^tt[0-9]{1,18}$", RegexOptions.IgnoreCase)
                || (p.Key.Equals("Tmdb", StringComparison.OrdinalIgnoreCase) || p.Key.Equals("Tvdb", StringComparison.OrdinalIgnoreCase)) && Regex.IsMatch(p.Value ?? "", "^[0-9]{1,18}$"))
            .Select(p => new MediaProviderIdentity { Name = p.Key.Equals("Imdb", StringComparison.OrdinalIgnoreCase) ? "Imdb" : p.Key.Equals("Tmdb", StringComparison.OrdinalIgnoreCase) ? "Tmdb" : "Tvdb", Value = p.Value.ToLowerInvariant() })
            .OrderBy(p => p.Name, StringComparer.Ordinal).ToList();

    public static MediaIdentity Capture(AutomationLibraryItem item) => new()
    {
        ItemType = item.ItemType, Year = item.Year, ProviderIds = Providers(item.ProviderIds),
        SeriesProviderIds = Providers(item.SeriesProviderIds), SeasonNumber = item.SeasonNumber,
        EpisodeNumber = item.EpisodeNumber, EpisodeEnd = item.EpisodeEnd ?? item.EpisodeNumber
    };

    public static bool Stable(MediaIdentity? identity) => identity is not null && (identity.ItemType == "Episode"
        ? identity.SeriesProviderIds.Count > 0 && identity.SeasonNumber is >= 0 && identity.EpisodeNumber is > 0
        : identity.ProviderIds.Count > 0);

    private static bool ExactProviders(List<MediaProviderIdentity> expected, List<MediaProviderIdentity> actual)
        => expected.Count > 0 && expected.All(p => actual.Any(a => a.Name.Equals(p.Name, StringComparison.OrdinalIgnoreCase) && a.Value.Equals(p.Value, StringComparison.OrdinalIgnoreCase)));

    public static bool Verified(MediaIdentity? expected, AutomationLibraryItem candidate) => candidate.IsAvailable && SameIdentity(expected, candidate);

    private static bool SameIdentity(MediaIdentity? expected, AutomationLibraryItem candidate)
    {
        if (!Stable(expected)) return false;
        var actual = Capture(candidate);
        if (expected!.ItemType != actual.ItemType || expected.Year.HasValue && expected.Year != actual.Year) return false;
        if (expected.ItemType != "Episode") return ExactProviders(expected.ProviderIds, actual.ProviderIds);
        return ExactProviders(expected.SeriesProviderIds, actual.SeriesProviderIds)
            && expected.SeasonNumber == actual.SeasonNumber && expected.EpisodeNumber == actual.EpisodeNumber
            && (expected.EpisodeEnd ?? expected.EpisodeNumber) == actual.EpisodeEnd
            && (expected.ProviderIds.Count == 0 || ExactProviders(expected.ProviderIds, actual.ProviderIds));
    }

    /// <summary>Indexes provider identities, episode coordinates and exact titles once per check.</summary>
    public sealed class CandidateLookup
    {
        private readonly Dictionary<string, List<AutomationLibraryItem>> _items = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, List<AutomationLibraryItem>> _titles = new(StringComparer.OrdinalIgnoreCase);
        private static string Key(string type, string provider, string value, int? season, int? episode, int? end)
            => type + ":" + provider + ":" + value + (type == "Episode" ? ":" + season + ":" + episode + ":" + (end ?? episode) : "");
        public CandidateLookup(IReadOnlyList<AutomationLibraryItem> items)
        {
            // Keep unavailable versions in this index: one available edition beside an offline
            // duplicate is still an ambiguous title, rather than permission to choose a version.
            foreach (var item in items.GroupBy(i => Id(i.Id)).Select(g => g.First()))
            {
                var key = item.ItemType + ":" + NormalizeTitle(item.Name);
                if (!_titles.TryGetValue(key, out var matches)) _titles[key] = matches = new();
                matches.Add(item);
            }
            foreach (var item in items.GroupBy(i => Id(i.Id)).Select(g => g.First()))
                foreach (var provider in item.ItemType == "Episode" ? item.SeriesProviderIds : item.ProviderIds)
                {
                    var key = Key(item.ItemType, provider.Key, provider.Value, item.SeasonNumber, item.EpisodeNumber, item.EpisodeEnd);
                    if (!_items.TryGetValue(key, out var matches)) _items[key] = matches = new();
                    matches.Add(item);
                }
        }
        public IReadOnlyList<AutomationLibraryItem> Find(MediaIdentity? identity, bool includeUnavailable = false)
        {
            if (!Stable(identity)) return [];
            var provider = (identity!.ItemType == "Episode" ? identity.SeriesProviderIds : identity.ProviderIds)[0];
            return _items.TryGetValue(Key(identity.ItemType, provider.Name, provider.Value, identity.SeasonNumber, identity.EpisodeNumber, identity.EpisodeEnd), out var items)
                ? items.Where(i => includeUnavailable ? SameIdentity(identity, i) : Verified(identity, i)).ToArray() : [];
        }
        public IReadOnlyList<AutomationLibraryItem> FindTitle(Reference reference, int? year)
            => _titles.TryGetValue(reference.ItemType + ":" + NormalizeTitle(RecoveryTitle(reference)), out var items)
                ? items.Where(i => !year.HasValue || i.Year == year).ToArray() : [];
    }

    public sealed record Reference(string ReferenceId, string RowId, string NodeId, string ItemId, string Title, string ItemType, MediaIdentity? Identity,
        string RangeMode = "Full", int StartSeason = 0, int EndSeason = 0, int StartEpisode = 0, int EndEpisode = 0);
    public static IEnumerable<Reference> References(PluginConfiguration config)
    {
        foreach (var link in config.MediaLinks) yield return new(link.Id, "", link.NodeId, link.JellyfinItemId, link.DisplayName, link.ItemType, link.Identity,
            link.RangeMode, link.StartSeason, link.EndSeason, link.StartEpisode, link.EndEpisode);
        foreach (var row in config.Rows)
            foreach (var entry in row.Items) yield return new(entry.Id, row.Id, row.ParentNodeId, entry.JellyfinItemId, entry.DisplayName, entry.ItemType, entry.Identity,
                entry.RangeMode, entry.StartSeason, entry.EndSeason, entry.StartEpisode, entry.EndEpisode);
        foreach (var node in config.Nodes.Where(n => n.CollectionId.Length > 0))
            yield return new("collection:" + node.Id, "", node.Id, node.CollectionId, node.Name, "BoxSet", config.MediaRecovery.KnownItems.FirstOrDefault(s => Id(s.ItemId) == Id(node.CollectionId))?.Identity);
    }

    private static string NormalizeTitle(string value) => Regex.Replace((value ?? "").Normalize(NormalizationForm.FormKC).Trim(), @"\s+", " ");

    private static string RecoveryTitle(Reference reference)
    {
        if (reference.ItemType != "Series" || reference.RangeMode is not ("Episodes" or "Seasons")) return reference.Title;
        var pattern = reference.RangeMode == "Episodes"
            ? @"\s+(?:[·\-–—]\s+)?S(?<s>\d+)E(?<e>\d+)(?:\s*[-–—]\s*S(?<es>\d+)E(?<ee>\d+))?$"
            : @"\s+(?:[·\-–—]\s+)?S(?<s>\d+)(?:\s*[-–—]\s*S(?<es>\d+))?$";
        var match = Regex.Match(reference.Title, pattern, RegexOptions.IgnoreCase);
        if (!match.Success || !int.TryParse(match.Groups["s"].Value, out var season) || season != reference.StartSeason) return reference.Title;
        var endSeason = season;
        if (match.Groups["es"].Success && !int.TryParse(match.Groups["es"].Value, out endSeason) || endSeason != reference.EndSeason) return reference.Title;
        if (reference.RangeMode == "Episodes")
        {
            if (!int.TryParse(match.Groups["e"].Value, out var episode) || episode != reference.StartEpisode) return reference.Title;
            var endEpisode = episode;
            if (match.Groups["ee"].Success && !int.TryParse(match.Groups["ee"].Value, out endEpisode) || endEpisode != reference.EndEpisode) return reference.Title;
        }
        return reference.Title[..match.Index];
    }

    private static bool HasProviderEvidence(MediaIdentity? identity) => identity is not null && (identity.ProviderIds.Count > 0 || identity.SeriesProviderIds.Count > 0);

    private static bool CanUseTitle(PluginConfiguration config, Reference reference)
    {
        if (reference.ItemType is not ("Movie" or "Series" or "BoxSet") || NormalizeTitle(RecoveryTitle(reference)).Length == 0) return false;
        var saved = config.MediaRecovery.KnownItems.FirstOrDefault(s => Id(s.ItemId) == Id(reference.ItemId))?.Identity;
        // Unresolved historical evidence is not absence of evidence. In particular, stale import
        // provenance after a manual retarget must not acquire automatic permission from its title.
        return !HasProviderEvidence(reference.Identity) && !HasProviderEvidence(saved)
            && (reference.Identity is null || reference.Identity.ItemType.Length == 0 || reference.Identity.ItemType == reference.ItemType)
            && (saved is null || saved.ItemType.Length == 0 || saved.ItemType == reference.ItemType)
            && !(reference.Identity?.Year is int year && saved?.Year is int savedYear && year != savedYear)
            && !config.Nodes.SelectMany(n => n.AutoAddRecords).Any(r => r.ReferenceId == reference.ReferenceId && r.ImdbIds.Count > 0)
            && !config.AutoFranchises.Ownership.Any(o => o.ReferenceId == reference.ReferenceId && (o.ProviderId.Length > 0 || o.SeriesProviderId.Length > 0));
    }

    public static IReadOnlyList<AutomationLibraryItem> Matches(PluginConfiguration config, Reference reference, MediaIdentity? identity, CandidateLookup lookup)
    {
        if (Stable(identity)) return lookup.Find(identity, true).Where(i => i.ItemType == reference.ItemType).ToArray();
        if (!CanUseTitle(config, reference)) return [];
        var year = reference.Identity?.Year ?? config.MediaRecovery.KnownItems.FirstOrDefault(s => Id(s.ItemId) == Id(reference.ItemId))?.Identity.Year;
        return lookup.FindTitle(reference, year);
    }

    public static MediaIdentity? IdentityFor(PluginConfiguration config, Reference reference, IReadOnlyList<AutomationLibraryItem> items)
    {
        if (Stable(reference.Identity)) return reference.Identity;
        var saved = config.MediaRecovery.KnownItems.FirstOrDefault(s => Id(s.ItemId) == Id(reference.ItemId))?.Identity;
        if (Stable(saved)) return saved;
        var evidence = new List<MediaIdentity>();
        foreach (var record in config.Nodes.SelectMany(n => n.AutoAddRecords)
            .Where(r => r.ReferenceId == reference.ReferenceId && r.RowId == reference.RowId && LegacyReferenceMatches(r, reference)))
        {
            var identity = LegacyIdentity(reference.ItemType, record.ImdbIds, items);
            if (!Stable(identity)) return reference.Identity; // Partial or conflicting historical evidence needs review.
            evidence.Add(identity!);
        }
        foreach (var owner in config.AutoFranchises.Ownership.Where(o => o.ReferenceId == reference.ReferenceId
            && Id(o.ItemId) == Id(reference.ItemId) && o.ItemType == reference.ItemType
            && (reference.RowId.Length > 0 ? o.RowId == reference.RowId : config.Rows.Any(r => r.Id == o.RowId && r.MediaLinkIds.Contains(reference.ReferenceId)))))
        {
            var identity = LegacyIdentity(reference.ItemType, new[] { owner.ProviderId }, items);
            if (!Stable(identity)) return reference.Identity;
            if (reference.ItemType == "Series" && owner.SeriesProviderId.Length > 0
                && !identity!.ProviderIds.Any(p => p.Name == "Imdb" && p.Value.Equals(owner.SeriesProviderId, StringComparison.OrdinalIgnoreCase))) return reference.Identity;
            if (reference.ItemType == "Episode" && (owner.SeriesProviderId.Length > 0
                    && !identity!.SeriesProviderIds.Any(p => p.Name == "Imdb" && p.Value.Equals(owner.SeriesProviderId, StringComparison.OrdinalIgnoreCase))
                || owner.StartEpisode > 0 && (identity!.SeasonNumber != owner.StartSeason || identity.EpisodeNumber != owner.StartEpisode
                    || owner.EndSeason != owner.StartSeason || identity.EpisodeEnd != owner.EndEpisode))) return reference.Identity;
            evidence.Add(identity!);
        }
        if (evidence.Count == 0) return reference.Identity;
        var merged = evidence[0];
        foreach (var identity in evidence.Skip(1))
        {
            if (merged.ItemType != identity.ItemType || merged.SeasonNumber != identity.SeasonNumber || merged.EpisodeNumber != identity.EpisodeNumber || merged.EpisodeEnd != identity.EpisodeEnd
                || !MergeProviders(merged.ProviderIds, identity.ProviderIds) || !MergeProviders(merged.SeriesProviderIds, identity.SeriesProviderIds)) return reference.Identity;
        }
        return merged;
    }

    // Native Auto-Add signatures are canonical JSON with a nested `ref`. Only the original
    // item/type establish provenance; later title, artwork, membership and range edits are retained.
    private static bool LegacyReferenceMatches(FranchiseAutoAddRecord record, Reference reference)
    {
        try
        {
            var prior = JsonNode.Parse(record.Signature)?["ref"];
            return prior is JsonObject && Id(prior["Id"]?.GetValue<string>()) == Id(reference.ReferenceId)
                && Id(prior["JellyfinItemId"]?.GetValue<string>()) == Id(reference.ItemId)
                && prior["ItemType"]?.GetValue<string>() == reference.ItemType;
        }
        catch (JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    private static bool MergeProviders(List<MediaProviderIdentity> target, List<MediaProviderIdentity> source)
    {
        foreach (var provider in source)
        {
            var existing = target.FirstOrDefault(p => p.Name == provider.Name);
            if (existing is not null && existing.Value != provider.Value) return false;
            if (existing is null) target.Add(new() { Name = provider.Name, Value = provider.Value });
        }
        target.Sort((left, right) => StringComparer.Ordinal.Compare(left.Name, right.Name));
        return true;
    }

    private static MediaIdentity? LegacyIdentity(string type, IEnumerable<string> values, IReadOnlyList<AutomationLibraryItem> items)
    {
        var ids = values.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (ids.Length == 0 || ids.Any(id => !Regex.IsMatch(id ?? "", "^tt[0-9]{1,18}$", RegexOptions.IgnoreCase))) return null;
        if (type == "Movie") return ids.Length == 1 ? new() { ItemType = type, ProviderIds = new() { new() { Name = "Imdb", Value = ids[0].ToLowerInvariant() } } } : null;
        if (type is not ("Series" or "Episode") || type == "Episode" && ids.Length != 1) return null;
        MediaIdentity? identity = null;
        foreach (var imdb in ids)
        {
            var matches = items.Where(i => i.IsAvailable && i.ProviderIds.Any(p => p.Key.Equals("Imdb", StringComparison.OrdinalIgnoreCase) && p.Value.Equals(imdb, StringComparison.OrdinalIgnoreCase))).ToArray();
            if (matches.Length == 0) return null;
            foreach (var match in matches)
            {
                var item = type == "Series" && match.ItemType == "Episode" ? items.FirstOrDefault(i => i.IsAvailable && i.ItemType == "Series" && Id(i.Id) == Id(match.SeriesId)) : match;
                if (item?.ItemType != type) return null;
                var next = Capture(item); next.Year = null;
                if (!Stable(next)) return null;
                if (identity is null) identity = next;
                else if (identity.SeasonNumber != next.SeasonNumber || identity.EpisodeNumber != next.EpisodeNumber || identity.EpisodeEnd != next.EpisodeEnd
                    || !ExactProviders(identity.ProviderIds, next.ProviderIds) || !ExactProviders(next.ProviderIds, identity.ProviderIds)
                    || type == "Episode" && (!ExactProviders(identity.SeriesProviderIds, next.SeriesProviderIds) || !ExactProviders(next.SeriesProviderIds, identity.SeriesProviderIds))) return null;
            }
        }
        return identity;
    }

    public static MediaRecoveryCandidate Candidate(AutomationLibraryItem item, MediaIdentity? identity) => new()
    { ItemId = item.Id, Title = item.Name, ItemType = item.ItemType, Year = item.Year, ProviderIds = Capture(item).ProviderIds, Verified = Verified(identity, item) };

    public static MediaRecoveryStatus Review(PluginConfiguration config, FranchiseLibrarySnapshot library)
    {
        var result = new MediaRecoveryStatus { Revision = Revision(config), LibraryRevision = library.Revision, LibraryHealthy = library.Healthy, CanSearch = library.CanSearch,
            Enabled = config.MediaRecovery.Enabled, AutoReconnect = config.MediaRecovery.AutoReconnect, CheckedUtc = DateTimeOffset.UtcNow, Message = library.Message };
        var byId = library.Items.GroupBy(i => Id(i.Id)).ToDictionary(g => g.Key, g => g.First());
        CandidateLookup? lookup = null;
        foreach (var reference in References(config))
        {
            var current = byId.GetValueOrDefault(Id(reference.ItemId));
            var identity = IdentityFor(config, reference, library.Items);
            var currentHealthy = current is { IsAvailable: true } && current.ItemType == reference.ItemType && (!Stable(identity) || Verified(identity, current));
            var matches = currentHealthy ? [] : Matches(config, reference, identity, lookup ??= new(library.Items)).Where(i => Id(i.Id) != Id(reference.ItemId)).ToArray();
            var candidates = matches.Where(i => i.IsAvailable).Select(i => Candidate(i, identity)).ToList();
            var status = currentHealthy ? "Healthy" : current is not null ? "ManualReview" : matches.Length > 1 ? "Ambiguous"
                : matches.Length == 1 && candidates.Count == 1 ? "Verified" : !Stable(identity) ? "ManualReview" : "Missing";
            if (status == "Verified") candidates[0].Verified = true;
            result.Entries.Add(new() { ReferenceId = reference.ReferenceId, RowId = reference.RowId, NodeId = reference.NodeId, OldItemId = reference.ItemId,
                Title = reference.Title, ItemType = reference.ItemType, Status = status, Candidates = status == "Healthy" ? new() : candidates,
                CanAutoRemap = status == "Verified" && library.CanSearch && current is null && !string.IsNullOrWhiteSpace(reference.ItemId),
                MatchMethod = status == "Verified" ? Stable(identity) ? "Provider identity" : "Exact title and type" : "",
                Reason = status switch { "Healthy" => "The saved Jellyfin item is available.", "Verified" when Stable(identity) => "One exact provider and media identity matches.", "Verified" => "One library item has the exact saved title and media type, with no conflicting identity evidence.", "Ambiguous" => "Several library versions match. Choose a version.", "Missing" => "No verified replacement is available; the saved reference is retained.",
                    _ when current is { IsAvailable: true } => "The saved Jellyfin item conflicts with its recorded media identity. Review the replacement explicitly.",
                    _ when current is not null => "The saved Jellyfin item is still in the library but its media is offline. Restore its storage or choose a replacement explicitly.",
                    _ => "No unique exact replacement can be confirmed from the saved identity or title. Search and choose a replacement explicitly." } });
        }
        // Every occurrence of one old native ID changes together. Hold the whole group when
        // its references disagree, so one clear title cannot silently retarget another reference.
        foreach (var group in result.Entries.GroupBy(e => Id(e.OldItemId)))
            if (group.Any(e => e.Status == "Verified") && (group.Any(e => e.Status != "Verified")
                || group.Select(e => Id(e.Candidates.Single().ItemId)).Distinct().Count() != 1))
                foreach (var entry in group.Where(e => e.Status == "Verified"))
                { entry.Status = "ManualReview"; entry.CanAutoRemap = false; entry.Reason = "Other references to this saved item disagree about its replacement. Review them together."; }
        return result;
    }

    public static bool CaptureSnapshots(PluginConfiguration config, IReadOnlyList<AutomationLibraryItem> items, IEnumerable<string>? progressIds = null)
    {
        var before = Revision(config);
        var byId = items.Where(i => i.IsAvailable).GroupBy(i => Id(i.Id)).ToDictionary(g => g.Key, g => g.First());
        // A reused native ID must not overwrite the provider evidence saved by a legacy import.
        var conflicts = new HashSet<string>();
        foreach (var reference in References(config))
            if (byId.TryGetValue(Id(reference.ItemId), out var current))
            {
                var identity = IdentityFor(config, reference, items);
                if (Stable(identity) && !Verified(identity, current)) conflicts.Add(Id(reference.ItemId));
            }
        var cleanLegacy = config.Nodes.SelectMany(n => n.AutoAddRecords).Where(r => LegacySignatureMatches(config, r)).ToList();
        foreach (var link in config.MediaLinks)
            if (!conflicts.Contains(Id(link.JellyfinItemId)) && byId.TryGetValue(Id(link.JellyfinItemId), out var item) && item.ItemType == link.ItemType && (!Stable(link.Identity) || Verified(link.Identity, item))) link.Identity = Capture(item);
        foreach (var entry in config.Rows.SelectMany(r => r.Items))
            if (!conflicts.Contains(Id(entry.JellyfinItemId)) && byId.TryGetValue(Id(entry.JellyfinItemId), out var item) && item.ItemType == entry.ItemType && (!Stable(entry.Identity) || Verified(entry.Identity, item))) entry.Identity = Capture(item);
        var needed = References(config).Select(r => Id(r.ItemId)).ToHashSet();
        foreach (var id in progressIds ?? []) needed.Add(Id(id));
        foreach (var item in items.Where(i => i.ItemType == "Episode" && needed.Contains(Id(i.SeriesId))).ToList()) needed.Add(Id(item.Id));
        foreach (var art in AllArtwork(config))
        {
            if (Guid.TryParse(art.BackdropVideoItemId, out _)) needed.Add(Id(art.BackdropVideoItemId));
            foreach (var url in new[] { art.PrimaryUrl, art.BackdropUrl, art.LogoUrl, art.ThumbUrl, art.BannerUrl })
                foreach (Match match in Regex.Matches(url ?? "", @"/Items/([a-fA-F0-9-]{32,36})/Images/", RegexOptions.IgnoreCase)) needed.Add(Id(match.Groups[1].Value));
        }
        var known = config.MediaRecovery.KnownItems.GroupBy(s => Id(s.ItemId)).ToDictionary(g => g.Key, g => g.First());
        foreach (var id in needed)
            if (!conflicts.Contains(id) && byId.TryGetValue(id, out var item) && (!known.TryGetValue(id, out var prior) || !Stable(prior.Identity) || Verified(prior.Identity, item)))
                known[id] = new() { ItemId = item.Id, SeriesItemId = item.SeriesId, Identity = Capture(item) };
        config.MediaRecovery.KnownItems = known.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Value).ToList();
        foreach (var record in cleanLegacy) record.Signature = LegacySignature(config, record);
        return Revision(config) != before;
    }

    public static IEnumerable<ArtworkMetadata> AllArtwork(PluginConfiguration config) => config.Nodes.Select(n => n.Artwork).Concat(config.Rows.Select(r => r.Artwork)).Concat(config.MediaLinks.Select(l => l.Artwork)).Concat(config.Rows.SelectMany(r => r.Items).Select(e => e.Artwork));

    public static PluginConfiguration ApplyMappings(PluginConfiguration config, IReadOnlyDictionary<string, string> mapping, IReadOnlyList<AutomationLibraryItem> items)
    {
        var next = Clone(config);
        var map = mapping.ToDictionary(p => Id(p.Key), p => p.Value, StringComparer.Ordinal);
        var cleanLegacy = next.Nodes.SelectMany(n => n.AutoAddRecords).Where(r => LegacySignatureMatches(next, r)).ToList();
        var cleanOwnership = next.AutoFranchises.Ownership.Where(o => o.Signature.Length > 0 && AutoFranchisePlanner.Signature(next, o) == o.Signature).ToList();
        var editedLegacy = next.Nodes.SelectMany(n => n.AutoAddRecords).Where(r => r.Signature.Length > 0 && !cleanLegacy.Contains(r)).ToList();
        var editedOwnership = next.AutoFranchises.Ownership.Where(o => o.Signature.Length > 0 && !cleanOwnership.Contains(o)).ToList();
        string Remap(string id) => map.GetValueOrDefault(Id(id), id);
        foreach (var link in next.MediaLinks) link.JellyfinItemId = Remap(link.JellyfinItemId);
        foreach (var entry in next.Rows.SelectMany(r => r.Items)) entry.JellyfinItemId = Remap(entry.JellyfinItemId);
        foreach (var node in next.Nodes) node.CollectionId = Remap(node.CollectionId);
        foreach (var art in AllArtwork(next))
        {
            string Url(string url) => Regex.Replace(url ?? "", @"(/Items/)([a-fA-F0-9-]{32,36})(/Images/)", match => match.Groups[1].Value + Remap(match.Groups[2].Value) + match.Groups[3].Value, RegexOptions.IgnoreCase);
            art.PrimaryUrl = Url(art.PrimaryUrl); art.BackdropUrl = Url(art.BackdropUrl); art.LogoUrl = Url(art.LogoUrl); art.ThumbUrl = Url(art.ThumbUrl); art.BannerUrl = Url(art.BannerUrl);
            art.BackdropVideoItemId = Remap(art.BackdropVideoItemId);
        }
        foreach (var snapshot in next.MediaRecovery.KnownItems) { snapshot.ItemId = Remap(snapshot.ItemId); snapshot.SeriesItemId = Remap(snapshot.SeriesItemId); }
        foreach (var own in next.AutoFranchises.Ownership)
        {
            own.ItemId = Remap(own.ItemId);
            own.EpisodeIds = own.EpisodeIds.Select(Remap).ToList();
        }
        foreach (var exclusion in next.AutoFranchises.Exclusions) exclusion.JellyfinItemId = Remap(exclusion.JellyfinItemId);
        foreach (var change in next.AutoFranchises.PendingChanges)
        {
            change.ItemId = Remap(change.ItemId);
            change.SeriesId = Remap(change.SeriesId);
            change.EpisodeIds = change.EpisodeIds.Select(Remap).ToList();
        }
        CaptureSnapshots(next, items);
        foreach (var record in cleanLegacy) record.Signature = LegacySignature(next, record);
        foreach (var ownership in cleanOwnership) ownership.Signature = AutoFranchisePlanner.Signature(next, ownership);
        // A repair can coincidentally return an edited field to an old baseline. Keep that import protected.
        foreach (var record in editedLegacy.Where(r => LegacySignatureMatches(next, r))) record.Signature = "EditedBeforeMediaRecovery:" + record.Signature;
        foreach (var ownership in editedOwnership.Where(o => AutoFranchisePlanner.Signature(next, o) == o.Signature)) ownership.Signature = "EditedBeforeMediaRecovery:" + ownership.Signature;
        return next;
    }

    private static JsonObject? LegacyObject(PluginConfiguration config, FranchiseAutoAddRecord record)
    {
        object? reference = record.RowId.Length > 0 ? config.Rows.FirstOrDefault(r => r.Id == record.RowId)?.Items.FirstOrDefault(i => i.Id == record.ReferenceId) : config.MediaLinks.FirstOrDefault(l => l.Id == record.ReferenceId);
        if (reference is null) return null;
        var result = JsonSerializer.SerializeToNode(new { @ref = reference, memberships = config.Rows.Where(r => r.Id == record.RowId || r.MediaLinkIds.Contains(record.ReferenceId)).Select(r => new { r.Id, r.Name, r.ParentNodeId, r.RowType, Index = r.MediaOrder.IndexOf(record.ReferenceId) }) })!.AsObject();
        // The editor removes empty Artwork from refs before computing its JavaScript fingerprint.
        if (result["ref"] is JsonObject refObject && refObject["Artwork"] is JsonObject artwork && artwork.All(p => p.Value is null || p.Value.GetValue<string>() == "")) refObject.Remove("Artwork");
        return result;
    }
    private static string Canonical(JsonNode node) => node switch
    {
        JsonObject obj => "{" + string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => JsonSerializer.Serialize(p.Key) + ":" + (p.Value is null ? "null" : Canonical(p.Value)))) + "}",
        JsonArray array => "[" + string.Join(",", array.Select(p => p is null ? "null" : Canonical(p))) + "]", JsonValue value when value.TryGetValue<string>(out var str) => JavascriptString(str), _ => node.ToJsonString()
    };
    private static string JavascriptString(string value)
    {
        var result = new StringBuilder("\"");
        for (var index = 0; index < value.Length; index++)
        {
            var c = value[index];
            switch (c)
            {
                case '"': result.Append("\\\""); break; case '\\': result.Append("\\\\"); break;
                case '\b': result.Append("\\b"); break; case '\f': result.Append("\\f"); break;
                case '\n': result.Append("\\n"); break; case '\r': result.Append("\\r"); break; case '\t': result.Append("\\t"); break;
                default:
                    if (c < 32 || char.IsSurrogate(c) && !(char.IsHighSurrogate(c) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1])) && !(char.IsLowSurrogate(c) && index > 0 && char.IsHighSurrogate(value[index - 1]))) result.Append("\\u").Append(((int)c).ToString("x4"));
                    else result.Append(c);
                    break;
            }
        }
        return result.Append('"').ToString();
    }
    public static string LegacySignature(PluginConfiguration config, FranchiseAutoAddRecord record) => LegacyObject(config, record) is { } obj ? Canonical(obj) : "";
    public static bool LegacySignatureMatches(PluginConfiguration config, FranchiseAutoAddRecord record)
    {
        if (record.Signature.Length == 0) return false;
        try
        {
            var expected = JsonNode.Parse(record.Signature)?.AsObject();
            var actual = LegacyObject(config, record);
            if (expected is null || actual is null) return false;
            // Server serializers have historically included empty defaults that the editor omitted.
            if (expected["ref"] is JsonObject priorRef && priorRef["Artwork"] is JsonObject priorArtwork && priorArtwork.All(p => p.Value is null || p.Value.GetValue<string>() == "")) priorRef.Remove("Artwork");
            // Snapshots were added after legacy imports; missing snapshot metadata is not an edit.
            if (expected["ref"] is JsonObject oldRef && !oldRef.ContainsKey("Identity")) actual["ref"]!.AsObject().Remove("Identity");
            return JsonNode.DeepEquals(expected, actual);
        }
        catch (JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
    }
}
