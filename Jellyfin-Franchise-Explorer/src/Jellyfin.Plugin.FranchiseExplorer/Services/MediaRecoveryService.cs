using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

/// <summary>Captures portable identities and reconnects unique exact matches from complete library snapshots.</summary>
public sealed class MediaRecoveryService(ILibraryManager library, FranchiseLibrarySnapshotService snapshots, ILogger<MediaRecoveryService> logger) : BackgroundService
{
    private readonly object _events = new();
    private DateTimeOffset _changedUtc = DateTimeOffset.MinValue;
    private bool _libraryChanged;
    private bool _wasScanning;
    private long _lastConfigurationRevision = -1;
    private DateTimeOffset _nextCheckUtc = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _pending = new(1, 1);

    private void LibraryChanged(object? sender, ItemChangeEventArgs args)
    {
        snapshots.Invalidate();
        lock (_events) { _changedUtc = DateTimeOffset.UtcNow; _libraryChanged = true; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        library.ItemAdded += LibraryChanged;
        library.ItemUpdated += LibraryChanged;
        library.ItemRemoved += LibraryChanged;
        try
        {
            // A move may have completed before this service started, or without a delivered library event.
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var scanning = library.IsScanRunning;
                    if (_wasScanning && !scanning)
                    {
                        snapshots.Invalidate();
                        lock (_events) { _changedUtc = DateTimeOffset.UtcNow; _libraryChanged = true; }
                    }
                    _wasScanning = scanning;
                    var plugin = Plugin.Instance;
                    if (!scanning && plugin is not null)
                    {
                        bool changed;
                        DateTimeOffset changedUtc;
                        lock (_events) { changed = _libraryChanged; changedUtc = _changedUtc; }
                        var revision = plugin.Configuration.ConfigurationRevision;
                        if ((!changed || changedUtc <= DateTimeOffset.UtcNow.AddSeconds(-15))
                            && (changed || _lastConfigurationRevision != revision || DateTimeOffset.UtcNow >= _nextCheckUtc))
                        {
                            await ProcessPendingAsync(stoppingToken).ConfigureAwait(false);
                        }
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception ex) { logger.LogWarning(ex, "Franchise media recovery deferred; saved references are retained."); }
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken).ConfigureAwait(false);
            }
        }
        finally
        {
            library.ItemAdded -= LibraryChanged;
            library.ItemUpdated -= LibraryChanged;
            library.ItemRemoved -= LibraryChanged;
        }
    }

    /// <summary>Runs one catch-up pass. The background loop schedules retries and lets library events settle first.</summary>
    public async Task ProcessPendingAsync(CancellationToken cancellationToken = default)
    {
        await _pending.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (library.IsScanRunning || Plugin.Instance is null) return;
            DateTimeOffset changedUtc;
            lock (_events) changedUtc = _changedUtc;
            var status = (await AutoCoreAsync(false, cancellationToken).ConfigureAwait(false)).Status;
            lock (_events) if (_changedUtc == changedUtc) _libraryChanged = false;
            _lastConfigurationRevision = Plugin.Instance.Configuration.ConfigurationRevision;
            // Retry incomplete snapshots even when no later event or configuration edit arrives.
            _nextCheckUtc = DateTimeOffset.UtcNow.AddSeconds(status.LibraryHealthy ? 60 : 15);
        }
        finally { _pending.Release(); }
    }

    public Task<MediaRecoveryStatus> StatusAsync(CancellationToken cancellationToken = default) => CheckCoreAsync(false, false, cancellationToken);

    public Task<MediaRecoveryStatus> CheckAsync(bool force = true, CancellationToken cancellationToken = default) => CheckCoreAsync(force, true, cancellationToken);

    /// <summary>Immediately reconnect every clear match, with the same server validation as scheduled recovery.</summary>
    public async Task<MediaRecoveryAutoResult> AutoAsync(CancellationToken cancellationToken = default)
    {
        await _pending.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { return await AutoCoreAsync(true, cancellationToken).ConfigureAwait(false); }
        finally { _pending.Release(); }
    }

    private async Task<MediaRecoveryAutoResult> AutoCoreAsync(bool explicitRequest, CancellationToken cancellationToken)
    {
        var status = await CheckAsync(true, cancellationToken).ConfigureAwait(false);
        var result = new MediaRecoveryAutoResult { Status = status };
        if (!status.Enabled && explicitRequest) throw new InvalidOperationException("Media recovery is disabled.");
        if (!status.Enabled || !explicitRequest && !status.AutoReconnect || !status.CanSearch) return result;
        var choices = status.Entries.Where(e => e.CanAutoRemap)
            .Select(e => new MediaRecoveryChoice { ReferenceId = e.ReferenceId, ItemId = e.Candidates[0].ItemId }).ToList();
        if (choices.Count == 0) return result;
        result.Status = await ApplyCoreAsync(new() { Revision = status.Revision, LibraryRevision = status.LibraryRevision, Choices = choices }, true, explicitRequest, cancellationToken).ConfigureAwait(false);
        result.RemappedCount = choices.Count;
        return result;
    }

    private async Task<MediaRecoveryStatus> CheckCoreAsync(bool force, bool capture, CancellationToken cancellationToken)
    {
        var snapshot = snapshots.Get(force);
        await FranchiseConfigurationGate.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var plugin = Plugin.Instance ?? throw new InvalidOperationException("Plugin configuration unavailable.");
            var config = plugin.Configuration;
            if (capture && config.MediaRecovery.Enabled && snapshot.Healthy && snapshots.IsCurrent(snapshot.Revision))
            {
                var next = MediaRecoveryPlanner.Clone(config);
                var progressIds = await FranchiseTimelineController.StoredItemIdsAsync(plugin.DataFolderPath, cancellationToken).ConfigureAwait(false);
                if (MediaRecoveryPlanner.CaptureSnapshots(next, snapshot.Items, progressIds))
                {
                    plugin.CommitConfigurationUnderGate(next);
                    config = plugin.Configuration;
                }
            }
            return MediaRecoveryPlanner.Review(config, snapshot);
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    public async Task<IReadOnlyList<MediaRecoveryCandidate>> CandidatesAsync(string referenceId, string query, string revision, string libraryRevision, CancellationToken cancellationToken = default, string? itemType = null)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2 || query.Length > 200) throw new ArgumentException("Enter at least two characters of the replacement title.");
        var snapshot = snapshots.Get(true);
        await FranchiseConfigurationGate.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var config = Plugin.Instance?.Configuration ?? throw new InvalidOperationException("Plugin configuration unavailable.");
            ValidateRevision(config, snapshot, revision, libraryRevision);
            var reference = MediaRecoveryPlanner.References(config).SingleOrDefault(r => r.ReferenceId == referenceId) ?? throw new ArgumentException("The reference no longer exists.");
            var type = SearchType(reference, itemType, false);
            var identity = MediaRecoveryPlanner.IdentityFor(config, reference, snapshot.Items);
            return snapshot.Items.Where(i => i.IsAvailable && i.ItemType == type && (MediaRecoveryPlanner.Id(i.Id) != MediaRecoveryPlanner.Id(reference.ItemId) || i.ItemType != reference.ItemType)
                    && i.Name.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase))
                .GroupBy(i => MediaRecoveryPlanner.Id(i.Id)).Select(g => g.First())
                .OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.Year).ThenBy(i => i.Id, StringComparer.Ordinal)
                .Take(50).Select(i => MediaRecoveryPlanner.Candidate(i, identity)).ToArray();
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    /// <summary>Browse available metadata from one fresh complete snapshot without capturing or saving configuration.</summary>
    public async Task<MediaRecoveryLibraryPage> LibraryAsync(string referenceId, string revision, string libraryRevision, string? itemType = null, string? query = null,
        int startIndex = 0, int limit = 30, CancellationToken cancellationToken = default)
    {
        if (startIndex < 0 || limit < 1) throw new ArgumentException("Use a non-negative start index and a positive page limit.");
        if (query?.Length > 200) throw new ArgumentException("Replacement titles must be at most 200 characters.");
        limit = Math.Min(limit, 50);
        var snapshot = snapshots.Get(true);
        await FranchiseConfigurationGate.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var config = Plugin.Instance?.Configuration ?? throw new InvalidOperationException("Plugin configuration unavailable.");
            ValidateRevision(config, snapshot, revision, libraryRevision);
            var reference = MediaRecoveryPlanner.References(config).SingleOrDefault(r => r.ReferenceId == referenceId) ?? throw new ArgumentException("The reference no longer exists.");
            var type = SearchType(reference, itemType, true);
            var identity = MediaRecoveryPlanner.IdentityFor(config, reference, snapshot.Items);
            var search = query?.Trim() ?? "";
            var items = snapshot.Items.Where(i => i.IsAvailable
                    && (type.Length > 0 ? i.ItemType == type : i.ItemType is "Movie" or "Series" or "BoxSet" || reference.ItemType == "Episode" && i.ItemType == "Episode")
                    && (search.Length == 0 || i.Name.Contains(search, StringComparison.OrdinalIgnoreCase)))
                .GroupBy(i => MediaRecoveryPlanner.Id(i.Id)).Select(g => g.First())
                .OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.Year).ThenBy(i => i.ItemType, StringComparer.Ordinal).ThenBy(i => i.Id, StringComparer.Ordinal).ToArray();
            return new() { Items = items.Skip(startIndex).Take(limit).Select(i => MediaRecoveryPlanner.Candidate(i, identity)).ToList(),
                TotalRecordCount = items.Length, StartIndex = startIndex, Limit = limit };
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private static string SearchType(MediaRecoveryPlanner.Reference reference, string? itemType, bool allByDefault)
    {
        var type = itemType?.Trim() ?? "";
        if (type.Length == 0) return allByDefault ? "" : reference.ItemType;
        if (type is not ("Movie" or "Series" or "BoxSet" or "Episode") || type == "Episode" && reference.ItemType != "Episode")
            throw new ArgumentException("Choose Movie, Series or BoxSet. Episode is available only for a saved episode reference.");
        return type;
    }

    private void ValidateRevision(PluginConfiguration config, FranchiseLibrarySnapshot snapshot, string revision, string libraryRevision)
    {
        if (!snapshot.CanSearch) throw new InvalidOperationException(snapshot.Message);
        if (MediaRecoveryPlanner.Revision(config) != revision || snapshot.Revision != libraryRevision || !snapshots.IsCurrent(libraryRevision))
            throw new InvalidOperationException("Configuration or library changed. Check media links again before applying a choice.");
    }

    public Task<MediaRecoveryStatus> ApplyAsync(MediaRecoveryApplyRequest request, bool automatic = false, CancellationToken cancellationToken = default)
        => ApplyCoreAsync(request, automatic, false, cancellationToken);

    private async Task<MediaRecoveryStatus> ApplyCoreAsync(MediaRecoveryApplyRequest request, bool automatic, bool explicitAutomatic, CancellationToken cancellationToken)
    {
        if (request?.Choices is null || request.Choices.Count == 0 || request.Choices.Count > 25000 || request.Choices.Select(c => c.ReferenceId).Distinct().Count() != request.Choices.Count)
            throw new ArgumentException("Select one replacement per reference.");
        var snapshot = snapshots.Get(true);
        await FranchiseConfigurationGate.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var plugin = Plugin.Instance ?? throw new InvalidOperationException("Plugin configuration unavailable.");
            var previous = plugin.Configuration;
            ValidateRevision(previous, snapshot, request.Revision, request.LibraryRevision);
            if (!previous.MediaRecovery.Enabled || automatic && !explicitAutomatic && !previous.MediaRecovery.AutoReconnect) throw new InvalidOperationException("Media recovery is disabled.");
            var references = MediaRecoveryPlanner.References(previous).ToList();
            var currentItems = snapshot.Items.GroupBy(i => MediaRecoveryPlanner.Id(i.Id)).ToDictionary(g => g.Key, g => g.First());
            var mapping = new Dictionary<string, string>(StringComparer.Ordinal);
            var correctedTypes = new Dictionary<string, string>(StringComparer.Ordinal);
            var candidates = new MediaRecoveryPlanner.CandidateLookup(snapshot.Items);
            var automaticEntries = automatic ? MediaRecoveryPlanner.Review(previous, snapshot).Entries.ToDictionary(e => e.ReferenceId) : null;
            foreach (var choice in request.Choices)
            {
                var reference = references.SingleOrDefault(r => r.ReferenceId == choice.ReferenceId) ?? throw new ArgumentException("A selected reference no longer exists.");
                var identity = MediaRecoveryPlanner.IdentityFor(previous, reference, snapshot.Items);
                var current = currentItems.GetValueOrDefault(MediaRecoveryPlanner.Id(reference.ItemId));
                if (automatic && current is not null) throw new InvalidOperationException("Automatic recovery retains saved items that are still in the library, including offline media.");
                if (current is { IsAvailable: false }) current = null;
                if (current is not null && (automatic || current.ItemType == reference.ItemType && (!MediaRecoveryPlanner.Stable(identity) || MediaRecoveryPlanner.Verified(identity, current))))
                    throw new InvalidOperationException("A selected reference is already available. Check media links again.");
                var candidate = currentItems.GetValueOrDefault(MediaRecoveryPlanner.Id(choice.ItemId)) is { IsAvailable: true } available ? available
                    : throw new InvalidOperationException("The selected replacement is no longer available.");
                var correctType = candidate.ItemType != reference.ItemType;
                if (correctType && (automatic || !choice.CorrectItemType || !MediaRecoveryPlanner.CanCorrectItemType(previous, reference, candidate, snapshot.Items)))
                    throw new ArgumentException("Replacement media type does not match the saved reference. An explicit type correction requires a full movie, series or collection link without conflicting identity evidence.");
                if (automatic && (automaticEntries![reference.ReferenceId] is not { CanAutoRemap: true, Candidates.Count: 1 } entry
                    || MediaRecoveryPlanner.Id(entry.Candidates[0].ItemId) != MediaRecoveryPlanner.Id(candidate.Id)
                    || MediaRecoveryPlanner.Matches(previous, reference, identity, candidates).Count != 1))
                    throw new InvalidOperationException("Automatic recovery requires one unique exact identity or title match without conflicting evidence.");
                // An administrator may explicitly choose a version or repair a legacy manual reference.
                // Stable evidence must still agree; a conflicting provider or episode is never accepted.
                if (!correctType && MediaRecoveryPlanner.Stable(identity) && !MediaRecoveryPlanner.Verified(identity, candidate)) throw new ArgumentException("Replacement conflicts with the saved provider or episode identity.");
                var oldId = MediaRecoveryPlanner.Id(reference.ItemId);
                if (mapping.TryGetValue(oldId, out var existing) && MediaRecoveryPlanner.Id(existing) != MediaRecoveryPlanner.Id(candidate.Id)) throw new ArgumentException("References to the same old item must select the same replacement.");
                mapping[oldId] = candidate.Id;
                if (correctType) correctedTypes[oldId] = candidate.ItemType;
            }
            foreach (var reference in references.Where(r => mapping.ContainsKey(MediaRecoveryPlanner.Id(r.ItemId))))
            {
                var target = currentItems[MediaRecoveryPlanner.Id(mapping[MediaRecoveryPlanner.Id(reference.ItemId)])];
                var identity = MediaRecoveryPlanner.IdentityFor(previous, reference, snapshot.Items);
                var correctingGroup = correctedTypes.ContainsKey(MediaRecoveryPlanner.Id(reference.ItemId));
                var correctableReference = !reference.ReferenceId.StartsWith("collection:", StringComparison.Ordinal);
                if (correctingGroup && correctableReference
                    ? !MediaRecoveryPlanner.CanCorrectItemType(previous, reference, target, snapshot.Items)
                    : reference.ItemType != target.ItemType || MediaRecoveryPlanner.Stable(identity) && !MediaRecoveryPlanner.Verified(identity, target))
                    throw new InvalidOperationException("Another reference to the old item has conflicting identity metadata. Review it before recovery.");
                if (automatic && (automaticEntries![reference.ReferenceId] is not { CanAutoRemap: true, Candidates.Count: 1 } entry
                    || MediaRecoveryPlanner.Id(entry.Candidates[0].ItemId) != MediaRecoveryPlanner.Id(target.Id)))
                    throw new InvalidOperationException("Other references to the old item need review before automatic recovery.");
            }
            AddDependentMappings(previous, snapshot.Items, mapping);
            var next = MediaRecoveryPlanner.ApplyMappings(previous, mapping, snapshot.Items, correctedTypes);
            if (!snapshots.IsCurrent(snapshot.Revision)) throw new InvalidOperationException("The library changed during recovery. Check media links again.");
            await using var progress = await FranchiseTimelineController.RemapItemIdsAsync(mapping, cancellationToken).ConfigureAwait(false);
            if (!snapshots.IsCurrent(snapshot.Revision)) throw new InvalidOperationException("The library changed during recovery. Check media links again.");
            plugin.CommitConfigurationUnderGate(next);
            progress.Commit();
            logger.LogInformation("Franchise media recovery reconnected {ItemCount} item IDs and {ProgressCount} stored user timeline records.", mapping.Count, progress.ChangedFiles);
            return MediaRecoveryPlanner.Review(plugin.Configuration, snapshot);
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private static void AddDependentMappings(PluginConfiguration config, IReadOnlyList<AutomationLibraryItem> items, Dictionary<string, string> mapping)
    {
        var referenceIds = MediaRecoveryPlanner.References(config).Select(r => MediaRecoveryPlanner.Id(r.ItemId)).ToHashSet();
        var availableIds = items.Where(i => i.IsAvailable).Select(i => MediaRecoveryPlanner.Id(i.Id)).ToHashSet();
        var mappedParents = config.MediaRecovery.KnownItems.Where(s => s.Identity.ItemType == "Series" && mapping.ContainsKey(MediaRecoveryPlanner.Id(s.ItemId))).ToList();
        var lookup = new MediaRecoveryPlanner.CandidateLookup(items);
        foreach (var saved in config.MediaRecovery.KnownItems)
        {
            var oldId = MediaRecoveryPlanner.Id(saved.ItemId);
            if (mapping.ContainsKey(oldId) || referenceIds.Contains(oldId) || saved.Identity.ItemType != "Episode" || availableIds.Contains(oldId)) continue;
            var candidates = lookup.Find(saved.Identity).ToList();
            if (saved.Identity.ItemType == "Episode")
            {
                var parents = mappedParents.Where(s => (saved.SeriesItemId.Length == 0 || MediaRecoveryPlanner.Id(saved.SeriesItemId) == MediaRecoveryPlanner.Id(s.ItemId))
                    && saved.Identity.SeriesProviderIds.Count > 0 && saved.Identity.SeriesProviderIds.All(p => s.Identity.ProviderIds.Any(a => a.Name == p.Name && a.Value == p.Value))).ToList();
                if (parents.Count != 1) continue;
                var parent = parents[0];
                candidates = candidates.Where(i => MediaRecoveryPlanner.Id(i.SeriesId) == MediaRecoveryPlanner.Id(mapping[MediaRecoveryPlanner.Id(parent.ItemId)])).ToList();
            }
            if (candidates.Count == 1) mapping[oldId] = candidates[0].Id;
        }
    }
}
