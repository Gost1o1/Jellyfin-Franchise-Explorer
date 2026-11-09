namespace Jellyfin.Plugin.FranchiseExplorer.Services;

/// <summary>Serializes plugin configuration writes; network and library work stays outside this gate.</summary>
public static class FranchiseConfigurationGate
{
    public static SemaphoreSlim Gate { get; } = new(1, 1);
}
