namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Virtual group with an optional parent and independent artwork.</summary>
public sealed class FranchiseNode
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ParentId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string GroupType { get; set; } = "Franchise";
    public string? Overview { get; set; }
    public int SortOrder { get; set; }
    public Dictionary<string, string> ImagePaths { get; set; } = new();
}
