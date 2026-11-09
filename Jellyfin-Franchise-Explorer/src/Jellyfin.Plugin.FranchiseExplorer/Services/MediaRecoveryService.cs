using Jellyfin.Plugin.FranchiseExplorer.Api;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Services;

/// <summary>Captures portable identities and reconnects verified references after a completed library change.</summary>
public sealed class MediaRecoveryService(ILibraryManager library, FranchiseLibrarySnapshotService snapshots, ILogger<MediaRecoveryService> logger) : BackgroundService
{
    private readonly object _events = new();
    private DateTimeOffset _changedUtc = DateTimeOffset.MinValue;
    private bool _libraryChanged;
    private bool _wasScanning;
    private long _lastConfigurationRevision = -1;

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
            // Startup captures identities passively. Automatic repair begins only after a library event or scan.
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
                        if ((!changed || changedUtc <= DateTimeOffset.UtcNow.AddSeconds(-15)) && (changed || _lastConfigurationRevision != revision))
                        {
                            var status = await CheckAsync(changed, stoppingToken).ConfigureAwait(false);
                            if (changed && status.Enabled && status.AutoReconnect && status.LibraryHealthy)
                            {
                                var choices = status.Entries.Where(e => e.Status == "Verified" && e.Candidates.Count == 1)
                                    .Select(e => new MediaRecoveryChoice { ReferenceId = e.ReferenceId, ItemId = e.Candidates[0].ItemId }).ToList();
                                if (choices.Count > 0)
                                    await ApplyAsync(new() { Revision = status.Revision, LibraryRevision = status.LibraryRevision, Choices = choices }, true, stoppingToken).ConfigureAwait(false);
                            }
                            lock (_events) if (_changedUtc == changedUtc) _libraryChanged = false;
                            _lastConfigurationRevision = plugin.Configuration.ConfigurationRevision;
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

    public Task<MediaRecoveryStatus> StatusAsync(CancellationToken cancellationToken = default) => CheckCoreAsync(false, false, cancellationToken);

    public Task<MediaRecoveryStatus> CheckAsync(bool force = true, CancellationToken cancellationToken = default) => CheckCoreAsync(force, true, cancellationToken);

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

    public async Task<IReadOnlyList<MediaRecoveryCandidate>> CandidatesAsync(string referenceId, string query, string revision, string libraryRevision, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2 || query.Length > 200) throw new ArgumentException("Enter at least two characters of the replacement title.");
        var snapshot = snapshots.Get(true);
        await FranchiseConfigurationGate.Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var config = Plugin.Instance?.Configuration ?? throw new InvalidOperationException("Plugin configuration unavailable.");
            ValidateRevision(config, snapshot, revision, libraryRevision);
            var reference = MediaRecoveryPlanner.References(config).SingleOrDefault(r => r.ReferenceId == referenceId) ?? throw new ArgumentException("The reference no longer exists.");
            var identity = MediaRecoveryPlanner.IdentityFor(config, reference, snapshot.Items);
            return snapshot.Items.Where(i => i.IsAvailable && i.ItemType == reference.ItemType && MediaRecoveryPlanner.Id(i.Id) != MediaRecoveryPlanner.Id(reference.ItemId)
                    && i.Name.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase))
                .OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.Year).Take(50).Select(i => MediaRecoveryPlanner.Candidate(i, identity)).ToArray();
        }
        finally { FranchiseConfigurationGate.Gate.Release(); }
    }

    private void ValidateRevision(PluginConfiguration config, FranchiseLibrarySnapshot snapshot, string revision, string libraryRevision)
    {
        if (!snapshot.Healthy) throw new InvalidOperationException(snapshot.Message);
        if (MediaRecoveryPlanner.Revision(config) != revision || snapshot.Revision != libraryRevision || !snapshots.IsCurrent(libraryRevision))
            throw new InvalidOperationException("Configuration or library changed. Check media links again before applying a choice.");
    }

    public async Task<MediaRecoveryStatus> ApplyAsync(MediaRecoveryApplyRequest request, bool automatic = false, CancellationToken cancellationToken = default)
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
            if (!previous.MediaRecovery.Enabled || automatic && !previous.MediaRecovery.AutoReconnect) throw new InvalidOperationException("Media recovery is disabled.");
            var references = MediaRecoveryPlanner.References(previous).ToList();
            var currentItems = snapshot.Items.GroupBy(i => MediaRecoveryPlanner.Id(i.Id)).ToDictionary(g => g.Key, g => g.First());
            var mapping = new Dictionary<string, string>(StringComparer.Ordinal);
            var candidates = new MediaRecoveryPlanner.CandidateLookup(snapshot.Items);
            foreach (var choice in request.Choices)
            {
                var reference = references.SingleOrDefault(r => r.ReferenceId == choice.ReferenceId) ?? throw new ArgumentException("A selected reference no longer exists.");
                var identity = MediaRecoveryPlanner.IdentityFor(previous, reference, snapshot.Items);
                var current = currentItems.GetValueOrDefault(MediaRecoveryPlanner.Id(reference.ItemId));
                if (current is { IsAvailable: false }) current = null;
                if (current is not null && (automatic || current.ItemType == reference.ItemType && (!MediaRecoveryPlanner.Stable(identity) || MediaRecoveryPlanner.Verified(identity, current))))
                    throw new InvalidOperationException("A selected reference is already available. Check media links again.");
                var candidate = currentItems.GetValueOrDefault(MediaRecoveryPlanner.Id(choice.ItemId)) is { IsAvailable: true } available ? available
                    : throw new InvalidOperationException("The selected replacement is no longer available.");
                if (candidate.ItemType != reference.ItemType) throw new ArgumentException("Replacement media type does not match the saved reference.");
                if (automatic && (!MediaRecoveryPlanner.Verified(identity, candidate) || candidates.Find(identity).Count != 1))
                    throw new InvalidOperationException("Automatic recovery requires one unique verified provider identity.");
                // An administrator may explicitly choose a version or repair a legacy manual reference.
                // Stable evidence must still agree; a conflicting provider or episode is never accepted.
                if (MediaRecoveryPlanner.Stable(identity) && !MediaRecoveryPlanner.Verified(identity, candidate)) throw new ArgumentException("Replacement conflicts with the saved provider or episode identity.");
                var oldId = MediaRecoveryPlanner.Id(reference.ItemId);
                if (mapping.TryGetValue(oldId, out var existing) && MediaRecoveryPlanner.Id(existing) != MediaRecoveryPlanner.Id(candidate.Id)) throw new ArgumentException("References to the same old item must select the same replacement.");
                mapping[oldId] = candidate.Id;
            }
            foreach (var reference in references.Where(r => mapping.ContainsKey(MediaRecoveryPlanner.Id(r.ItemId))))
            {
                var target = currentItems[MediaRecoveryPlanner.Id(mapping[MediaRecoveryPlanner.Id(reference.ItemId)])];
                var identity = MediaRecoveryPlanner.IdentityFor(previous, reference, snapshot.Items);
                if (reference.ItemType != target.ItemType || MediaRecoveryPlanner.Stable(identity) && !MediaRecoveryPlanner.Verified(identity, target))
                    throw new InvalidOperationException("Another reference to the old item has conflicting identity metadata. Review it before recovery.");
            }
            AddDependentMappings(previous, snapshot.Items, mapping);
            var next = MediaRecoveryPlanner.ApplyMappings(previous, mapping, snapshot.Items);
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
