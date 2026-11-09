using System;
using System.Collections.Generic;
using System.IO;
using Jellyfin.Plugin.FranchiseExplorer.Configuration;
using Jellyfin.Plugin.FranchiseExplorer.Services;
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
        "Experimental virtual franchises, timeline queue preview, and independent per-user viewing progress.";

    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        FranchiseConfigurationGate.Gate.Wait();
        try
        {
            CommitConfigurationUnderGate((PluginConfiguration)configuration);
        }
        finally
        {
            FranchiseConfigurationGate.Gate.Release();
        }
    }

    /// <summary>Caller owns the shared gate; optimistic revision protects native settings writes too.</summary>
    public void CommitConfigurationUnderGate(PluginConfiguration configuration)
    {
        if (configuration.ConfigurationRevision != Configuration.ConfigurationRevision)
            throw new InvalidOperationException("The configuration changed on the server. Reload before saving your edits.");
        var previous = Configuration;
        var previousRevision = previous.ConfigurationRevision;
        var path = ConfigurationFilePath;
        var original = File.Exists(path) ? File.ReadAllBytes(path) : null;
        configuration.ConfigurationRevision = checked(previous.ConfigurationRevision + 1);
        try
        {
            base.UpdateConfiguration(configuration);
        }
        catch
        {
            configuration.ConfigurationRevision = previousRevision;
            Configuration = previous;
            if (original is null)
            {
                if (File.Exists(path)) File.Delete(path);
            }
            else
            {
                var backup = path + ".rollback-" + Guid.NewGuid().ToString("N");
                try
                {
                    File.WriteAllBytes(backup, original);
                    File.Move(backup, path, overwrite: true);
                }
                finally
                {
                    if (File.Exists(backup)) File.Delete(backup);
                }
            }
            throw;
        }
    }

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
