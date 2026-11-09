using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

/// <summary>A detached library snapshot. The planner never calls Jellyfin or writes native library data.</summary>
public sealed class AutomationLibraryItem
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string ItemType { get; set; } = string.Empty;
    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public string SeriesId { get; set; } = string.Empty;
    public Dictionary<string, string> SeriesProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public int? SeasonNumber { get; set; }
    public int? EpisodeNumber { get; set; }
    public int? EpisodeEnd { get; set; }
    public int? Year { get; set; }
    public bool IsAvailable { get; set; } = true;
}

/// <summary>A read-only proposal computed from a single complete source/library snapshot.</summary>
public sealed class AutoFranchisePlan
{
    public IReadOnlyList<AutoFranchiseChange> SafeAdditions { get; internal init; } = Array.Empty<AutoFranchiseChange>();
    public IReadOnlyList<AutoFranchiseChange> Pending { get; internal init; } = Array.Empty<AutoFranchiseChange>();
    public IReadOnlyList<AutoFranchiseChange> Missing { get; internal init; } = Array.Empty<AutoFranchiseChange>();
    public bool SourceFailed { get; internal init; }
    internal string RegistrationId { get; init; } = string.Empty;
    internal string NodeId { get; init; } = string.Empty;
    internal bool DeletedNode { get; init; }
    internal IReadOnlyList<string> DeletedRows { get; init; } = Array.Empty<string>();
    internal IReadOnlyList<AutoFranchiseExclusion> Protections { get; init; } = Array.Empty<AutoFranchiseExclusion>();
    internal IReadOnlyDictionary<string, IReadOnlyList<AutoFranchiseChange>> ReplacementAdditions { get; init; } = new Dictionary<string, IReadOnlyList<AutoFranchiseChange>>();
}

/// <summary>Pure, conservative reconciliation; callers supply clones to Apply and own persistence/locking.</summary>
public sealed class AutoFranchisePlanner
{
    private static readonly string[] Kinds = { "TVShows", "Movies", "ChronologicalOrder" };
    private sealed record Atom(AutomationLibraryItem Item, AutomationLibraryItem? Show, int Position, int Sequence, int Boundary)
    {
        public bool Episode => Show is not null && Item.ItemType == "Episode";
        public int Season => Item.SeasonNumber ?? 0;
        public int First => Item.EpisodeNumber ?? 0;
        public int Last => Math.Max(First, Item.EpisodeEnd ?? First);
        public string Identity => Episode ? Show!.Id : Item.Id;
    }
    private sealed record Reference(string Id, string ItemId, string ItemType, string RangeMode, int StartSeason, int EndSeason, int StartEpisode, int EndEpisode);

