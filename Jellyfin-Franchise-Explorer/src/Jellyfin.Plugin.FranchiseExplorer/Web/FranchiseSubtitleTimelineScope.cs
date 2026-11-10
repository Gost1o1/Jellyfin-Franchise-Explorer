using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer.Api;
using MediaBrowser.Controller.Session;

namespace Jellyfin.Plugin.FranchiseExplorer.Web;

/// <summary>Only an explicitly armed or session-bound playing timeline can enroll a native device.</summary>
public sealed class FranchiseSubtitleTimelineScope
{
    private readonly Func<string?> _root;
    private readonly Func<Guid, bool> _validRow;
    public FranchiseSubtitleTimelineScope() : this(() => Plugin.Instance?.DataFolderPath,
        row => Plugin.Instance?.Configuration.Rows.Any(r => Guid.TryParse(r.Id, out var id) && id == row) == true) { }
    public FranchiseSubtitleTimelineScope(Func<string?> root, Func<Guid, bool> validRow)
    { _root = root; _validRow = validRow; }

    public bool TryQueue(Guid user, string device, Guid item, ISessionManager sessions, out Guid[] queue)
    {
        queue = Array.Empty<Guid>();
        var sessionIds = sessions.Sessions.Where(s => s.UserId == user && s.DeviceId == device).Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
        if (sessionIds.Count == 0 || string.IsNullOrWhiteSpace(_root())) return false;
        var folder = Path.Combine(_root()!, "timeline-progress", user.ToString("N"));
        if (!Directory.Exists(folder)) return false;
        try
        {
            foreach (var path in Directory.EnumerateFiles(folder, "*.json").Take(100))
            {
                if (!Guid.TryParse(Path.GetFileNameWithoutExtension(path), out var row) || !_validRow(row)) continue;
                FranchiseTimelineController.TimelineProgress? state;
                try { state = JsonSerializer.Deserialize<FranchiseTimelineController.TimelineProgress>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
                catch (Exception ex) when (ex is IOException or JsonException) { continue; }
                if (state?.QueueKeys is null || state.Index < 0 || state.Index >= state.QueueKeys.Count) continue;
                var armed = state.PlaybackMode == "armed" && state.ArmedUtc is { } at
                    && at >= DateTimeOffset.UtcNow.AddMinutes(-2) && at <= DateTimeOffset.UtcNow.AddSeconds(5);
                var playing = state.PlaybackMode == "playing" && sessionIds.Contains(state.SessionId)
                    && state.UpdatedUtc >= DateTimeOffset.UtcNow.AddMinutes(-15);
                if (!armed && !playing) continue;
                var remaining = state.QueueKeys.Skip(state.Index).Select(ParseItem).Where(id => id != Guid.Empty).Take(1000).ToArray();
                if (remaining.Length == 0 || (armed ? remaining[0] != item : !remaining.Contains(item))) continue;
                queue = remaining;
                return true;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return false;
    }

    private static Guid ParseItem(string key)
        => key is not null && Guid.TryParse(key[(key.LastIndexOf(':') + 1)..], out var id) ? id : Guid.Empty;
}
