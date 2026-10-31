# Franchise Explorer v0.8.9.7 — Visual polish (experimental)

Back up Jellyfin, the plugin-owned JSON configuration, and uploaded artwork before upgrading.

## What's different

1. The **My Media → Franchises** tile now shows **Franchises** in the middle, with gentle blur and dimming to make the text clear over its cinematic artwork.
2. The root **Franchise Explorer** browser no longer shows a redundant **Groups and subgroups** header, franchise-card type badges, or its version/disclaimer footer. Subgroup type badges (for phases/eras) remain.
3. Each franchise poster caption shows **TV Shows X · Movies Y** instead of a generic linked-item total. Nested groups and manually configured row items are included, with duplicates counted once by Jellyfin item ID. Jellyfin collections are excluded from the movie/show counts.
4. Opening a franchise defaults the sort menu to **Your order**, respecting the configured row and item order. **A to Z** remains available as a deliberate choice.
5. Clicking the top-left **F** logo or **Franchise Explorer** title returns to **Your franchises**. The clickable target includes a little padding and works with keyboard navigation.

## Upgrade

1. Install the compiled **v0.8.9.7** plugin package from GitHub Releases when available, and restart Jellyfin.
2. Confirm JavaScript Injector shows `jellyfin-franchise-explorer-my-media-v0897`. The plugin retires its own older script IDs after successful new registration.
3. Hard-refresh Jellyfin Web with **Ctrl+Shift+R**; in Developer Tools `window.__franchiseExplorerUiVersion` should report `0.8.9.7`.
4. Browse your franchises and verify artwork, movie/show counts, and manual sort order.

All operations remain virtual. No Jellyfin media files, watched flags, or existing franchise definitions are moved or altered by these display changes. Live host and native-client verification is still required.
