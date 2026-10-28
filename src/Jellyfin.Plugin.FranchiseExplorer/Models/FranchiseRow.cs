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
    public int SortOrder { get; set; }
    public List<string> NodeIds { get; set; } = new();
    public List<string> MediaLinkIds { get; set; } = new();
}
