using System;

namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// Virtual reference to a Jellyfin item. No media is moved, copied, or deleted.
/// This preview stores an ID but does not resolve or launch playback.
/// </summary>
public sealed class MediaLink
{
    public string Id { get; set; } = Guid.NewGuid().ToString("D");
    public string NodeId { get; set; } = string.Empty;
    public string JellyfinItemId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string ItemType { get; set; } = "Movie";
    public string ViewingOrder { get; set; } = "Custom";
    public int Position { get; set; }
}
