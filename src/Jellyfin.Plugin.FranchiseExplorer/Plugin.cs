using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;

namespace Jellyfin.Plugin.FranchiseExplorer;

/// <summary>Franchise Explorer plugin entry point.</summary>
public sealed class Plugin : BasePlugin<PluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Franchise Explorer";

    public override Guid Id => Guid.Parse("6bc7820b-7c6d-4e64-a139-dfb90b8d6f42");

    public override string Description => "Virtual franchise hierarchy for existing Jellyfin media (development preview).";
}
