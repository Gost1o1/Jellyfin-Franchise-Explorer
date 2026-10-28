using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.FranchiseExplorer.Api;

/// <summary>
/// Uploads and serves group-only artwork to signed-in Jellyfin viewers.
/// Files are kept in the plugin data folder, never in the media library.
/// Upload remains administrator-only; authenticated viewers may read previews.
/// </summary>
[ApiController]
[Route("FranchiseExplorer/Artwork")]
[Authorize]
public sealed class FranchiseArtworkController : ControllerBase
{
    private const long MaxImageBytes = 8 * 1024 * 1024;
    private static readonly string[] AllowedSlots = ["primary", "backdrop", "logo", "thumb", "banner"];
    private static readonly string[] AllowedExtensions = ["png", "jpg", "webp"];

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
