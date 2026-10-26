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
    public string Overview { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public ArtworkMetadata Artwork { get; set; } = new();
}
