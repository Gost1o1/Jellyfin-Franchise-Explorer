namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// A reusable named IMDb list. Its identity is independent of the source ownership
/// recorded by each franchise or row, so removing a preset does not remove imports.
/// </summary>
public sealed class FranchiseImdbList
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string Name { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
}
