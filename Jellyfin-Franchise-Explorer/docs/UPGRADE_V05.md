# Upgrade v0.4 → v0.5

1. Back up Jellyfin's plugin configuration and the plugin-owned image files (the exported JSON file does not contain uploaded image bytes).
2. Copy the extracted repository ZIP contents over your existing GitHub working tree; **keep the currently published `manifest.json` if it is newer than the packaged one**.
3. Push and verify the Actions build workflow passes.
4. Manually publish v0.5.0.0 with `RELEASE_EXPERIMENTAL`, then verify the release ZIP and manifest.
5. Update Franchise Explorer through Jellyfin's catalog, restart the Windows service, and confirm v0.4 virtual groups remain.
6. Artwork should now be inherited when no override exists. For example: select Marvel → connect a saved BoxSet, then view inherited poster/logo/backdrop. Custom uploaded images always win.
7. Click Import collection members to add the current members as virtual references. They will not be copied or moved. Save the plugin configuration and refresh.

These are experimental operations. Collection imports are snapshots and do not recursively import nested collections or add unrelated unassigned titles. No native Jellyfin navigation category yet.
