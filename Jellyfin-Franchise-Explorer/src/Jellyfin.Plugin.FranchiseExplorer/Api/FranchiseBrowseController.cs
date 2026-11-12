using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>
/// Read-only, user-facing, responsive franchise browsing page.
/// The HTML shell contains no private data; the catalog requires authentication.
/// Media names, descriptions and artwork are resolved through each viewer's
/// own Jellyfin API access, not copied from the administrator's link labels.
/// </summary>
[ApiController]
[Route("FranchiseExplorer")]
public sealed class FranchiseBrowseController : ControllerBase
{
    private readonly ILogger<FranchiseBrowseController> _logger;

    public FranchiseBrowseController(ILogger<FranchiseBrowseController> logger)
    {
        _logger = logger;
    }

    public sealed class ClientErrorReport
    {
        public string? Source { get; set; }
        public string? Message { get; set; }
    }

    /// <summary>
    /// Record user-visible browser errors in Jellyfin's normal server log.
    /// Authenticated users only; do not accept arbitrary structured log fields.
    /// </summary>
    [HttpPost("ClientLog")]
    [Authorize]
    [RequestSizeLimit(4096)]
    public IActionResult ClientLog([FromBody] ClientErrorReport? report)
    {
        if (report is null || string.IsNullOrWhiteSpace(report.Message)) return BadRequest();
        var source = Regex.Replace((report.Source ?? "browser")[..Math.Min(report.Source?.Length ?? 7, 60)], @"[^a-zA-Z0-9 _.-]", "");
        var message = report.Message[..Math.Min(report.Message.Length, 1000)];
        // Error text can originate from an HTTP failure. Never persist URLs,
        // authorization headers, or API keys verbatim in the server log.
        message = Regex.Replace(message, @"https?://\S+", "[URL]", RegexOptions.IgnoreCase);
        message = Regex.Replace(message, @"(?i)(authorization|api[_-]?key|access[_-]?token|token)\s*[:=]\s*\S+", "$1=[REDACTED]");
        message = message.Replace('\r', ' ').Replace('\n', ' ');
        _logger.LogWarning("Franchise Explorer client notification [{Source}]: {Message}", source, message);
        return NoContent();
    }

    [HttpGet("Browse")]
    [AllowAnonymous]
    public IActionResult Browse()
    {
        // Serving a public HTML shell is safe: it contains no configuration,
        // user data or media metadata, and its API calls still require auth.
        var assembly = typeof(Plugin).Assembly;
        const string resource = "Jellyfin.Plugin.FranchiseExplorer.Configuration.browsePage.html";
        using var stream = assembly.GetManifestResourceStream(resource);
        if (stream is null) return NotFound("Franchise browser resource is missing.");
        using var reader = new StreamReader(stream);
        var html = reader.ReadToEnd();
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["X-Frame-Options"] = "SAMEORIGIN";
        return Content(html, "text/html; charset=utf-8");
    }

    [HttpGet("TimelineClient.js")]
    [AllowAnonymous]
    public IActionResult TimelineClient()
    {
        var assembly = typeof(Plugin).Assembly;
        using var stream = assembly.GetManifestResourceStream("Jellyfin.Plugin.FranchiseExplorer.Web.franchise-timeline.js");
        if (stream is null) return NotFound();
        using var reader = new StreamReader(stream);
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return Content(reader.ReadToEnd(), "text/javascript; charset=utf-8");
    }

    private static object ArtworkPayload(ArtworkMetadata? artwork) => new
    {
        primaryUrl = artwork?.PrimaryUrl ?? string.Empty,
        backdropUrl = artwork?.BackdropUrl ?? string.Empty,
        backdropVideoItemId = artwork?.BackdropVideoItemId ?? string.Empty,
        logoUrl = artwork?.LogoUrl ?? string.Empty,
        thumbUrl = artwork?.ThumbUrl ?? string.Empty,
        bannerUrl = artwork?.BannerUrl ?? string.Empty
    };

    private static string DisplayEpisodeFormat(string? rowFormat, string? ownerFormat)
    {
        var value = rowFormat?.Trim();
        if (string.Equals(value, "Individual", StringComparison.OrdinalIgnoreCase)) return "Individual";
        if (string.Equals(value, "Bundles", StringComparison.OrdinalIgnoreCase)) return "Bundles";
        return string.Equals(ownerFormat?.Trim(), "Individual", StringComparison.OrdinalIgnoreCase)
            ? "Individual" : "Bundles";
    }

