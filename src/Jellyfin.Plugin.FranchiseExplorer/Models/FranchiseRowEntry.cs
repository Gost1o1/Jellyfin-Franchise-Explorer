using System;

namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// Virtual reference owned by a presentation row, not by Jellyfin collections.
/// One BoxSet, Movie, or TV Show; Series ranges are descriptive metadata only.
/// </summary>
public sealed class FranchiseRowEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string JellyfinItemId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string ItemType { get; set; } = "Movie";
    public string RangeMode { get; set; } = "Full";
    public int StartSeason { get; set; }
    public int EndSeason { get; set; }
    public int StartEpisode { get; set; }
    public int EndEpisode { get; set; }
}
