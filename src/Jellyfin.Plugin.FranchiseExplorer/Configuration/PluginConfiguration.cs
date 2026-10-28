using System.Collections.Generic;
using Jellyfin.Plugin.FranchiseExplorer.Models;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.FranchiseExplorer.Configuration;

/// <summary>
/// Small-scale preview storage. No library paths, media files, or native collections are modified.
/// Data may later migrate to a plugin-owned data store; export backups before upgrading.
/// </summary>
public sealed class PluginConfiguration : BasePluginConfiguration
{
    public string NavigationLabel { get; set; } = "Franchises";

    public List<FranchiseNode> Nodes { get; set; } = new();

    public List<MediaLink> MediaLinks { get; set; } = new();

    // Presentation-only horizontal shelves. Existing v0.7.2 XML loads with an empty list.
    public List<FranchiseRow> Rows { get; set; } = new();
}
