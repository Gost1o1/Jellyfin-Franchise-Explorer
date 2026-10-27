# Upgrade v0.5 → v0.6 (experimental)

1. Export a JSON backup from Franchise Explorer v0.5. Also back up Jellyfin configuration and plugin-owned artwork before updating.
2. Copy the v0.6 source and workflows over the existing checkout. **Keep the current `manifest.json` on GitHub** if it has newer published releases than the source ZIP. Do not duplicate `.github/workflows`.
3. Commit and push, then inspect **Build and validate**. A green build confirms compilation only, not compatibility with the Windows Jellyfin service.
4. Manually run the experimental release workflow using version `0.6.0.0` and `RELEASE_EXPERIMENTAL`. Verify the release assets and updated manifest, then upgrade via the Jellyfin catalog and restart the Windows service.
5. Select Phase Three; confirm its custom artwork belongs to Phase Three, not the MCU parent. Adding a movie should not remove a custom thumbnail. If anything changes unexpectedly, export a backup and stop before saving.
6. Drag/reorder a group. Check hierarchy and sort positions after saving and refreshing.
7. Search for a TV Show, click **+ Season/episode range**, and verify season-only or episode-boundary range metadata survives saving and refreshing.

TV Show ranges are metadata definitions and **do not yet provide continuous playback or episode-existence validation**. The plugin never moves or renames media files.
