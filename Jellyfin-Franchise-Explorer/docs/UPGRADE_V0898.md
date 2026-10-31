# Franchise Explorer v0.8.9.8 — Release version alignment (experimental)

This release carries the existing v0.8.9.7 UI and chronological-playback quality-of-life work forward under the new `0.8.9.8` assembly version.

## What's included

- Continue Your Franchises resume cards have a three-dot menu to reset the selected chronological history, restart the current item, or select another item to watch with or without Franchise Explorer progress tracking.
- Editor rows with more than eight listed items start collapsed; the arrow shows or hides the complete editable list without changing its order.
- GitHub Actions use Node.js 24-compatible actions with a fixed Ubuntu 24.04 runner.
- JavaScript Injector registers the new plugin-owned ID `jellyfin-franchise-explorer-my-media-v0898` and retires the previous v0897 ID after successful registration.
- The manual release workflow checks the requested version before running browser tests, avoiding wasted build time on mismatches.

## Publish and verify

1. Commit the complete source update, including `.github/workflows`, the `.csproj`, scripts, and web resources. A source ZIP is not itself an installable Jellyfin plugin.
2. Run the Build and validate workflow and confirm it passes.
3. Run the manual release workflow with **version `0.8.9.8`** and the existing `RELEASE_EXPERIMENTAL` confirmation. Do not publish over an existing tag; choose a new version if that release already exists.
4. Install the compiled release through Jellyfin's plugin catalog when the manifest refreshes and restart the Jellyfin service.
5. In JavaScript Injector, verify one enabled Franchise Explorer entry with the v0898 ID. Hard-refresh Jellyfin Web with **Ctrl+Shift+R**, and verify `window.__franchiseExplorerUiVersion` returns `0.8.9.8`.

Franchise timeline progress remains separate from Jellyfin's native watched status. Independent one-off playback does not advance Franchise Explorer's timeline, but Jellyfin may still track its own watched/resume history. Test the playback changes on your actual Jellyfin clients before relying on them.
