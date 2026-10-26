using System;
using System.Collections.Generic;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.FranchiseExplorer;

/// <summary>
/// Early-development plugin: all content edits are limited to plugin configuration.
/// </summary>
public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static readonly Guid PluginId = Guid.Parse("6bc7820b-7c6d-4e64-a139-dfb90b8d6f42");

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Franchise Explorer";

    public override Guid Id => PluginId;

    public override string Description =>
        "Experimental virtual franchise organizer (configuration-only preview).";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = typeof(Plugin).Namespace + ".Configuration.configPage.html"
            }
        };
    }
}