    public AutoFranchisePlan Plan(PluginConfiguration config, AutoFranchiseSettings settings, AutoFranchiseRegistration registration,
        IReadOnlyList<AutomationLibraryItem> library, IReadOnlyList<FranchiseAutoAddController.Entry> source,
        bool orderVerified, string? sourceError = null)
    {
        if (!settings.Enabled || !registration.Enabled || !settings.Registry.Any(r => SameId(r.Id, registration.Id) && r.Enabled)) return new();
        var nodeId = registration.FranchiseNodeId.Length == 0 ? AutoFranchiseDefaults.StableGuid(registration.Id + ":node") : registration.FranchiseNodeId;
        var deletedNode = registration.Deleted || (registration.FranchiseNodeId.Length != 0 && config.Nodes.All(n => !SameId(n.Id, nodeId)));
        var safe = new List<AutoFranchiseChange>();
        var pending = new List<AutoFranchiseChange>();
        var missing = new List<AutoFranchiseChange>();
        var deletedRows = registration.Rows.Where(m => m.Deleted || config.Rows.All(r => !SameId(r.Id, m.RowId))).Select(m => m.RowId).ToHashSet();
        var protections = new List<AutoFranchiseExclusion>();
        var replacements = new Dictionary<string, IReadOnlyList<AutoFranchiseChange>>();
        var owned = settings.Ownership.Where(o => SameId(o.RegistrationId, registration.Id)).ToList();
        var rowIds = Kinds.ToDictionary(k => k, k => registration.Rows.FirstOrDefault(r => r.Kind == k)?.RowId ?? AutoFranchiseDefaults.StableGuid(registration.Id + ":row:" + k));
        AutoFranchisePlan Result(bool failed = false) => new()
        {
            RegistrationId = registration.Id, NodeId = nodeId, DeletedNode = deletedNode, DeletedRows = deletedRows.ToArray(),
            Protections = protections.AsReadOnly(), ReplacementAdditions = replacements, SafeAdditions = safe.DistinctBy(c => c.Id).ToList().AsReadOnly(),
            Pending = pending.DistinctBy(c => c.Id).ToList().AsReadOnly(), Missing = missing.DistinctBy(c => c.Id).ToList().AsReadOnly(), SourceFailed = failed
        };
        if (!string.IsNullOrEmpty(sourceError) || source.Count == 0)
        {
            var error = Change("SourceError", "", "", registration.Name, "", "", 0, sourceError ?? "The source returned no complete list; existing choices are preserved.");
            pending.Add(error);
            return Result(true);
        }
        // Every implicit manual protection is proposed as detached data first, then persisted only by Apply.
        foreach (var owner in owned)
        {
            if (deletedNode || ContainsId(deletedRows, owner.RowId)) continue;
            var current = Find(config, owner.RowId, owner.ReferenceId);
            if (current is null)
            {
                protections.Add(Protect(owner, null, "Reference deleted by you"));
            }
            else if (Signature(config, owner) != owner.Signature)
            {
                if (!SameId(current.ItemId, owner.ItemId))
                    protections.Add(Protect(owner, null, "Reference retargeted by you"));
                else if (current.ItemType == "Series" && current.RangeMode != "Full" &&
                    (current.StartSeason != owner.StartSeason || current.EndSeason != owner.EndSeason || current.StartEpisode != owner.StartEpisode || current.EndEpisode != owner.EndEpisode))
                    protections.Add(Protect(owner, current, "Manually restricted range"));
                pending.Add(OwnerChange(owner, "ManualConflict", "The reference was edited manually; its current range, artwork and choices are preserved.", current));
            }
        }
        foreach (var kind in Kinds)
        {
            var row = config.Rows.FirstOrDefault(r => SameId(r.Id, rowIds[kind]));
            if (row is null) continue;
            foreach (var reference in References(config, row).Where(r => r.ItemType == "Series" && r.RangeMode != "Full" && !owned.Any(o => SameId(o.RowId, row.Id) && SameId(o.ReferenceId, r.Id))))
            {
                var show = library.FirstOrDefault(i => SameId(i.Id, reference.ItemId) && i.ItemType == "Series");
                protections.Add(new()
                {
                    Id = AutoFranchiseDefaults.StableGuid(registration.Id + ":manual-range:" + row.Id + ":" + reference.Id),
                    RegistrationId = registration.Id, FranchiseNodeId = nodeId, RowId = row.Id, Scope = "AllowedRange",
                    ProviderId = show is null ? "" : Provider(show.ProviderIds), JellyfinItemId = reference.ItemId,
                    StartSeason = reference.StartSeason, EndSeason = reference.EndSeason, StartEpisode = reference.RangeMode == "Seasons" ? 1 : reference.StartEpisode,
                    EndEpisode = reference.RangeMode == "Seasons" ? int.MaxValue : reference.EndEpisode, Reason = "Manually restricted range"
                });
            }
        }
        var rules = settings.Exclusions.Where(e => e.Enabled).Concat(protections.Where(e => !settings.Exclusions.Any(old => old.Id == e.Id))).ToList();
        var series = library.Where(i => i.ItemType == "Series" && i.IsAvailable).GroupBy(i => IdentityId(i.Id)).ToDictionary(g => g.Key, g => g.First());
        var atoms = new List<Atom>();
        var shows = new List<Atom>();
        var movies = new List<Atom>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var episodeSlots = new HashSet<string>();
        var showSeen = new HashSet<string>();
        var boundary = 0;
        var sequence = 0;
        var entries = orderVerified ? source.OrderBy(e => e.Position ?? int.MaxValue).ToList() : source.ToList();
        foreach (var entry in entries)
        {
            var matches = library.Where(i => string.Equals(Provider(i.ProviderIds), entry.ImdbId, StringComparison.OrdinalIgnoreCase) &&
                (entry.Type is "Other" or "" || string.Equals(i.ItemType, entry.Type, StringComparison.OrdinalIgnoreCase))).DistinctBy(i => IdentityId(i.Id)).ToList();
            var position = entry.Position ?? ++sequence;
            if (matches.Count != 1 || !matches[0].IsAvailable)
            {
                missing.Add(Change(matches.Count > 1 ? "Ambiguous" : "Missing", "", "", entry.Title, entry.Type, entry.ImdbId, position,
                    matches.Count > 1 ? "Several library items have this IMDb identity; select the intended item." : "This source title is not available in the current library snapshot."));
                boundary++;
                continue;
            }
            var item = matches[0];
            if (item.ItemType == "Movie")
            {
                if (seen.Add("Movie:" + IdentityId(item.Id)))
                {
                    var atom = new Atom(item, null, position, ++sequence, ++boundary);
                    atoms.Add(atom); movies.Add(atom);
                }
                boundary++;
            }
            else if (item.ItemType == "Series")
            {
                if (showSeen.Add(IdentityId(item.Id))) shows.Add(new(item, null, position, ++sequence, boundary));
                var episodes = library.Where(i => i.ItemType == "Episode" && SameId(i.SeriesId, item.Id) && i.IsAvailable && i.SeasonNumber > 0 && i.EpisodeNumber > 0).DistinctBy(i => IdentityId(i.Id))
                    .OrderBy(i => i.SeasonNumber).ThenBy(i => i.EpisodeNumber).ThenBy(i => i.Id).ToList();
                if (episodes.Count == 0) missing.Add(Change("Missing", "ChronologicalOrder", rowIds["ChronologicalOrder"], item.Name, "Series", Provider(item.ProviderIds), position, "No accessible numbered episodes were found for this whole-show source entry."));
                foreach (var episode in episodes)
                {
                    if (EpisodeCovered(episode, item)) { boundary++; continue; }
                    if (episodes.Any(other => !SameId(other.Id, episode.Id) && other.SeasonNumber == episode.SeasonNumber && other.EpisodeNumber <= (episode.EpisodeEnd ?? episode.EpisodeNumber) && (other.EpisodeEnd ?? other.EpisodeNumber) >= episode.EpisodeNumber))
                    {
                        missing.Add(Change("Ambiguous", "ChronologicalOrder", rowIds["ChronologicalOrder"], episode.Name, "Episode", Provider(episode.ProviderIds), position, "Several physical episode items cover the same numbered episodes; a whole-show entry cannot choose a version."));
                        boundary++; continue;
                    }
                    AddEpisode(episode, item, position);
                }
                boundary++;
            }
            else if (item.ItemType == "Episode")
            {
                if (!series.TryGetValue(IdentityId(item.SeriesId), out var show) || item.SeasonNumber is null || item.SeasonNumber < 0 || item.EpisodeNumber is null || item.EpisodeNumber <= 0)
                {
                    missing.Add(Change("Missing", "ChronologicalOrder", rowIds["ChronologicalOrder"], item.Name, "Episode", entry.ImdbId, position, "The episode has no available parent series or valid episode numbering."));
                    boundary++; continue;
                }
                if (showSeen.Add(IdentityId(show.Id))) shows.Add(new(show, null, position, ++sequence, boundary));
                if (!AddEpisode(item, show, position)) boundary++;
            }
            else boundary++;
        }
        var desired = new Dictionary<string, List<Atom>> { ["TVShows"] = shows, ["Movies"] = movies, ["ChronologicalOrder"] = atoms };
        foreach (var kind in Kinds)
        {
            var rowId = rowIds[kind];
            var row = config.Rows.FirstOrDefault(r => SameId(r.Id, rowId));
            var refs = row is null ? new List<Reference>() : References(config, row).ToList();
            var movedRow = row is not null && !SameId(row.ParentNodeId, nodeId);
            var inherited = config.Nodes.FirstOrDefault(n => SameId(n.Id, nodeId))?.EpisodeFormat;
            var format = !string.IsNullOrEmpty(row?.EpisodeFormat) ? row.EpisodeFormat : !string.IsNullOrEmpty(inherited) ? inherited : registration.EpisodeFormat;
            // A manual/source reorder is held. Adding at its end must not silently claim a correct chronology.
            var currentRanks = (row?.MediaOrder ?? new()).Select(id => owned.FirstOrDefault(o => SameId(o.RowId, rowId) && SameId(o.ReferenceId, id)))
                .Where(o => o is not null).Select(o => desired[kind].Where(a => Covers(From(o!), a)).Select(a => a.Sequence).DefaultIfEmpty(int.MaxValue).Min()).Where(n => n != int.MaxValue).ToList();
            var orderConflict = currentRanks.Zip(currentRanks.Skip(1)).Any(pair => pair.First > pair.Second);
            if (orderConflict) pending.Add(Change("OrderConflict", kind, rowId, row?.Name ?? RowName(kind), "", "", 0, "The existing manual order differs from the source; it is preserved for review."));
            List<Atom> batch = new();
            void Flush()
            {
                if (batch.Count == 0) return;
                safe.Add(Candidate(batch, kind, rowId, true, "Add", "New uniquely matched library item."));
                batch.Clear();
            }
            foreach (var atom in desired[kind])
            {
                var blocking = rules.Where(e => Applies(e, registration.Id, nodeId, rowId) && Blocks(e, atom, kind)).ToList();
                if (blocking.Count > 0)
                {
                    Flush();
                    var change = Candidate(new[] { atom }, kind, rowId, false, "Excluded", "A persistent exclusion or manual range restriction protects this choice.");
                    change.ExclusionIds = blocking.Select(e => e.Id).Order().ToList(); Identify(change); pending.Add(change); continue;
                }
                if (!deletedNode && !ContainsId(deletedRows, rowId) && refs.Any(reference => Covers(reference, atom))) { Flush(); continue; }
                var heldReason = deletedNode ? "This franchise was deleted manually; explicit Restore is required." : ContainsId(deletedRows, rowId) ? "This row was deleted manually; explicit Restore is required." :
                    movedRow ? "This row was moved to another owner manually; additions require review." : !orderVerified ? "Source list order was not verified; automatic changes are held." : orderConflict ? "Existing manual order requires review before adding this item." : "";
                if (heldReason.Length > 0)
                {
                    Flush(); pending.Add(Candidate(new[] { atom }, kind, rowId, false, deletedNode || ContainsId(deletedRows, rowId) ? "Restore" : "OrderConflict", heldReason)); continue;
                }
                var previous = batch.LastOrDefault();
                var adjacent = kind == "ChronologicalOrder" && format != "Individual" && atom.Episode && previous is not null && previous.Episode &&
                    SameId(previous.Show!.Id, atom.Show!.Id) && previous.Season == atom.Season && previous.Last + 1 == atom.First && previous.Boundary == atom.Boundary &&
                    (previous.Position == atom.Position || previous.Position + 1 == atom.Position);
                if (!adjacent) Flush();
                batch.Add(atom);
            }
            Flush();
        }
        foreach (var owner in owned)
        {
            if (deletedNode || ContainsId(deletedRows, owner.RowId)) continue;
            var kind = Kinds.FirstOrDefault(k => SameId(rowIds[k], owner.RowId));
            var reference = Find(config, owner.RowId, owner.ReferenceId);
            if (kind is null || reference is null || Signature(config, owner) != owner.Signature) continue;
            var allDesired = desired[kind];
            var matching = allDesired.Where(atom => Covers(reference, atom)).ToList();
            var stillPresent = reference.ItemType != "Series" || reference.RangeMode == "Full" ? matching.Count != 0 : owner.EpisodeIds.Count > 0 ? owner.EpisodeIds.All(id => matching.Any(a => SameId(a.Item.Id, id))) : matching.Any() && matching.Min(a => a.Season) == reference.StartSeason && matching.Min(a => a.First) <= reference.StartEpisode && matching.Max(a => a.Last) >= reference.EndEpisode;
            if (stillPresent) continue;
            if (!orderVerified || !library.Any(i => SameId(i.Id, owner.ItemId) && i.IsAvailable) || owner.EpisodeIds.Any(id => !library.Any(i => SameId(i.Id, id) && i.IsAvailable)))
            {
                missing.Add(OwnerChange(owner, "Missing", "An unverified source or unavailable library item cannot authorize a removal.", reference)); continue;
            }
            var proposal = OwnerChange(owner, matching.Count > 0 ? "RangeReplacement" : "Remove", matching.Count > 0 ? "The source no longer contains the entire saved range; replacement requires review." : "This owned reference is no longer in the source; removal requires review.", reference);
            if (matching.Count > 0)
            {
                var row = config.Rows.First(r => SameId(r.Id, owner.RowId));
                var otherRefs = References(config, row).Where(r => !SameId(r.Id, owner.ReferenceId)).ToList();
                var format = row.EpisodeFormat.Length > 0 ? row.EpisodeFormat : config.Nodes.FirstOrDefault(n => SameId(n.Id, nodeId))?.EpisodeFormat ?? registration.EpisodeFormat;
                var fragments = new List<AutoFranchiseChange>();
                var batch = new List<Atom>();
                void FlushReplacement()
                {
                    if (batch.Count == 0) return;
                    fragments.Add(Candidate(batch, kind, owner.RowId, false, "Add", "Remaining allowed source episodes after the reviewed range replacement.")); batch.Clear();
                }
                foreach (var atom in matching)
                {
                    if (rules.Any(rule => Applies(rule, registration.Id, nodeId, owner.RowId) && Blocks(rule, atom, kind)) || otherRefs.Any(r => Covers(r, atom))) { FlushReplacement(); continue; }
                    var prior = batch.LastOrDefault();
                    if (prior is not null && (format == "Individual" || !atom.Episode || !prior.Episode || !SameId(prior.Show!.Id, atom.Show!.Id) || prior.Season != atom.Season || prior.Last + 1 != atom.First || prior.Boundary != atom.Boundary || prior.Position != atom.Position && prior.Position + 1 != atom.Position)) FlushReplacement();
                    batch.Add(atom);
                }
                FlushReplacement();
                proposal.EpisodeIds = fragments.SelectMany(c => c.EpisodeIds).ToList();
                proposal.Proposed = JsonSerializer.Serialize(fragments.Select(c => new { c.ItemId, c.StartSeason, c.EndSeason, c.StartEpisode, c.EndEpisode, c.EpisodeIds }));
                Identify(proposal); replacements[proposal.Id] = fragments.AsReadOnly();
            }
            pending.Add(proposal);
        }
        return Result();

        IEnumerable<string> Slots(AutomationLibraryItem episode, AutomationLibraryItem show)
        {
            var first = episode.EpisodeNumber ?? 0; var last = Math.Max(first, episode.EpisodeEnd ?? first);
            // Invalid numbering cannot authorize an unbounded expansion.
            if (first < 1 || last - first > 10000) yield break;
            for (var number = first; number <= last; number++) yield return IdentityId(show.Id) + ":" + episode.SeasonNumber + ":" + number;
        }
        bool EpisodeCovered(AutomationLibraryItem episode, AutomationLibraryItem show) => Slots(episode, show).Any(episodeSlots.Contains);
        bool AddEpisode(AutomationLibraryItem episode, AutomationLibraryItem show, int position)
        {
            var slots = Slots(episode, show).ToList();
            if (slots.Count == 0 || slots.Any(episodeSlots.Contains) || !seen.Add("Episode:" + IdentityId(episode.Id))) return false;
            foreach (var slot in slots) episodeSlots.Add(slot);
            atoms.Add(new(episode, show, position, ++sequence, boundary)); return true;
        }

        AutoFranchiseChange Change(string operation, string kind, string rowId, string title, string itemType, string providerId, int position, string reason)
        {
            var result = new AutoFranchiseChange
            {
                RegistrationId = registration.Id, FranchiseNodeId = nodeId, FranchiseName = registration.Name, Kind = operation, RowKind = kind, RowId = rowId,
                Title = title, ItemType = itemType, ProviderId = providerId, SourceUrl = registration.Url, SourcePosition = position, Reason = reason, MediaKey = itemType + ":" + providerId
            };
            Identify(result); return result;
        }
        AutoFranchiseChange Candidate(IEnumerable<Atom> selection, string kind, string rowId, bool safeAdd, string operation, string reason)
        {
            var list = selection.ToList(); var first = list[0]; var last = list[^1]; var item = first.Episode ? first.Show! : first.Item;
            var result = Change(operation, kind, rowId, item.Name, item.ItemType, Provider(item.ProviderIds), first.Position, reason);
            result.Safe = safeAdd; result.ItemId = item.Id; result.SeriesId = first.Episode ? item.Id : ""; result.SeriesProviderId = first.Episode ? Provider(item.ProviderIds) : "";
            if (first.Episode)
            {
                result.StartSeason = first.Season; result.EndSeason = last.Season; result.StartEpisode = first.First; result.EndEpisode = last.Last;
                result.EpisodeIds = list.Select(a => a.Item.Id).Distinct().ToList();
                result.Title = item.Name + " · S" + first.Season.ToString("00") + "E" + first.First.ToString("00") + (first.First == last.Last ? "" : "–S" + last.Season.ToString("00") + "E" + last.Last.ToString("00"));
            }
            result.MediaKey = item.ItemType + ":" + (result.ProviderId.Length > 0 ? result.ProviderId.ToLowerInvariant() : item.Id) + (first.Episode ? $":{first.Season}:{first.First}:{last.Last}" : "");
            result.ReferenceId = AutoFranchiseDefaults.StableGuid(registration.Id + ":" + rowId + ":" + result.MediaKey);
            result.Proposed = JsonSerializer.Serialize(new { result.ItemId, result.ItemType, result.StartSeason, result.EndSeason, result.StartEpisode, result.EndEpisode, result.EpisodeIds });
            Identify(result); return result;
        }
        AutoFranchiseChange OwnerChange(AutoFranchiseOwnership owner, string operation, string reason, Reference? reference)
        {
            var result = Change(operation, Kinds.FirstOrDefault(k => SameId(rowIds[k], owner.RowId)) ?? "", owner.RowId, owner.Title, owner.ItemType, owner.ProviderId, owner.SourcePosition, reason);
            result.ReferenceId = owner.ReferenceId; result.MediaKey = owner.MediaKey; result.ItemId = owner.ItemId; result.SeriesProviderId = owner.SeriesProviderId;
            result.StartSeason = owner.StartSeason; result.EndSeason = owner.EndSeason; result.StartEpisode = owner.StartEpisode; result.EndEpisode = owner.EndEpisode;
            result.Existing = JsonSerializer.Serialize(reference); result.Proposed = operation == "Remove" ? "Remove this reference" : owner.Signature;
            Identify(result); return result;
        }
        AutoFranchiseExclusion Protect(AutoFranchiseOwnership owner, Reference? reference, string reason) => new()
        {
            Id = AutoFranchiseDefaults.StableGuid(registration.Id + ":protection:" + owner.RowId + ":" + owner.ReferenceId),
            RegistrationId = registration.Id, FranchiseNodeId = nodeId, RowId = owner.RowId,
            Scope = reference is not null ? "AllowedRange" : owner.ItemType == "Series" ? owner.StartEpisode > 0 ? "Episode" : "WholeShow" : "Movie",
            ProviderId = owner.SeriesProviderId.Length > 0 ? owner.SeriesProviderId : owner.ProviderId, JellyfinItemId = owner.ItemId,
            StartSeason = reference?.StartSeason ?? owner.StartSeason, EndSeason = reference?.EndSeason ?? owner.EndSeason,
            StartEpisode = reference?.RangeMode == "Seasons" ? 1 : reference?.StartEpisode ?? owner.StartEpisode,
            EndEpisode = reference?.RangeMode == "Seasons" ? int.MaxValue : reference?.EndEpisode ?? owner.EndEpisode, Reason = reason
        };
    }

