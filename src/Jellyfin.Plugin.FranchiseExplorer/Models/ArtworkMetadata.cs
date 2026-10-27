namespace Jellyfin.Plugin.FranchiseExplorer.Models;

/// <summary>
/// Descriptive references only. Uploaded image references point to protected plugin-owned image endpoints.
/// Simple properties are compatible with Jellyfin's XML configuration serializer.
/// </summary>
public sealed class ArtworkMetadata
{
    public string PrimaryUrl { get; set; } = string.Empty;
    public string BackdropUrl { get; set; } = string.Empty;
    public string LogoUrl { get; set; } = string.Empty;
    public string ThumbUrl { get; set; } = string.Empty;
    public string BannerUrl { get; set; } = string.Empty;
}
