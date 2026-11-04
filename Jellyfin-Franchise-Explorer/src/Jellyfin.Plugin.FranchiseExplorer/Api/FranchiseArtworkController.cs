using System;
using System.IO;
using System.Linq;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>
/// Uploads and serves virtual franchise artwork to signed-in Jellyfin viewers.
/// Files are kept in the plugin data folder, never in the media library.
/// Upload remains administrator-only; authenticated viewers may read previews.
/// </summary>
[ApiController]
[Route("FranchiseExplorer/Artwork")]
[Authorize]
public sealed class FranchiseArtworkController : ControllerBase
{
    private readonly ILibraryManager _library;
    private readonly IUserManager _users;
    public FranchiseArtworkController(ILibraryManager library, IUserManager users)
    {
        _library = library;
        _users = users;
    }

    private sealed record PreviewTicket(Guid UserId, Guid ItemId, DateTimeOffset Expires);
    private static readonly ConcurrentDictionary<Guid, PreviewTicket> PreviewTickets = new();
    private const long MaxImageBytes = 8 * 1024 * 1024;
    private static readonly string[] AllowedSlots = ["primary", "backdrop", "logo", "thumb", "banner"];
    private static readonly string[] AllowedExtensions = ["png", "jpg", "webp"];

    private Video? VisibleVideo(Guid itemId, Guid userId)
    {
        var user = _users.GetUserById(userId);
        var item = _library.GetItemById(itemId) as Video;
        if (user is null || !user.HasPermission(PermissionKind.EnableMediaPlayback) || item is null
            || !item.IsVisible(user) || string.IsNullOrWhiteSpace(item.Path) || !System.IO.File.Exists(item.Path)) return null;
        var extension = Path.GetExtension(item.Path).ToLowerInvariant();
        return extension is ".mp4" or ".webm" ? item : null;
    }

