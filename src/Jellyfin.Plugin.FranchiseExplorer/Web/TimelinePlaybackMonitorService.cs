using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Web;

/// <summary>
/// Tracks progress even if the Franchises browsing page has been closed.
/// Only events from the specific Jellyfin session that launched an explicitly
/// active timeline are considered. Does not change native playback history.
/// </summary>
public sealed class TimelinePlaybackMonitorService : IHostedService
{
    private readonly ISessionManager _sessions;
    private readonly ILogger<TimelinePlaybackMonitorService> _logger;
    private readonly ConcurrentDictionary<string, PlaybackWitness> _witnesses = new();

    private sealed class PlaybackWitness
    {
        public long LastTicks { get; set; }
        public long DurationTicks { get; set; }
        public long ObservedAdvanceTicks { get; set; }
        public DateTimeOffset LastUpdated { get; set; } = DateTimeOffset.UtcNow;
    }

    // Jellyfin clients sometimes clear their player before reporting their final
    // PlaybackStopped position. Keep only per-session, per-item numeric progress.
    // Neither filenames nor playback URLs are retained.
    private static string? WitnessKey(PlaybackProgressEventArgs args)
        => args.Session?.Id is { Length: > 0 } session && args.Item?.Id is Guid id && id != Guid.Empty
            ? session + ":" + id.ToString("N") : null;

    private void Observe(PlaybackProgressEventArgs args)
    {
        var key = WitnessKey(args);
        var position = args.PlaybackPositionTicks;
        var duration = args.Item?.RunTimeTicks;
        if (key is null || !position.HasValue || !duration.HasValue || duration.Value <= 0) return;
        var now = DateTimeOffset.UtcNow;
        var witness = _witnesses.GetOrAdd(key, _ => new PlaybackWitness());
        lock (witness)
        {
            // Only continuous forward movement counts, not large seek jumps.
            var delta = position.Value - witness.LastTicks;
            if (witness.LastTicks > 0 && delta > 0 && delta <= TimeSpan.TicksPerSecond * 12
                && now - witness.LastUpdated < TimeSpan.FromSeconds(20) && !args.IsPaused)
                witness.ObservedAdvanceTicks += delta;
            witness.LastTicks = Math.Max(0, position.Value);
            witness.DurationTicks = duration.Value;
            witness.LastUpdated = now;
        }
        if (_witnesses.Count > 256)
            foreach (var (oldKey, oldWitness) in _witnesses)
                if (now - oldWitness.LastUpdated > TimeSpan.FromHours(1)) _witnesses.TryRemove(oldKey, out _);
    }

    private bool CompletedAtEndDespiteUnflaggedStop(PlaybackStopEventArgs args)
    {
        var key = WitnessKey(args);
        if (key is null || !_witnesses.TryRemove(key, out var witness)) return false;
        lock (witness)
        {
            var total = witness.DurationTicks;
            var lastPosition = Math.Max(witness.LastTicks, args.PlaybackPositionTicks.GetValueOrDefault());
            // A natural client stop at the actual end can have completion=false.
            // Never infer completion merely from a watched-percentage threshold
            // such as Jellyfin's customary 90% watched setting.
            var remaining = total - lastPosition;
            return total >= TimeSpan.TicksPerMinute
                && remaining >= -TimeSpan.TicksPerSecond * 2
                && remaining <= TimeSpan.TicksPerSecond * 2
                && witness.ObservedAdvanceTicks >= TimeSpan.TicksPerSecond * 4
                && DateTimeOffset.UtcNow - witness.LastUpdated <= TimeSpan.FromSeconds(12);
        }
    }

    public TimelinePlaybackMonitorService(ISessionManager sessions, ILogger<TimelinePlaybackMonitorService> logger)
    {
        _sessions = sessions;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _sessions.PlaybackStart += OnStarted;
        _sessions.PlaybackProgress += OnProgress;
        _sessions.PlaybackStopped += OnStopped;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _sessions.PlaybackStart -= OnStarted;
        _sessions.PlaybackProgress -= OnProgress;
        _sessions.PlaybackStopped -= OnStopped;
        return Task.CompletedTask;
    }

    private void OnStarted(object? sender, PlaybackProgressEventArgs args)
    {
        // Reset any prior witness if the same session replays this item.
        var key = WitnessKey(args);
        if (key is not null) _witnesses.TryRemove(key, out _);
        Observe(args);
        Dispatch(args, false, true);
    }

    private void OnProgress(object? sender, PlaybackProgressEventArgs args)
    {
        Observe(args);
        Dispatch(args, false, true);
    }

    private void OnStopped(object? sender, PlaybackStopEventArgs args)
    {
        // Diagnostic: a natural finish reported as an ordinary stop explains
        // why the timeline intentionally does not auto-advance. Avoid logging
        // filenames, paths, or any private configuration data.
        var nearEnd = CompletedAtEndDespiteUnflaggedStop(args);
        var completed = args.PlayedToCompletion || nearEnd;
        _logger.LogInformation("Franchise Explorer: Jellyfin playback stopped, reportedCompletion={ReportedCompletion}, nearEndEvidence={NearEnd}, session={SessionId}",
            args.PlayedToCompletion, nearEnd, args.Session?.Id ?? "unknown");
        Dispatch(args, completed, false);
    }

    private void Dispatch(PlaybackProgressEventArgs args, bool completed, bool activePlaybackEvent)
    {
        var userId = args.Session?.UserId ?? Guid.Empty;
        var sessionId = args.Session?.Id;
        var itemId = args.Item?.Id ?? Guid.Empty;
        if (userId == Guid.Empty || itemId == Guid.Empty || string.IsNullOrEmpty(sessionId)) return;

        // Never await filesystem access in Jellyfin's media event callback.
        _ = Task.Run(async () =>
        {
            try
            {
                await FranchiseTimelineController.RecordPlaybackAsync(
                    userId, sessionId, itemId, args.PlaybackPositionTicks, completed, activePlaybackEvent, _logger).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Franchise Explorer: timeline progress was not persisted for this playback event.");
            }
        });
    }
}
