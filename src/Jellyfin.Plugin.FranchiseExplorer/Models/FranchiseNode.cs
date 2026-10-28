using System;

namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// Virtual hierarchy node. Id and ParentId are string GUIDs for a portable JSON export.
/// </summary>
public sealed class FranchiseNode
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string ParentId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string NodeType { get; set; } = "Franchise";
    /// <summary>Optional existing Jellyfin BoxSet ID to inherit images and import members from.</summary>
    public string CollectionId { get; set; } = string.Empty;
    /// <summary>
    /// Collection: pre-v0.7.2 collection-first inheritance; Preserve: existing
    /// parent / linked artwork first, associated collection only as fallback.
    /// Kept as a string for compatibility with Jellyfin's XML serializer.
    /// </summary>
    public string CollectionArtworkMode { get; set; } = "Collection";
    public string Overview { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public ArtworkMetadata Artwork { get; set; } = new();
}
