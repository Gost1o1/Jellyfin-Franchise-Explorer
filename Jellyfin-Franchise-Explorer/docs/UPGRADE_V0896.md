# Franchise Explorer v0.8.9.6 — Quality-of-life update (experimental)

> Back up Jellyfin, your plugin-owned JSON configuration, and uploaded franchise artwork before updating. This is not a production-stable release.

## Changes

- The **Continue Your Franchises** desktop/landscape card now displays the complete landscape image with a soft blurred fill behind it. Portrait artwork behavior on vertically held phones remains unchanged.
- The **My Media → Franchises** card includes embedded cinematic ensemble artwork rather than the plain teal F tile. It uses an optimized, bundled WebP image; no third-party image host is necessary.
- The Franchises root browser now opens directly to your franchise posters. The large artwork hero still appears when viewing an individual franchise. The header is named **Franchise Explorer**.
- The subtitle and **Hide active franchise titles from Continue Watching and Next Up** switches have moved to the administrator's plugin settings panel. Existing per-browser user choices are retained. **ON hides / OFF shows** the native row items; this does not change watched history.
- The separate **Linked Jellyfin media** search and manual ID section is hidden from the editor. All saved links are preserved; use **Browse rows** to search for and arrange media, including TV range selection.
- The **Existing Jellyfin collection** controls and artwork editor remain available.
- **Save plugin configuration** and its unsaved-changes indicator appear at the top. The visible actions are **+ New franchise**, **+ Subgroup**, **Open Franchises browser**, **Export backup**, **Import backup**, **Discard edits**, in that order.
- Removes the **Early development** eyebrow and hides obsolete same-level, demo, and future navigation-label controls without changing the existing saved data format.

## Upgrade

1. Export the current plugin configuration and separately back up any uploaded artwork.
2. Install the compiled **v0.8.9.6** plugin when its GitHub release is available; restart Jellyfin.
3. In JavaScript Injector, verify the single enabled plugin-owned script ID is `jellyfin-franchise-explorer-my-media-v0896`. The plugin registers this ID and retires only its older script IDs after registration succeeds.
4. Hard-refresh Jellyfin Web with **Ctrl+Shift+R**. Verify `window.__franchiseExplorerUiVersion` reports `0.8.9.6`.
5. Open **Dashboard → Plugins → Franchise Explorer** for playback/home switches and your existing virtual franchise configuration.

## Scope

- Changes are to the Jellyfin Web/editor display and plugin-injected UI, not media files.
- Playback handoff, native clients, and a live Jellyfin server installation still require validation.
- A source-code ZIP from GitHub is not a compiled Jellyfin plugin. Use the release artifact built by Actions.
