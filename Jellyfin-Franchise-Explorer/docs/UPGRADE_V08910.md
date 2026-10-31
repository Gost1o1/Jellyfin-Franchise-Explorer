# Franchise Explorer v0.8.9.10 — Home-page popup and reset confirmation

This update adjusts the three-dot menu on the **Continue Your Franchises** card to match the requested Jellyfin Home design.

- **Select from chronological list:** Remain on Jellyfin Home and show the complete scrollable **Chronological Order** popup centered over the dimmed homepage. It retains the native playback device selector, current progress, and a **Watch…** button for every chronological entry. Selecting one asks whether to watch independently or track it in the franchise timeline. Selecting playback may subsequently open Jellyfin's native player.
- **Restart chronological history:** Show a smaller centered confirmation saying exactly **Are you sure you want to reset [franchise name] chronological timeline?** with **Cancel** and **Reset timeline**. Reset only after confirmation. The page stays on Home and the card refreshes. This never clears Jellyfin watched flags.
- **Restart current viewing:** Keep v0.8.9.9 behavior: launch the active title at 0:00 using Jellyfin's native player while preserving completed franchise entries.
- **Old Injector scripts:** v0.8.9.10 uses a version-specific home initialization guard and intercepts old `Browse?timeline=…&action=…` links where possible. The plugin registers its new `jellyfin-franchise-explorer-my-media-v08910` ID and retires old plugin-owned registrations after success. **Disable duplicate manually pasted scripts** and hard-refresh so the current version is the one actively running.

## Install / verify

1. Back up your plugin configuration and custom artwork.
2. Upload this **source** to GitHub, build/publish the **compiled** plugin release through GitHub Actions and install that release through Jellyfin's plugin repository. Source ZIP files are not installable Jellyfin plugins.
3. Restart Jellyfin and hard-refresh Jellyfin Web (`Ctrl+Shift+R`). Confirm the new script ID in JavaScript Injector and run `window.__franchiseExplorerUiVersion` in browser DevTools; it should print `0.8.9.10`.
4. Open Home → Continue Your Franchises → three dots. Select from the chronological list, verify the popup stays over Home, and try both Cancel and Reset on a disposable test franchise first. Test local playback separately on your server.

## Testing scope

Offline tests exercise the homepage action routing, history preservation, centered confirmation markup and stale-menu link handling. The actual 422-entry list and native Jellyfin playback still require a live Jellyfin Web check.