    /// <summary>Applies only safe additions by default. Selected review IDs are an explicit restore/removal decision.</summary>
    public int Apply(PluginConfiguration config, AutoFranchiseSettings settings, AutoFranchiseRegistration registration, AutoFranchisePlan plan, IReadOnlyCollection<string>? selectedChangeIds = null)
    {
        if (plan.SourceFailed || !SameId(plan.RegistrationId, registration.Id) || !settings.Enabled || !registration.Enabled || !settings.Registry.Any(r => SameId(r.Id, registration.Id) && r.Enabled)) return 0;
        if (plan.DeletedNode) registration.Deleted = true;
        foreach (var mapping in registration.Rows.Where(m => ContainsId(plan.DeletedRows, m.RowId))) mapping.Deleted = true;
        foreach (var protection in plan.Protections)
        {
            var prior = settings.Exclusions.FirstOrDefault(e => e.Id == protection.Id);
            if (prior is null) settings.Exclusions.Add(protection);
            // Explicit restore disables a protection; an unchanged nightly observation must retain that decision.
            else if (prior.Enabled && (prior.StartSeason != protection.StartSeason || prior.EndSeason != protection.EndSeason || prior.StartEpisode != protection.StartEpisode || prior.EndEpisode != protection.EndEpisode))
            {
                prior.StartSeason = protection.StartSeason; prior.EndSeason = protection.EndSeason; prior.StartEpisode = protection.StartEpisode; prior.EndEpisode = protection.EndEpisode;
            }
        }
        foreach (var proposal in plan.Pending.Concat(plan.Missing))
            if (!settings.PendingChanges.Any(p => p.Id == proposal.Id)) settings.PendingChanges.Add(proposal);
        var selected = selectedChangeIds is null ? new HashSet<string>() : selectedChangeIds.ToHashSet();
        var choices = plan.SafeAdditions.Where(p => selectedChangeIds is null || selected.Contains(p.Id)).Concat(plan.Pending.Where(p => selected.Contains(p.Id))).ToList();
        foreach (var replacement in choices.Where(c => c.Kind == "RangeReplacement").ToList())
            if (plan.ReplacementAdditions.TryGetValue(replacement.Id, out var fragments)) choices.AddRange(fragments);
        var additions = choices.Where(c => c.Kind is "Add" or "Excluded" or "Restore" or "OrderConflict" && c.ItemId.Length > 0 && c.ReferenceId.Length > 0).ToList();
        if (additions.Count > 0)
        {
            if (config.Nodes.All(n => !SameId(n.Id, plan.NodeId))) config.Nodes.Add(new()
            {
                Id = plan.NodeId, Name = registration.Name, EpisodeFormat = registration.EpisodeFormat, SortOrder = config.Nodes.Count,
                AutoAddSources = new() { new() { Id = AutoFranchiseDefaults.StableGuid(registration.Id + ":source"), Url = registration.Url, Categories = new() { "TV Shows", "Movies", "Chronological Timeline" } } },
                AutoAddRows = Kinds.Select(kind => new FranchiseAutoAddRow { Category = kind == "ChronologicalOrder" ? "Chronological Timeline" : RowName(kind), RowId = registration.Rows.FirstOrDefault(m => m.Kind == kind)?.RowId ?? AutoFranchiseDefaults.StableGuid(registration.Id + ":row:" + kind) }).ToList()
            });
            registration.FranchiseNodeId = plan.NodeId;
            if (additions.Any(c => selected.Contains(c.Id))) registration.Deleted = false;
            foreach (var kind in Kinds)
            {
                var mapping = registration.Rows.FirstOrDefault(m => m.Kind == kind);
                if (mapping is null) { mapping = new() { Kind = kind, RowId = AutoFranchiseDefaults.StableGuid(registration.Id + ":row:" + kind) }; registration.Rows.Add(mapping); }
                var restore = additions.Any(c => SameId(c.RowId, mapping.RowId) && selected.Contains(c.Id));
                if (mapping.Deleted && !restore) continue;
                if (restore) mapping.Deleted = false;
                if (config.Rows.All(r => !SameId(r.Id, mapping.RowId))) config.Rows.Add(new() { Id = mapping.RowId, ParentNodeId = plan.NodeId, Name = RowName(kind), Category = RowName(kind), RowType = kind == "ChronologicalOrder" ? "Timeline" : "Media", SortOrder = Array.IndexOf(Kinds, kind) });
            }
        }
        var count = 0;
        foreach (var change in choices)
        {
            if (change.Kind is "Remove" or "RangeReplacement")
            {
                if (!selected.Contains(change.Id)) continue;
                Detach(config, change.RowId, change.ReferenceId);
                settings.Ownership.RemoveAll(o => SameId(o.RegistrationId, registration.Id) && SameId(o.RowId, change.RowId) && SameId(o.ReferenceId, change.ReferenceId));
                MarkApplied(change.Id); count++; continue;
            }
            if (!additions.Contains(change)) continue;
            var row = config.Rows.FirstOrDefault(r => SameId(r.Id, change.RowId));
            if (row is null) continue;
            if (selected.Contains(change.Id))
                foreach (var exclusion in settings.Exclusions.Where(e => change.ExclusionIds.Contains(e.Id))) exclusion.Enabled = false;
            if (Find(config, row.Id, change.ReferenceId) is not null) { if (selected.Contains(change.Id)) MarkApplied(change.Id); continue; }
            if (change.RowKind == "ChronologicalOrder")
            {
                config.MediaLinks.Add(new() { Id = change.ReferenceId, NodeId = plan.NodeId, JellyfinItemId = change.ItemId, DisplayName = change.Title, ItemType = change.ItemType, ViewingOrder = "Custom", Position = config.MediaLinks.Where(l => SameId(l.NodeId, plan.NodeId)).Select(l => l.Position).DefaultIfEmpty(0).Max() + 1,
                    RangeMode = change.StartEpisode > 0 ? "Episodes" : "Full", StartSeason = change.StartSeason, EndSeason = change.EndSeason, StartEpisode = change.StartEpisode, EndEpisode = change.EndEpisode });
                row.MediaLinkIds.Add(change.ReferenceId);
            }
            else row.Items.Add(new() { Id = change.ReferenceId, JellyfinItemId = change.ItemId, DisplayName = change.Title, ItemType = change.ItemType, RangeMode = "Full" });
            var insertion = row.MediaOrder.FindIndex(id => settings.Ownership.Any(o => SameId(o.RegistrationId, registration.Id) && SameId(o.RowId, row.Id) && SameId(o.ReferenceId, id) && o.SourcePosition > change.SourcePosition));
            if (insertion < 0) row.MediaOrder.Add(change.ReferenceId); else row.MediaOrder.Insert(insertion, change.ReferenceId);
            var owner = new AutoFranchiseOwnership { RegistrationId = registration.Id, RowId = row.Id, ReferenceId = change.ReferenceId, MediaKey = change.MediaKey, ItemId = change.ItemId, ItemType = change.ItemType, ProviderId = change.ProviderId, SeriesProviderId = change.SeriesProviderId, Title = change.Title,
                StartSeason = change.StartSeason, EndSeason = change.EndSeason, StartEpisode = change.StartEpisode, EndEpisode = change.EndEpisode, SourcePosition = change.SourcePosition, EpisodeIds = change.EpisodeIds.ToList() };
            owner.Signature = Signature(config, owner); settings.Ownership.RemoveAll(o => SameId(o.RegistrationId, registration.Id) && SameId(o.RowId, owner.RowId) && SameId(o.ReferenceId, owner.ReferenceId)); settings.Ownership.Add(owner);
            MarkApplied(change.Id); count++;
        }
        return count;
        void MarkApplied(string id) { var pending = settings.PendingChanges.FirstOrDefault(p => p.Id == id); if (pending is not null) pending.Status = "Applied"; }
    }

