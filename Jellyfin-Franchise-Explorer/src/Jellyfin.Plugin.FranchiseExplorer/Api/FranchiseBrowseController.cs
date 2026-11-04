using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
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
            version = "0.8.9.22",
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
                artwork = new
                {
                    primaryUrl = n.Artwork?.PrimaryUrl ?? "",
                    backdropUrl = n.Artwork?.BackdropUrl ?? "",
                    logoUrl = n.Artwork?.LogoUrl ?? "",
                    thumbUrl = n.Artwork?.ThumbUrl ?? "",
                    bannerUrl = n.Artwork?.BannerUrl ?? ""
                }
            }).ToArray(),
            rows = config.Rows.Select(r => new
            {
                id = r.Id,
                parentNodeId = r.ParentNodeId,
                name = r.Name,
                rowType = r.RowType,
                autoAddCategory = config.Nodes.SelectMany(n => n.AutoAddRows ?? new()).FirstOrDefault(m => m.RowId == r.Id)?.Category ?? "",
                sortOrder = r.SortOrder,
                nodeIds = r.NodeIds,
                mediaLinkIds = r.MediaLinkIds,
                mediaOrder = r.MediaOrder,
                items = r.Items?.Select(i => new
                {
                    id = i.Id,
                    itemId = i.JellyfinItemId,
                    itemType = i.ItemType,
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
