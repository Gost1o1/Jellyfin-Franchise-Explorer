using System;

namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// Virtual reference to a Jellyfin item. No media is moved, copied, or deleted.
/// This preview stores an ID but does not resolve or launch playback.
/// </summary>
public sealed class MediaLink
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string NodeId { get; set; } = string.Empty;
    public string JellyfinItemId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string ItemType { get; set; } = "Movie";
    public string ViewingOrder { get; set; } = "Custom";
    public int Position { get; set; }

    /// <summary>Full, Seasons or Episodes. Range entries reference an existing TV show and are metadata-only for now.</summary>
    public string RangeMode { get; set; } = "Full";
    public int StartSeason { get; set; }
    public int EndSeason { get; set; }
    public int StartEpisode { get; set; }
    public int EndEpisode { get; set; }
}
