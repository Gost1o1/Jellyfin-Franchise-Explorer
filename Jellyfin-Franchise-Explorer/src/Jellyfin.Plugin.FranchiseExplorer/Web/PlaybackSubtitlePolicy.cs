using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Jellyfin.Plugin.FranchiseExplorer.Web;

/// <summary>A short-lived preference for explicitly enrolled franchise items on one device.</summary>
public sealed record PlaybackSubtitlePolicy(bool Enabled, string Language, DateTimeOffset ExpiresAt);

/// <summary>Bounded, memory-only leases; ordinary playback never changes a Jellyfin user preference.</summary>
public sealed class PlaybackSubtitlePolicyStore(TimeProvider? clock = null)
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly object _gate = new();
    private readonly Dictionary<(Guid User, string Device), Lease> _leases = new();
    private sealed record Lease(PlaybackSubtitlePolicy Policy, HashSet<Guid> Items);

    public PlaybackSubtitlePolicy Set(Guid user, string device, IEnumerable<Guid> ids, bool enabled, string language)
    {
        var items = ids.ToHashSet();
        if (user == Guid.Empty || string.IsNullOrWhiteSpace(device) || device.Length > 256
            || items.Count is < 1 or > 1000 || items.Contains(Guid.Empty) || language.Length > 20)
            throw new ArgumentException("Invalid playback preference scope.");
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            foreach (var key in _leases.Where(pair => pair.Value.Policy.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
                _leases.Remove(key);
            var keyForDevice = (user, device);
            if (!_leases.ContainsKey(keyForDevice) && _leases.Count >= 256)
                _leases.Remove(_leases.MinBy(pair => pair.Value.Policy.ExpiresAt).Key);
            var policy = new PlaybackSubtitlePolicy(enabled, language, now.AddHours(12));
            _leases[keyForDevice] = new Lease(policy, items);
            return policy;
        }
    }

    public bool TryGet(Guid user, string device, Guid item, out PlaybackSubtitlePolicy? policy)
    {
        lock (_gate)
        {
            policy = null;
            var key = (user, device);
            if (!_leases.TryGetValue(key, out var lease)) return false;
            if (lease.Policy.ExpiresAt <= _clock.GetUtcNow())
            {
                _leases.Remove(key);
                return false;
            }
            // Browsing/preloading another title can request PlaybackInfo while a native
            // queue is still playing. Such requests never receive this policy and must
            // not erase the explicit queue's remaining items.
            if (!lease.Items.Contains(item)) return false;
            policy = lease.Policy;
            return true;
        }
    }
}

/// <summary>Uses claims created by Jellyfin's TokenAuthenticationHandler, never request-supplied user IDs.</summary>
public static class PlaybackSubtitleIdentity
{
    public static bool TryUser(ClaimsPrincipal principal, IUserManager users, out Guid user)
    {
        user = Guid.Empty;
        return principal.Identity?.IsAuthenticated == true
            && Guid.TryParse(principal.FindFirst("Jellyfin-UserId")?.Value, out user) && user != Guid.Empty
            && users.GetUserById(user)?.HasPermission(PermissionKind.EnableMediaPlayback) == true;
    }

    public static bool OwnsDevice(ISessionManager sessions, Guid user, string device)
        => !string.IsNullOrWhiteSpace(device) && device.Length <= 256
            && sessions.Sessions.Any(session => session.UserId == user
                && string.Equals(session.DeviceId, device, StringComparison.Ordinal));
}

