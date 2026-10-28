namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Reference to an existing Jellyfin item, not a copy of its file.</summary>
public sealed class MediaReference
{
    public Guid NodeId { get; set; }
    public Guid JellyfinItemId { get; set; }
    public string? ProviderId { get; set; }
    public string? ProviderName { get; set; }
    public int SortOrder { get; set; }
    public string ViewingOrder { get; set; } = "Custom";
}
