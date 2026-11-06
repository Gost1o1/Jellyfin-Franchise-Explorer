using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.FranchiseExplorer.Web;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>Enrolls an explicit franchise launch without changing Jellyfin user settings.</summary>
[ApiController]
[Authorize]
[Route("FranchiseExplorer/PlaybackPreferences")]
public sealed class FranchisePlaybackPreferencesController(
    PlaybackSubtitlePolicyStore store, IUserManager users, ISessionManager sessions,
    ILibraryManager? library = null, IMediaSourceManager? mediaSources = null) : ControllerBase
{
    public sealed class PlaybackPreferencesRequest
    {
        public string DeviceId { get; set; } = string.Empty;
        public Guid[] ItemIds { get; set; } = Array.Empty<Guid>();
        public bool Enabled { get; set; }
        public string Language { get; set; } = string.Empty;
        public string? MediaSourceId { get; set; }
    }

    [HttpPost]
    [RequestSizeLimit(64 * 1024)]
    public IActionResult Save([FromBody] PlaybackPreferencesRequest request)
    {
        if (!PlaybackSubtitleIdentity.TryUser(User, users, out var user)) return Unauthorized();
        if (request is null || string.IsNullOrWhiteSpace(request.DeviceId) || request.DeviceId.Length > 256
            || request.ItemIds is null || request.ItemIds.Length is < 1 or > 1000 || request.ItemIds.Contains(Guid.Empty)
            || request.Language is null || request.Language.Length > 20
            || request.MediaSourceId?.Length > 256
            || (request.Language.Length > 0 && !Regex.IsMatch(request.Language, "^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$", RegexOptions.CultureInvariant)))
            return BadRequest("Invalid playback preference scope.");
        if (!PlaybackSubtitleIdentity.OwnsDevice(sessions, user, request.DeviceId)) return Forbid();
        var language = request.Language.Length > 0 ? request.Language : users.GetUserById(user)?.SubtitleLanguagePreference ?? string.Empty;
        var policy = store.Set(user, request.DeviceId, request.ItemIds, request.Enabled, language.Length <= 20 ? language : string.Empty);
        var account = users.GetUserById(user);
        var firstItem = library?.GetItemById(request.ItemIds[0]);
        var source = firstItem is null || account is null || !firstItem.IsVisible(account) ? null
            : mediaSources?.GetStaticMediaSources(firstItem, false, account)
                .FirstOrDefault(candidate => string.IsNullOrWhiteSpace(request.MediaSourceId)
                    || string.Equals(candidate.Id, request.MediaSourceId, StringComparison.OrdinalIgnoreCase));
        int? subtitleStreamIndex = source is null ? (policy.Enabled ? null : -1) : PlaybackSubtitlePolicyFilter.SelectIndex(source, policy);
        Response.Headers.CacheControl = "no-store";
        return Content(JsonSerializer.Serialize(new { policy.Enabled, policy.Language, expiresAt = policy.ExpiresAt,
            subtitleStreamIndex, mediaSourceId = source?.Id },
            new JsonSerializerOptions(JsonSerializerDefaults.Web)), "application/json; charset=utf-8");
    }
}