    /// <summary>Fingerprint shared with ID recovery; empty means the reference was deleted/detached.</summary>
    public static string Signature(PluginConfiguration config, AutoFranchiseOwnership ownership)
    {
        var row = config.Rows.FirstOrDefault(r => SameId(r.Id, ownership.RowId));
        if (row is null) return "";
        var item = row.Items.FirstOrDefault(i => SameId(i.Id, ownership.ReferenceId));
        if (item is not null) return JsonSerializer.Serialize(new { item.Id, item.JellyfinItemId, item.DisplayName, item.ItemType, item.RangeMode, item.StartSeason, item.EndSeason, item.StartEpisode, item.EndEpisode, item.Artwork });
        var link = config.MediaLinks.FirstOrDefault(l => SameId(l.Id, ownership.ReferenceId) && ContainsId(row.MediaLinkIds, l.Id));
        return link is null ? "" : JsonSerializer.Serialize(new { link.Id, link.NodeId, link.JellyfinItemId, link.DisplayName, link.ItemType, link.ViewingOrder, link.RangeMode, link.StartSeason, link.EndSeason, link.StartEpisode, link.EndEpisode, link.Artwork });
    }
    private static string IdentityId(string value) => Guid.TryParse(value, out var id) ? id.ToString("N") : value.ToLowerInvariant();
    private static bool SameId(string left, string right) => string.Equals(IdentityId(left), IdentityId(right), StringComparison.Ordinal);
    private static bool ContainsId(IEnumerable<string> ids, string value) => ids.Any(id => SameId(id, value));
    private static string Provider(Dictionary<string, string> ids, string name = "Imdb") => ids.FirstOrDefault(p => string.Equals(p.Key, name, StringComparison.OrdinalIgnoreCase)).Value ?? "";
    private static string RowName(string kind) => kind switch { "TVShows" => "TV Shows", "Movies" => "Movies", _ => "Chronological Order" };
    private static bool Applies(AutoFranchiseExclusion rule, string registrationId, string nodeId, string rowId) => rule.Enabled &&
        (rule.RegistrationId.Length > 0 ? SameId(rule.RegistrationId, registrationId) : rule.FranchiseNodeId.Length > 0 && SameId(rule.FranchiseNodeId, nodeId)) && (rule.RowId.Length == 0 || SameId(rule.RowId, rowId));
    private static bool Blocks(AutoFranchiseExclusion rule, Atom atom, string kind)
    {
        var item = atom.Episode ? atom.Show! : atom.Item;
        var identity = rule.ProviderId.Length > 0 && string.Equals(Provider(item.ProviderIds, rule.ProviderName), rule.ProviderId, StringComparison.OrdinalIgnoreCase) || rule.JellyfinItemId.Length > 0 && SameId(rule.JellyfinItemId, item.Id);
        var episodeIdentity = atom.Episode && (rule.ProviderId.Length > 0 && string.Equals(Provider(atom.Item.ProviderIds, rule.ProviderName), rule.ProviderId, StringComparison.OrdinalIgnoreCase) || rule.JellyfinItemId.Length > 0 && SameId(rule.JellyfinItemId, atom.Item.Id));
        if (!identity && !episodeIdentity) return false;
        var scope = rule.Scope.ToLowerInvariant();
        if (scope is "wholeshow" or "show" or "series") return item.ItemType == "Series";
        if (scope == "movie") return item.ItemType == "Movie";
        if (!atom.Episode || kind == "TVShows") return false;
        var endSeason = rule.EndSeason == 0 ? rule.StartSeason : rule.EndSeason;
        var endEpisode = rule.EndEpisode == 0 ? rule.StartEpisode : rule.EndEpisode;
        if (scope == "season") return atom.Season >= rule.StartSeason && atom.Season <= endSeason;
        if (scope == "episode" && episodeIdentity && rule.StartEpisode == 0) return true;
        bool Inside(int episode) => atom.Season >= rule.StartSeason && atom.Season <= endSeason && (atom.Season > rule.StartSeason || episode >= rule.StartEpisode) && (atom.Season < endSeason || episode <= endEpisode);
        if (scope == "allowedrange") return !Inside(atom.First) || !Inside(atom.Last);
        if (scope == "episode") return (atom.Season > rule.StartSeason || atom.Season == rule.StartSeason && atom.Last >= rule.StartEpisode) && (atom.Season < endSeason || atom.Season == endSeason && atom.First <= endEpisode);
        return false;
    }
    private static bool Covers(Reference reference, Atom atom)
    {
        if (SameId(reference.ItemId, atom.Item.Id) && !atom.Episode) return true;
        if (!atom.Episode || !SameId(reference.ItemId, atom.Show!.Id) || reference.ItemType != "Series") return false;
        if (reference.RangeMode == "Full") return atom.Season > 0;
        if (atom.Season < reference.StartSeason || atom.Season > reference.EndSeason) return false;
        if (reference.RangeMode == "Seasons") return true;
        return reference.RangeMode == "Episodes" && (atom.Season > reference.StartSeason || atom.First >= reference.StartEpisode) && (atom.Season < reference.EndSeason || atom.Last <= reference.EndEpisode);
    }
    private static Reference From(AutoFranchiseOwnership owner) => new(owner.ReferenceId, owner.ItemId, owner.ItemType, owner.StartEpisode > 0 ? "Episodes" : "Full", owner.StartSeason, owner.EndSeason, owner.StartEpisode, owner.EndEpisode);
    private static IEnumerable<Reference> References(PluginConfiguration config, FranchiseRow row) => row.Items.Select(i => new Reference(i.Id, i.JellyfinItemId, i.ItemType, i.RangeMode, i.StartSeason, i.EndSeason, i.StartEpisode, i.EndEpisode))
        .Concat(config.MediaLinks.Where(l => ContainsId(row.MediaLinkIds, l.Id)).Select(l => new Reference(l.Id, l.JellyfinItemId, l.ItemType, l.RangeMode, l.StartSeason, l.EndSeason, l.StartEpisode, l.EndEpisode)));
    private static Reference? Find(PluginConfiguration config, string rowId, string referenceId) { var row = config.Rows.FirstOrDefault(r => SameId(r.Id, rowId)); return row is null ? null : References(config, row).FirstOrDefault(r => SameId(r.Id, referenceId)); }
    private static void Identify(AutoFranchiseChange change) => change.Id = AutoFranchiseDefaults.StableGuid(JsonSerializer.Serialize(new { change.RegistrationId, change.RowId, change.Kind, change.MediaKey, change.ReferenceId, change.SourcePosition, change.Reason, change.Existing, change.Proposed, ExclusionIds = change.ExclusionIds.Order().ToArray() }));
    private static void Detach(PluginConfiguration config, string rowId, string referenceId)
    {
        var row = config.Rows.FirstOrDefault(r => SameId(r.Id, rowId)); if (row is null) return;
        row.Items.RemoveAll(i => SameId(i.Id, referenceId)); row.MediaLinkIds.RemoveAll(id => SameId(id, referenceId)); row.MediaOrder.RemoveAll(id => SameId(id, referenceId));
        if (!config.Rows.Any(r => ContainsId(r.MediaLinkIds, referenceId))) config.MediaLinks.RemoveAll(l => SameId(l.Id, referenceId));
    }
}
