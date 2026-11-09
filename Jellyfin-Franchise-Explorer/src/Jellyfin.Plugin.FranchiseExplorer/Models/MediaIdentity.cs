namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Portable identity only. Paths, server credentials and playback URLs are never stored.</summary>
public sealed class MediaIdentity
{
    public string ItemType { get; set; } = string.Empty;
    public int? Year { get; set; }
    public List<MediaProviderIdentity> ProviderIds { get; set; } = new();
    public List<MediaProviderIdentity> SeriesProviderIds { get; set; } = new();
    public int? SeasonNumber { get; set; }
    public int? EpisodeNumber { get; set; }
    public int? EpisodeEnd { get; set; }
}

public sealed class MediaProviderIdentity
{
    public string Name { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

/// <summary>Identity retained for queue episodes, collection and artwork dependencies.</summary>
public sealed class MediaIdentitySnapshot
{
    public string ItemId { get; set; } = string.Empty;
    /// <summary>Old parent ID is retained solely to distinguish library versions during an explicit mapping.</summary>
    public string SeriesItemId { get; set; } = string.Empty;
    public MediaIdentity Identity { get; set; } = new();
}