/// <summary>
/// Applies only to Jellyfin's own PlaybackInfo actions. Negotiation receives the requested index,
/// and returned objects are cloned before changing defaults or stream URLs.
/// </summary>
public sealed class PlaybackSubtitlePolicyFilter(
    PlaybackSubtitlePolicyStore store, IUserManager users, ISessionManager sessions,
    ILibraryManager library, IMediaSourceManager mediaSources,
    FranchiseViewerPreferenceStore? preferences = null, FranchiseSubtitleTimelineScope? timelines = null) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.ActionDescriptor is not ControllerActionDescriptor action
            || action.ControllerTypeInfo.FullName != "Jellyfin.Api.Controllers.MediaInfoController"
            || action.MethodInfo.Name is not ("GetPlaybackInfo" or "GetPostedPlaybackInfo")
            || !PlaybackSubtitleIdentity.TryUser(context.HttpContext.User, users, out var user)
            || Argument(context, "itemId") is not Guid item)
        {
            await next().ConfigureAwait(false);
            return;
        }
        // The host supports an explicit userId for administrators. Do not apply this user's
        // franchise preference when the request intentionally targets another user.
        context.ActionArguments.TryGetValue("playbackInfoDto", out var body);
        var bodyUser = body?.GetType().GetProperty("UserId")?.GetValue(body);
        if ((Argument(context, "userId") is Guid target && target != Guid.Empty && target != user)
            || (bodyUser is Guid bodyTarget && bodyTarget != Guid.Empty && bodyTarget != user))
        {
            await next().ConfigureAwait(false);
            return;
        }
        var device = context.HttpContext.User.FindFirst("Jellyfin-DeviceId")?.Value ?? string.Empty;
        if (!PlaybackSubtitleIdentity.OwnsDevice(sessions, user, device))
        {
            await next().ConfigureAwait(false);
            return;
        }
        FranchiseViewerPreference? saved = null;
        try { saved = preferences?.Get(user); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { }
        var enrolled = store.TryGet(user, device, item, out var policy);
        // Native applications can use a different device ID from their embedded Web view.
        // Inherit account preferences only for an explicitly active franchise queue.
        if (!enrolled && saved?.HasPreference == true && timelines is not null
            && timelines.TryQueue(user, device, item, sessions, out var queue))
            policy = store.Set(user, device, queue, saved.SubtitleEnabled, saved.SubtitleLanguage);
        if (policy is null)
        {
            await next().ConfigureAwait(false);
            return;
        }
        if (saved?.HasPreference == true)
            policy = policy with { Enabled = saved.SubtitleEnabled, Language = saved.SubtitleLanguage.Length > 0
                ? saved.SubtitleLanguage : users.GetUserById(user)?.SubtitleLanguagePreference ?? string.Empty };

        if (action.MethodInfo.Name == "GetPostedPlaybackInfo")
        {
            var requestedSource = Argument(context, "mediaSourceId") as string;
            if (string.IsNullOrWhiteSpace(requestedSource))
                requestedSource = body?.GetType().GetProperty("MediaSourceId")?.GetValue(body) as string;
            var libraryItem = library.GetItemById(item);
            var account = users.GetUserById(user);
            var source = libraryItem is null || account is null || !libraryItem.IsVisible(account) ? null
                : mediaSources.GetStaticMediaSources(libraryItem, false, account)
                .FirstOrDefault(candidate => string.IsNullOrWhiteSpace(requestedSource)
                    || string.Equals(candidate.Id, requestedSource, StringComparison.OrdinalIgnoreCase));
            var index = source is null ? (policy.Enabled ? (int?)null : -1) : SelectIndex(source, policy);
            if (index.HasValue)
            {
                // Query arguments take precedence over the body in Jellyfin's controller.
                context.ActionArguments["subtitleStreamIndex"] = index.Value;
                SetBody(body, "SubtitleStreamIndex", index.Value);
                if (!string.IsNullOrEmpty(source?.Id))
                {
                    context.ActionArguments["mediaSourceId"] = source.Id;
                    SetBody(body, "MediaSourceId", source.Id);
                }
            }
        }
        var executed = await next().ConfigureAwait(false);
        if (executed.Result is ObjectResult { Value: PlaybackInfoResponse response } result)
            result.Value = Apply(response, policy);
    }

    private static object? Argument(ActionExecutingContext context, string name)
        => context.ActionArguments.TryGetValue(name, out var value) ? value : null;

    private static void SetBody(object? body, string name, object value)
    {
        var property = body?.GetType().GetProperty(name);
        if (property?.CanWrite == true) property.SetValue(body, value);
    }

    public static PlaybackInfoResponse Apply(PlaybackInfoResponse response, PlaybackSubtitlePolicy policy)
    {
        // Jellyfin media metadata can be cached and shared across requests/users.
        var copy = JsonSerializer.Deserialize<PlaybackInfoResponse>(JsonSerializer.SerializeToUtf8Bytes(response))!;
        for (var i = 0; i < copy.MediaSources.Count; i++)
        {
            var source = copy.MediaSources[i];
            // These are intentionally excluded from JSON by Jellyfin but still used by
            // other host filters/negotiation code. Keep them when cloning the response.
            source.TranscodeReasons = response.MediaSources[i].TranscodeReasons;
            source.DefaultAudioIndexSource = response.MediaSources[i].DefaultAudioIndexSource;
            var index = SelectIndex(source, policy);
            source.DefaultSubtitleStreamIndex = index;
            var secondary = source.GetType().GetProperty("DefaultSecondarySubtitleStreamIndex");
            if (!policy.Enabled && secondary?.CanWrite == true && (secondary.PropertyType == typeof(int) || secondary.PropertyType == typeof(int?)))
                secondary.SetValue(source, -1);
            source.TranscodingUrl = WithSubtitleIndex(source.TranscodingUrl, index);
            // Jellyfin 12.2 has no DirectStreamUrl member; support hosts exposing one without
            // introducing a dependency on their API assembly or losing other metadata.
            var directUrl = source.GetType().GetProperty("DirectStreamUrl");
            if (directUrl?.CanWrite == true && directUrl.PropertyType == typeof(string))
                directUrl.SetValue(source, WithSubtitleIndex(directUrl.GetValue(source) as string, index));
        }
        return copy;
    }

    public static int SelectIndex(MediaSourceInfo source, PlaybackSubtitlePolicy policy)
    {
        if (!policy.Enabled) return -1;
        var subtitles = source.MediaStreams.Where(stream => stream.Type == MediaStreamType.Subtitle && stream.Index >= 0).ToArray();
        var preferred = LanguageCode(policy.Language);
        var matching = subtitles.Where(stream => preferred.Length > 0 && LanguageCode(stream.Language) == preferred).ToArray();
        return matching.FirstOrDefault(stream => !stream.IsForced)?.Index
            ?? matching.FirstOrDefault()?.Index
            ?? subtitles.FirstOrDefault(stream => stream.Index == source.DefaultSubtitleStreamIndex)?.Index
            ?? subtitles.FirstOrDefault()?.Index ?? -1;
    }

    private static string LanguageCode(string? value)
    {
        var code = (value ?? string.Empty).Trim().ToLowerInvariant().Split('-', '_')[0];
        return code switch
        {
            "eng" => "en", "deu" or "ger" => "de", "fra" or "fre" => "fr", "spa" => "es",
            "ita" => "it", "por" => "pt", "nld" or "dut" => "nl", "jpn" => "ja",
            "zho" or "chi" => "zh", "kor" => "ko", "rus" => "ru", "pol" => "pl",
            "swe" => "sv", "dan" => "da", "fin" => "fi", "nor" or "nob" => "nb",
            "ara" => "ar", "hin" => "hi", "tur" => "tr", "ukr" => "uk", "ces" or "cze" => "cs",
            "ron" or "rum" => "ro", "ell" or "gre" => "el", "heb" => "he", "ind" => "id", "vie" => "vi",
            _ => code
        };
    }

    private static string? WithSubtitleIndex(string? url, int index)
    {
        if (string.IsNullOrEmpty(url)) return url;
        var hash = url.IndexOf('#');
        var fragment = hash < 0 ? string.Empty : url[hash..];
        var main = hash < 0 ? url : url[..hash];
        var query = main.IndexOf('?');
        var path = query < 0 ? main : main[..query];
        var parts = query < 0 ? Array.Empty<string>() : main[(query + 1)..].Split('&');
        // Preserve unrelated query bytes (including tokens, duplicate values and escaping).
        var kept = parts.Where(part => !IsSubtitleParameter(part)).ToList();
        kept.Add("SubtitleStreamIndex=" + index.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return path + "?" + string.Join('&', kept) + fragment;
    }

    private static bool IsSubtitleParameter(string part)
    {
        var key = part.Split('=', 2)[0];
        return string.Equals(Uri.UnescapeDataString(key), "SubtitleStreamIndex", StringComparison.OrdinalIgnoreCase);
    }
}
