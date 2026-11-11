using System.Text.Json;
using Jellyfin.Plugin.FranchiseExplorer.Web;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

[ApiController]
[Authorize]
[Route("FranchiseExplorer/ViewerPreferences")]
public sealed class FranchiseViewerPreferencesController(FranchiseViewerPreferenceStore store, IUserManager users) : ControllerBase
{
    public sealed class PreferenceRequest
    {
        public bool? SubtitleEnabled { get; set; }
        public string SubtitleLanguage { get; set; } = string.Empty;
    }

    [HttpGet]
    public IActionResult Read()
    {
        if (!PlaybackSubtitleIdentity.TryUser(User, users, out var user)) return Unauthorized();
        try { return PreferenceJson(store.Get(user)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        { return StatusCode(503, "Viewer preferences temporarily unavailable."); }
    }

    [HttpPut]
    [RequestSizeLimit(4096)]
    public IActionResult Save([FromBody] PreferenceRequest request)
    {
        if (!PlaybackSubtitleIdentity.TryUser(User, users, out var user)) return Unauthorized();
        if (request?.SubtitleEnabled is not bool enabled || !FranchiseViewerPreferenceStore.ValidLanguage(request.SubtitleLanguage))
            return BadRequest("Invalid subtitle preference.");
        try { return PreferenceJson(store.Set(user, enabled, request.SubtitleLanguage)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        { return StatusCode(503, "Viewer preferences could not be saved."); }
    }

    private IActionResult PreferenceJson(FranchiseViewerPreference preference)
    {
        Response.Headers.CacheControl = "no-store";
        return Content(JsonSerializer.Serialize(preference, new JsonSerializerOptions(JsonSerializerDefaults.Web)), "application/json; charset=utf-8");
    }
}
