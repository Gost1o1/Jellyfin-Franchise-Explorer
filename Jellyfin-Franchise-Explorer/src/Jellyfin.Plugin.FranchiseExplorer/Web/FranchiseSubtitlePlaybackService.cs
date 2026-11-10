using System.Collections.Concurrent;
using System.Globalization;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Session;

namespace Jellyfin.Plugin.FranchiseExplorer.Web;

/// <summary>Corrects a native player's restored track only inside the explicit franchise scope.</summary>
public sealed class FranchiseSubtitlePlaybackService(
    ISessionManager sessions, IUserManager users, IMediaSourceManager sources,
    PlaybackSubtitlePolicyStore leases, FranchiseViewerPreferenceStore preferences,
    FranchiseSubtitleTimelineScope timelines)
{
    private readonly ConcurrentDictionary<string, (int Index, DateTimeOffset Sent)> _sent = new();

    public async Task EnforceAsync(PlaybackProgressEventArgs args)
    {
        var session = args.Session;
        var user = session?.UserId ?? Guid.Empty;
        var device = session?.DeviceId ?? string.Empty;
        var item = args.Item?.Id ?? Guid.Empty;
        if (session is null || user == Guid.Empty || item == Guid.Empty
            || session.NowPlayingItem?.Id != item
            || !PlaybackSubtitleIdentity.OwnsDevice(sessions, user, device)
            || !sessions.Sessions.Any(s => s.Id == session.Id && s.UserId == user && s.DeviceId == device)
            || !session.SupportedCommands.Contains(GeneralCommandType.SetSubtitleStreamIndex)) return;
        var saved = preferences.Get(user);
        leases.TryGet(user, device, item, out var policy);
        if (policy is null && saved.HasPreference && timelines.TryQueue(user, device, item, sessions, out var queue))
            policy = leases.Set(user, device, queue, saved.SubtitleEnabled, saved.SubtitleLanguage);
        if (policy is null) return;
        if (saved.HasPreference) policy = policy with { Enabled = saved.SubtitleEnabled, Language = saved.SubtitleLanguage };
        var account = users.GetUserById(user);
        if (account?.HasPermission(PermissionKind.EnableMediaPlayback) != true || args.Item is null || !args.Item.IsVisible(account)) return;
        var index = -1;
        if (policy.Enabled)
        {
            var sourceId = string.IsNullOrWhiteSpace(args.MediaSourceId) ? session.PlayState?.MediaSourceId : args.MediaSourceId;
            var source = sources.GetStaticMediaSources(args.Item, false, account)
                .FirstOrDefault(s => string.IsNullOrEmpty(sourceId) || string.Equals(s.Id, sourceId, StringComparison.OrdinalIgnoreCase));
            if (source is null) return;
            if (string.IsNullOrEmpty(policy.Language)) policy = policy with { Language = account.SubtitleLanguagePreference ?? string.Empty };
            index = PlaybackSubtitlePolicyFilter.SelectIndex(source, policy);
        }
        if (session.PlayState?.SubtitleStreamIndex == index) return;
        var key = session.Id + ":" + item.ToString("N");
        var now = DateTimeOffset.UtcNow;
        if (_sent.TryGetValue(key, out var previous) && previous.Index == index && now - previous.Sent < TimeSpan.FromSeconds(5)) return;
        _sent[key] = (index, now);
        if (_sent.Count > 256)
            foreach (var entry in _sent.OrderBy(entry => entry.Value.Sent).Take(_sent.Count - 256))
                _sent.TryRemove(entry.Key, out _);
        // The callback runs asynchronously; a different title may have started
        // while timeline state was being read. Never command that newer player.
        if (session.NowPlayingItem?.Id != item) return;
        await sessions.SendGeneralCommand(session.Id, session.Id, new GeneralCommand
        {
            Name = GeneralCommandType.SetSubtitleStreamIndex,
            ControllingUserId = user,
            Arguments = { ["Index"] = index.ToString(CultureInfo.InvariantCulture) }
        }, CancellationToken.None).ConfigureAwait(false);
    }
}
