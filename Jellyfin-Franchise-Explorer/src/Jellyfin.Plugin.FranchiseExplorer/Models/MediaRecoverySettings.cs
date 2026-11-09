namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Passive snapshot capture is enabled on upgrade; repair requires a healthy library.</summary>
public sealed class MediaRecoverySettings
{
    public bool Enabled { get; set; } = true;
    public bool AutoReconnect { get; set; } = true;
    public List<MediaIdentitySnapshot> KnownItems { get; set; } = new();
}
