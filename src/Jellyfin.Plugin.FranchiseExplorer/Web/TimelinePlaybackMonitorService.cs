using System;
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

    public TimelinePlaybackMonitorService(ISessionManager sessions, ILogger<TimelinePlaybackMonitorService> logger)
    {
        _sessions = sessions;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _sessions.PlaybackStart += OnProgress;
        _sessions.PlaybackProgress += OnProgress;
        _sessions.PlaybackStopped += OnStopped;
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _sessions.PlaybackStart -= OnProgress;
        _sessions.PlaybackProgress -= OnProgress;
        _sessions.PlaybackStopped -= OnStopped;
        return Task.CompletedTask;
    }

    private void OnProgress(object? sender, PlaybackProgressEventArgs args)
        => Dispatch(args, false);

    private void OnStopped(object? sender, PlaybackStopEventArgs args)
    {
        // Diagnostic: a natural finish reported as an ordinary stop explains
        // why the timeline intentionally does not auto-advance. Avoid logging
        // filenames, paths, or any private configuration data.
        _logger.LogInformation("Franchise Explorer: Jellyfin playback stopped, completion={Completion}, session={SessionId}",
            args.PlayedToCompletion, args.Session?.Id ?? "unknown");
        Dispatch(args, args.PlayedToCompletion);
    }

    private void Dispatch(PlaybackProgressEventArgs args, bool completed)
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
                    userId, sessionId, itemId, args.PlaybackPositionTicks, completed).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Franchise Explorer: timeline progress was not persisted for this playback event.");
            }
        });
    }
}
