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
    public List<MediaRecoveryCandidate> Candidates { get; set; } = new();
}

public sealed class MediaRecoveryStatus
{
    public string Revision { get; set; } = string.Empty;
    public string LibraryRevision { get; set; } = string.Empty;
    public bool LibraryHealthy { get; set; }
    public bool Enabled { get; set; }
    public bool AutoReconnect { get; set; }
    public DateTimeOffset CheckedUtc { get; set; }
    public string Message { get; set; } = string.Empty;
    public List<MediaRecoveryEntry> Entries { get; set; } = new();
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

/// <summary>Conservative provider matching and reversible configuration transformation; no title guessing.</summary>
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

    public static bool Verified(MediaIdentity? expected, AutomationLibraryItem candidate)
    {
        if (!candidate.IsAvailable || !Stable(expected)) return false;
        var actual = Capture(candidate);
        if (expected!.ItemType != actual.ItemType || expected.Year.HasValue && expected.Year != actual.Year) return false;
        if (expected.ItemType != "Episode") return ExactProviders(expected.ProviderIds, actual.ProviderIds);
        return ExactProviders(expected.SeriesProviderIds, actual.SeriesProviderIds)
            && expected.SeasonNumber == actual.SeasonNumber && expected.EpisodeNumber == actual.EpisodeNumber
            && (expected.EpisodeEnd ?? expected.EpisodeNumber) == actual.EpisodeEnd
            && (expected.ProviderIds.Count == 0 || ExactProviders(expected.ProviderIds, actual.ProviderIds));
    }

    /// <summary>Indexes provider identities once per check, including episode coordinates, for large libraries.</summary>
    public sealed class CandidateLookup
    {
        private readonly Dictionary<string, List<AutomationLibraryItem>> _items = new(StringComparer.OrdinalIgnoreCase);
        private static string Key(string type, string provider, string value, int? season, int? episode, int? end)
            => type + ":" + provider + ":" + value + (type == "Episode" ? ":" + season + ":" + episode + ":" + (end ?? episode) : "");
        public CandidateLookup(IReadOnlyList<AutomationLibraryItem> items)
        {
            foreach (var item in items.Where(i => i.IsAvailable))
                foreach (var provider in item.ItemType == "Episode" ? item.SeriesProviderIds : item.ProviderIds)
                {
                    var key = Key(item.ItemType, provider.Key, provider.Value, item.SeasonNumber, item.EpisodeNumber, item.EpisodeEnd);
                    if (!_items.TryGetValue(key, out var matches)) _items[key] = matches = new();
                    matches.Add(item);
                }
        }
        public IReadOnlyList<AutomationLibraryItem> Find(MediaIdentity? identity)
        {
            if (!Stable(identity)) return [];
            var provider = (identity!.ItemType == "Episode" ? identity.SeriesProviderIds : identity.ProviderIds)[0];
            return _items.TryGetValue(Key(identity.ItemType, provider.Name, provider.Value, identity.SeasonNumber, identity.EpisodeNumber, identity.EpisodeEnd), out var items)
                ? items.Where(i => Verified(identity, i)).ToArray() : [];
        }
    }

    public sealed record Reference(string ReferenceId, string RowId, string NodeId, string ItemId, string Title, string ItemType, MediaIdentity? Identity);
    public static IEnumerable<Reference> References(PluginConfiguration config)
    {
        foreach (var link in config.MediaLinks) yield return new(link.Id, "", link.NodeId, link.JellyfinItemId, link.DisplayName, link.ItemType, link.Identity);
        foreach (var row in config.Rows)
            foreach (var entry in row.Items) yield return new(entry.Id, row.Id, row.ParentNodeId, entry.JellyfinItemId, entry.DisplayName, entry.ItemType, entry.Identity);
        foreach (var node in config.Nodes.Where(n => n.CollectionId.Length > 0))
            yield return new("collection:" + node.Id, "", node.Id, node.CollectionId, node.Name, "BoxSet", config.MediaRecovery.KnownItems.FirstOrDefault(s => Id(s.ItemId) == Id(node.CollectionId))?.Identity);
    }