    /// <summary>Create a short-lived, single-video capability without putting an API token in a media URL.</summary>
    [HttpPost("VideoPreview/{itemId:guid}")]
    public IActionResult CreateVideoPreview(Guid itemId)
    {
        if (!Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var userId)) return Unauthorized();
        if (VisibleVideo(itemId, userId) is null) return NotFound("An accessible MP4 or WebM video is required.");
        var now = DateTimeOffset.UtcNow;
        foreach (var old in PreviewTickets.Where(pair => pair.Value.Expires <= now).Select(pair => pair.Key)) PreviewTickets.TryRemove(old, out _);
        if (PreviewTickets.Count >= 2048) return StatusCode(429);
        var ticket = Guid.NewGuid();
        var expires = now.AddMinutes(5);
        PreviewTickets[ticket] = new PreviewTicket(userId, itemId, expires);
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new { url = "/FranchiseExplorer/Artwork/VideoPreview/" + ticket.ToString("N"), expiresAt = expires });
    }

    /// <summary>Serve only the authorized video identified by a temporary capability; recheck viewer access on every range request.</summary>
    [HttpGet("VideoPreview/{ticket:guid}")]
    [AllowAnonymous]
    public IActionResult VideoPreview(Guid ticket)
    {
        if (!PreviewTickets.TryGetValue(ticket, out var grant)) return NotFound();
        if (grant.Expires <= DateTimeOffset.UtcNow) { PreviewTickets.TryRemove(ticket, out _); return NotFound(); }
        var video = VisibleVideo(grant.ItemId, grant.UserId);
        if (video is null) return NotFound();
        Response.Headers["Cache-Control"] = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return PhysicalFile(video.Path, Path.GetExtension(video.Path).Equals(".webm", StringComparison.OrdinalIgnoreCase) ? "video/webm" : "video/mp4", enableRangeProcessing: true);
    }

    /// <summary>Immutable draft uploads work for unsaved nodes, rows and media references; selecting one never replaces an existing file.</summary>
    [HttpPost("Assets")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [RequestSizeLimit(MaxImageBytes + 1024 * 1024)]
    public async Task<IActionResult> UploadAsset(IFormFile file, CancellationToken cancellationToken)
    {
        var plugin = Plugin.Instance;
        if (plugin is null || string.IsNullOrWhiteSpace(plugin.DataFolderPath)) return StatusCode(503);
        if (file is null || file.Length == 0 || file.Length > MaxImageBytes) return BadRequest("Choose a PNG, JPEG or WebP image under 8 MB.");
        await using var memory = new MemoryStream();
        await using (var input = file.OpenReadStream()) await input.CopyToAsync(memory, cancellationToken).ConfigureAwait(false);
        if (memory.Length > MaxImageBytes) return BadRequest("Image is too large.");
        var bytes = memory.ToArray();
        var detected = DetectImage(bytes);
        if (detected is null) return BadRequest("Unsupported image. Use PNG, JPEG or WebP.");
        var id = Guid.NewGuid();
        var directory = Path.Combine(plugin.DataFolderPath, "franchise-artwork", "assets");
        Directory.CreateDirectory(directory);
        var destination = Path.Combine(directory, id.ToString("N") + "." + detected.Value.Extension);
        await using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            await output.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new { url = "/FranchiseExplorer/Artwork/Assets/" + id.ToString("N"), contentType = detected.Value.ContentType });
    }

    [HttpGet("Assets/{id:guid}")]
    public IActionResult ReadAsset(Guid id)
    {
        var plugin = Plugin.Instance;
        if (plugin is null || string.IsNullOrWhiteSpace(plugin.DataFolderPath)) return NotFound();
        foreach (var extension in AllowedExtensions)
        {
            var path = Path.Combine(plugin.DataFolderPath, "franchise-artwork", "assets", id.ToString("N") + "." + extension);
            if (!System.IO.File.Exists(path)) continue;
            Response.Headers["Cache-Control"] = "private, max-age=86400, immutable";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            return PhysicalFile(path, extension == "jpg" ? "image/jpeg" : "image/" + extension);
        }
        return NotFound();
    }

    private static bool TryGetSlot(string slot, out string normalized)
    {
        normalized = slot.ToLowerInvariant();
        return AllowedSlots.Contains(normalized, StringComparer.Ordinal);
    }

    private static bool TryGetDirectory(Guid nodeId, out string directory)
    {
        directory = string.Empty;
        var plugin = Plugin.Instance;
        if (plugin is null || string.IsNullOrWhiteSpace(plugin.DataFolderPath))
        {
            return false;
        }

        // A persisted node must exist before artwork may be stored or served.
        if (!plugin.Configuration.Nodes.Any(n => Guid.TryParse(n.Id, out var parsed) && parsed == nodeId))
        {
            return false;
        }

        directory = Path.Combine(plugin.DataFolderPath, "franchise-artwork", nodeId.ToString("N"));
        return true;
    }

    private static (string Extension, string ContentType)? DetectImage(byte[] bytes)
    {
        if (bytes.Length >= 24
            && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4e && bytes[3] == 0x47
            && bytes[4] == 0x0d && bytes[5] == 0x0a && bytes[6] == 0x1a && bytes[7] == 0x0a
            && bytes[12] == 0x49 && bytes[13] == 0x48 && bytes[14] == 0x44 && bytes[15] == 0x52)
        {
            var width = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16, 4));
            var height = System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20, 4));
            if (width == 0 || height == 0 || width > 10000 || height > 10000) return null;
            return ("png", "image/png");
        }

        if (bytes.Length >= 4 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff)
        {
            return ("jpg", "image/jpeg");
        }

        if (bytes.Length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F'
            && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P')
        {
            return ("webp", "image/webp");
        }

        return null;
    }

    /// <summary>Upload a PNG, JPEG, or WebP file to the plugin-owned artwork directory.</summary>
    [HttpPost("{nodeId:guid}/{slot}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [RequestSizeLimit(MaxImageBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload(Guid nodeId, string slot, IFormFile file, CancellationToken cancellationToken)
    {
        if (!TryGetSlot(slot, out var safeSlot)) return BadRequest("Unknown artwork type.");
        if (!TryGetDirectory(nodeId, out var directory)) return NotFound("Save the franchise group first.");
        if (file is null || file.Length == 0 || file.Length > MaxImageBytes)
        {
            return BadRequest("An image between 1 byte and 8 MB is required.");
        }

        byte[] bytes;
        await using (var input = file.OpenReadStream())
        await using (var memory = new MemoryStream())
        {
            await input.CopyToAsync(memory, cancellationToken).ConfigureAwait(false);
            if (memory.Length > MaxImageBytes) return BadRequest("Image is too large.");
            bytes = memory.ToArray();
        }

        var detected = DetectImage(bytes);
        if (detected is null) return BadRequest("Unsupported or invalid image. Use PNG, JPEG, or WebP.");

        Directory.CreateDirectory(directory);
        var destination = Path.Combine(directory, safeSlot + "." + detected.Value.Extension);
        var temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            await System.IO.File.WriteAllBytesAsync(temporary, bytes, cancellationToken).ConfigureAwait(false);
            System.IO.File.Move(temporary, destination, true);
            foreach (var extension in AllowedExtensions.Where(e => e != detected.Value.Extension))
            {
                var obsolete = Path.Combine(directory, safeSlot + "." + extension);
                if (System.IO.File.Exists(obsolete)) System.IO.File.Delete(obsolete);
            }
        }
        finally
        {
            if (System.IO.File.Exists(temporary)) System.IO.File.Delete(temporary);
        }

        Response.Headers["Cache-Control"] = "no-store";
        return Ok(new
        {
            url = "/FranchiseExplorer/Artwork/" + nodeId.ToString("N") + "/" + safeSlot,
            contentType = detected.Value.ContentType,
            bytes = bytes.Length
        });
    }

    /// <summary>Serve an uploaded image to an authenticated Jellyfin administrator.</summary>
    [HttpGet("{nodeId:guid}/{slot}")]
    public IActionResult Read(Guid nodeId, string slot)
    {
        if (!TryGetSlot(slot, out var safeSlot)) return NotFound();
        if (!TryGetDirectory(nodeId, out var directory)) return NotFound();
        foreach (var extension in AllowedExtensions)
        {
            var path = Path.Combine(directory, safeSlot + "." + extension);
            if (!System.IO.File.Exists(path)) continue;
            var mime = extension switch { "png" => "image/png", "jpg" => "image/jpeg", _ => "image/webp" };
            Response.Headers["Cache-Control"] = "no-store";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            return PhysicalFile(path, mime, enableRangeProcessing: false);
        }

        return NotFound();
    }
}
