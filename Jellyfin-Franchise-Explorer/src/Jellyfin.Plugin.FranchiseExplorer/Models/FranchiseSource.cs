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

/// <summary>Ownership and edit fingerprint for reviewed Auto-Add removals.</summary>
public sealed class FranchiseAutoAddRecord
{
    /// <summary>Empty for a franchise source, or the exact row owning an independent IMDb override.</summary>
    public string ScopeRowId { get; set; } = string.Empty;
    public string ReferenceId { get; set; } = string.Empty;
    public string RowId { get; set; } = string.Empty;
    public List<string> SourceIds { get; set; } = new();
    public List<string> ImdbIds { get; set; } = new();
    public string Signature { get; set; } = string.Empty;
}
