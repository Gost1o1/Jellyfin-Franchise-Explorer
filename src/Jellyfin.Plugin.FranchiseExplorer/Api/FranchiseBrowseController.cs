using System;
using System.IO;
using System.Linq;
using System.Reflection;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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
            version = "0.7.3.0",
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
                sortOrder = r.SortOrder,
                nodeIds = r.NodeIds,
                mediaLinkIds = r.MediaLinkIds
            }).ToArray(),
            links = config.MediaLinks.Select(l => new
            {
                id = l.Id,
                nodeId = l.NodeId,
                itemId = l.JellyfinItemId,
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