    // Playback needs only identity/range restrictions. Never publish the automation
    // registry, source URLs, admin labels, review inbox or exclusion explanations.
    private static object[] PlaybackExclusions(PluginConfiguration config, FranchiseRow row)
    {
        var owners = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static string ScopeId(string value) => Guid.TryParse(value, out var parsed) ? parsed.ToString("N") : value;
        var cursor = row.ParentNodeId;
        while (cursor.Length > 0 && owners.Add(ScopeId(cursor))) cursor = config.Nodes.FirstOrDefault(n => ScopeId(n.Id) == ScopeId(cursor))?.ParentId ?? "";
        var registrations = config.AutoFranchises.Registry.Where(r => owners.Contains(ScopeId(r.FranchiseNodeId)) || r.Rows.Any(m => ScopeId(m.RowId) == ScopeId(row.Id))).Select(r => ScopeId(r.Id)).ToHashSet();
        var scopes = new HashSet<string>(new[] { "Movie", "WholeShow", "Show", "Series", "Season", "Episode", "AllowedRange" }, StringComparer.OrdinalIgnoreCase);
        string Id(string value) => Guid.TryParse(value, out var id) ? id.ToString("N") : "";
        return config.AutoFranchises.Exclusions.Where(e => e.Enabled && scopes.Contains(e.Scope) && (e.RowId.Length == 0 || ScopeId(e.RowId) == ScopeId(row.Id)) &&
                (e.RegistrationId.Length > 0 ? registrations.Contains(ScopeId(e.RegistrationId)) : owners.Contains(ScopeId(e.FranchiseNodeId))))
            .Select(e => (object)new
            {
                scope = e.Scope, providerName = e.ProviderName, providerId = e.ProviderId, itemId = Id(e.JellyfinItemId),
                itemIds = config.MediaRecovery.KnownItems.Where(s =>
                        (s.Identity.ItemType == "Series" || e.Scope.Equals("Movie", StringComparison.OrdinalIgnoreCase) && s.Identity.ItemType == "Movie" || e.Scope.Equals("Episode", StringComparison.OrdinalIgnoreCase) && s.Identity.ItemType == "Episode") &&
                        e.ProviderId.Length > 0 && s.Identity.ProviderIds.Any(p => p.Name.Equals(e.ProviderName, StringComparison.OrdinalIgnoreCase) && p.Value.Equals(e.ProviderId, StringComparison.OrdinalIgnoreCase)))
                    .Select(s => Id(s.ItemId)).Where(id => id.Length > 0).Distinct().ToArray(),
                startSeason = e.StartSeason, endSeason = e.EndSeason, startEpisode = e.StartEpisode, endEpisode = e.EndEpisode
            }).ToArray();
    }

    [HttpGet("Catalog")]
    [Authorize]
    public IActionResult Catalog()
    {
        var plugin = Plugin.Instance;
        if (plugin is null) return StatusCode(503);
        var config = plugin.Configuration;
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        // Shared display metadata is intentionally visible to authenticated users.
        // Do not expose admin-defined media display labels, which may contain
        // titles that a particular user isn't allowed to browse.
        return Ok(new
        {
            version = "0.8.9.32",
            title = string.IsNullOrWhiteSpace(config.NavigationLabel) ? "Franchises" : config.NavigationLabel,
            nodes = config.Nodes.Select(n => new
            {
                id = n.Id,
                parentId = n.ParentId,
                name = n.Name,
                nodeType = n.NodeType,
                collectionId = n.CollectionId,
                overview = n.Overview,
                sortOrder = n.SortOrder,
                artwork = ArtworkPayload(n.Artwork)
            }).ToArray(),
            rows = config.Rows.Select(r => new
            {
                id = r.Id,
                parentNodeId = r.ParentNodeId,
                name = r.Name,
                rowType = r.RowType,
                category = r.Category,
                episodeFormat = DisplayEpisodeFormat(r.EpisodeFormat,
                    config.Nodes.FirstOrDefault(n => n.Id == r.ParentNodeId)?.EpisodeFormat),
                artwork = ArtworkPayload(r.Artwork),
                autoAddCategory = config.Nodes.SelectMany(n => n.AutoAddRows ?? new()).FirstOrDefault(m => m.RowId == r.Id)?.Category ?? "",
                sortOrder = r.SortOrder,
                nodeIds = r.NodeIds,
                mediaLinkIds = r.MediaLinkIds,
                mediaOrder = r.MediaOrder,
                exclusions = PlaybackExclusions(config, r),
                items = r.Items?.Select(i => new
                {
                    id = i.Id,
                    itemId = i.JellyfinItemId,
                    itemType = i.ItemType,
                    artwork = ArtworkPayload(i.Artwork),
                    rangeMode = i.RangeMode,
                    startSeason = i.StartSeason,
                    endSeason = i.EndSeason,
                    startEpisode = i.StartEpisode,
                    endEpisode = i.EndEpisode
                }).ToArray()
            }).ToArray(),
            links = config.MediaLinks.Select(l => new
            {
                id = l.Id,
                nodeId = l.NodeId,
                itemId = l.JellyfinItemId,
                itemType = l.ItemType,
                artwork = ArtworkPayload(l.Artwork),
                rangeMode = l.RangeMode,
                startSeason = l.StartSeason,
                endSeason = l.EndSeason,
                startEpisode = l.StartEpisode,
                endEpisode = l.EndEpisode,
                viewingOrder = l.ViewingOrder,
                position = l.Position
            }).ToArray()
        });
    }
}
