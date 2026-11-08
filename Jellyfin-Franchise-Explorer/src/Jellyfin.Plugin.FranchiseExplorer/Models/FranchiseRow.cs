using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// Optional presentation-only carousel row beneath a virtual franchise or subgroup.
/// Removing a row does not delete any media links, groups, files or collection artwork.
/// NodeIds and MediaLinkIds are references, never ownership relationships.
/// </summary>
public sealed class FranchiseRow
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string ParentNodeId { get; set; } = string.Empty;
    public string Name { get; set; } = "Custom Row";
    public string RowType { get; set; } = "Groups";
    /// <summary>Settings category independent of the legacy shelf renderer type.</summary>
    public string Category { get; set; } = string.Empty;
    /// <summary>Optional IMDb list override for this row.</summary>
    public string SourceUrl { get; set; } = string.Empty;
    public List<FranchiseSource> AutoAddSources { get; set; } = new();
    /// <summary>Chronological Auto Add format override. Empty inherits the owning franchise or subgroup.</summary>
    public string EpisodeFormat { get; set; } = string.Empty;
    public ArtworkMetadata Artwork { get; set; } = new();
    public int SortOrder { get; set; }
    public List<string> NodeIds { get; set; } = new();
    public List<string> MediaLinkIds { get; set; } = new();

    // Media added directly from Jellyfin's whole library. Independent of
    // franchise MediaLinks; removing a row doesn't modify a library or group.
    public List<FranchiseRowEntry> Items { get; set; } = new();

    // Presentation order across older MediaLinkIds AND new independent Items.
    public List<string> MediaOrder { get; set; } = new();
}
