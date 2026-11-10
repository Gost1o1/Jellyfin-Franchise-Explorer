namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>Snapshot capture and verified automatic reconnection are enabled on upgrade; explicit repair can use available media.</summary>
public sealed class MediaRecoverySettings
{
    public bool Enabled { get; set; } = true;
    public bool AutoReconnect { get; set; } = true;
    public List<MediaIdentitySnapshot> KnownItems { get; set; } = new();
}