    public static MediaIdentity? IdentityFor(PluginConfiguration config, Reference reference, IReadOnlyList<AutomationLibraryItem> items)
    {
        if (Stable(reference.Identity)) return reference.Identity;
        var saved = config.MediaRecovery.KnownItems.FirstOrDefault(s => Id(s.ItemId) == Id(reference.ItemId))?.Identity;
        if (Stable(saved)) return saved;
        // A legacy series range may have recorded IMDb episode IDs rather than its show ID.
        // Every recorded ID must resolve consistently to the same parent; partial evidence is held.
        if (reference.ItemType != "Series") return reference.Identity;
        var records = config.Nodes.SelectMany(n => n.AutoAddRecords).Where(r => r.ReferenceId == reference.ReferenceId && r.RowId == reference.RowId).ToList();
        var ids = records.SelectMany(r => r.ImdbIds).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (ids.Count == 0) return reference.Identity;
        var parentIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var imdb in ids)
        {
            var matches = items.Where(i => i.IsAvailable && i.ProviderIds.Any(p => p.Key.Equals("Imdb", StringComparison.OrdinalIgnoreCase) && p.Value.Equals(imdb, StringComparison.OrdinalIgnoreCase))).ToList();
            if (matches.Count != 1 || matches[0].ItemType is not ("Episode" or "Series")) return reference.Identity;
            parentIds.Add(Id(matches[0].ItemType == "Series" ? matches[0].Id : matches[0].SeriesId));
        }
        if (parentIds.Count != 1) return reference.Identity;
        var parent = items.SingleOrDefault(i => i.ItemType == "Series" && Id(i.Id) == parentIds.Single());
        return parent is null ? reference.Identity : Capture(parent);
    }

    public static MediaRecoveryCandidate Candidate(AutomationLibraryItem item, MediaIdentity? identity) => new()
    { ItemId = item.Id, Title = item.Name, ItemType = item.ItemType, Year = item.Year, ProviderIds = Capture(item).ProviderIds, Verified = Verified(identity, item) };

    public static MediaRecoveryStatus Review(PluginConfiguration config, FranchiseLibrarySnapshot library)
    {
        var result = new MediaRecoveryStatus { Revision = Revision(config), LibraryRevision = library.Revision, LibraryHealthy = library.Healthy,
            Enabled = config.MediaRecovery.Enabled, AutoReconnect = config.MediaRecovery.AutoReconnect, CheckedUtc = DateTimeOffset.UtcNow, Message = library.Message };
        var byId = library.Items.GroupBy(i => Id(i.Id)).ToDictionary(g => g.Key, g => g.First());
        CandidateLookup? lookup = null;
        foreach (var reference in References(config))
        {
            var current = byId.GetValueOrDefault(Id(reference.ItemId));
            var identity = IdentityFor(config, reference, library.Items);
            var currentHealthy = current is { IsAvailable: true } && current.ItemType == reference.ItemType && (!Stable(identity) || Verified(identity, current));
            var candidates = currentHealthy || !Stable(identity) ? new List<MediaRecoveryCandidate>() : (lookup ??= new(library.Items)).Find(identity).Where(i => Id(i.Id) != Id(reference.ItemId)).Select(i => Candidate(i, identity)).ToList();
            var status = currentHealthy ? "Healthy" : current is { IsAvailable: true } ? "ManualReview" : !Stable(identity) ? "ManualReview" : candidates.Count == 1 ? "Verified" : candidates.Count > 1 ? "Ambiguous" : "Missing";
            result.Entries.Add(new() { ReferenceId = reference.ReferenceId, RowId = reference.RowId, NodeId = reference.NodeId, OldItemId = reference.ItemId,
                Title = reference.Title, ItemType = reference.ItemType, Status = status, Candidates = status == "Healthy" ? new() : candidates,
                Reason = status switch { "Healthy" => "The saved Jellyfin item is available.", "Verified" => "One exact provider and media identity matches.", "Ambiguous" => "Several library versions share this identity. Choose a version.", "Missing" => "No verified replacement is available; the saved reference is retained.", _ => "No durable identity is available. Search and choose a replacement explicitly." } });
        }
        return result;
    }

    public static bool CaptureSnapshots(PluginConfiguration config, IReadOnlyList<AutomationLibraryItem> items, IEnumerable<string>? progressIds = null)
    {
        var before = Revision(config);
        var byId = items.Where(i => i.IsAvailable).GroupBy(i => Id(i.Id)).ToDictionary(g => g.Key, g => g.First());
        var cleanLegacy = config.Nodes.SelectMany(n => n.AutoAddRecords).Where(r => LegacySignatureMatches(config, r)).ToList();
        foreach (var link in config.MediaLinks)
            if (byId.TryGetValue(Id(link.JellyfinItemId), out var item) && item.ItemType == link.ItemType && (!Stable(link.Identity) || Verified(link.Identity, item))) link.Identity = Capture(item);
        foreach (var entry in config.Rows.SelectMany(r => r.Items))
            if (byId.TryGetValue(Id(entry.JellyfinItemId), out var item) && item.ItemType == entry.ItemType && (!Stable(entry.Identity) || Verified(entry.Identity, item))) entry.Identity = Capture(item);
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
            if (byId.TryGetValue(id, out var item) && (!known.TryGetValue(id, out var prior) || !Stable(prior.Identity) || Verified(prior.Identity, item)))
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
