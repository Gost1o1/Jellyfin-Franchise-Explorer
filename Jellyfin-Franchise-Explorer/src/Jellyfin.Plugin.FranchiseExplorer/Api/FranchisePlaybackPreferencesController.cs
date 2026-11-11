using System.Text.Json;
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
    ILibraryManager? library = null, IMediaSourceManager? mediaSources = null,
    FranchiseViewerPreferenceStore? preferences = null) : ControllerBase
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
        if (request is null) return BadRequest("Invalid playback preference scope.");
        // A local/native client may omit the redundant device field. The fallback is
        // Jellyfin's authenticated claim; an arbitrary supplied device is still checked.
        var device = string.IsNullOrWhiteSpace(request.DeviceId)
            ? User.FindFirst("Jellyfin-DeviceId")?.Value ?? string.Empty : request.DeviceId;
        if (string.IsNullOrWhiteSpace(device) || device.Length > 256
            || request.ItemIds is null || request.ItemIds.Length is < 1 or > 1000 || request.ItemIds.Contains(Guid.Empty)
            || !FranchiseViewerPreferenceStore.ValidLanguage(request.Language)
            || request.MediaSourceId?.Length > 256)
            return BadRequest("Invalid playback preference scope.");
        if (!PlaybackSubtitleIdentity.OwnsDevice(sessions, user, device)) return Forbid();
        FranchiseViewerPreference? saved;
        try { saved = preferences?.Get(user); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        { return StatusCode(503, "Viewer preferences temporarily unavailable."); }
        var enabled = saved?.HasPreference == true ? saved.SubtitleEnabled : request.Enabled;
        var chosenLanguage = saved?.HasPreference == true ? saved.SubtitleLanguage : request.Language;
        var language = chosenLanguage.Length > 0 ? chosenLanguage : users.GetUserById(user)?.SubtitleLanguagePreference ?? string.Empty;
        var policy = store.Set(user, device, request.ItemIds, enabled, language.Length <= 20 ? language : string.Empty);
        var account = users.GetUserById(user);
        var firstItem = library?.GetItemById(request.ItemIds[0]);
        var source = firstItem is null || account is null || !firstItem.IsVisible(account) ? null
            : mediaSources?.GetStaticMediaSources(firstItem, false, account)
                .FirstOrDefault(candidate => string.IsNullOrWhiteSpace(request.MediaSourceId)
                    || string.Equals(candidate.Id, request.MediaSourceId, StringComparison.OrdinalIgnoreCase));
        int? subtitleStreamIndex = source is null ? (policy.Enabled ? null : -1) : PlaybackSubtitlePolicyFilter.SelectIndex(source, policy);
        Response.Headers.CacheControl = "no-store";
        return Content(JsonSerializer.Serialize(new { policy.Enabled, policy.Language, expiresAt = policy.ExpiresAt,
            subtitleStreamIndex, mediaSourceId = source?.Id, deviceId = device, hasPreference = saved?.HasPreference == true,
            subtitleLanguage = chosenLanguage },
            new JsonSerializerOptions(JsonSerializerDefaults.Web)), "application/json; charset=utf-8");
    }
}
