namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Plugin-owned import settings; XML defaults preserve older configurations.</summary>
public sealed class FranchiseSource
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string Url { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public int Priority { get; set; }
    public List<string> Categories { get; set; } = new();
}

/// <summary>Stable presentation-row identity, so later renames and deletions are respected.</summary>
public sealed class FranchiseAutoAddRow
{
    public string Category { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
}
