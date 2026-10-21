using MediaBrowser.Model.Plugins;
using Jellyfin.Plugin.FranchiseExplorer.Models;

namespace Jellyfin.Plugin.FranchiseExplorer.Configuration;

/// <summary>Plugin-owned configuration; never modifies Jellyfin media paths.</summary>
public sealed class PluginConfiguration : BasePluginConfiguration
{
    public string NavigationLabel { get; set; } = "Franchises";
    public List<FranchiseNode> Nodes { get; set; } = new();
    public List<MediaReference> MediaReferences { get; set; } = new();
}
