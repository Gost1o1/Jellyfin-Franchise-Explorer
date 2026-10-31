# Franchise Explorer v0.8.9.13 — Return to last page and native-row visibility

This ZIP contains source code and GitHub workflows, not a compiled Jellyfin plugin. Publish the compiled release through GitHub Actions, install it in Jellyfin, then restart the Windows Jellyfin service and hard-refresh Jellyfin Web.

## Changes

- **Hide franchise titles:** When the per-user, per-browser toggle is checked, hide the episodes and movies referenced by active franchise chronological watch orders from native Jellyfin **Continue Watching** and **Next Up**. The previous implementation hid only the title at the current timeline cursor. After resetting an MCU timeline to Captain America, prior episodes of Agent Carter could reappear. The new implementation uses the saved queue's item IDs and original TV show IDs, while leaving unrelated titles visible. The setting is still display-only: Jellyfin watched/resume data remains untouched.
- **Return after playback:** On a local franchise playback request, remember the current page in same-tab session storage. If Jellyfin Web returns to the just-played item's Details route after you close its player, return to the originating Home or Franchise Explorer page. Only a recent playback that actually reached a local video `playing` event can trigger this restoration. A deliberately selected Details view is exempt.
- **Details menu action:** The three-dot menu on each Continue Your Franchises card now includes **Details** for the currently selected movie or episode. This opens the normal Jellyfin item-details view, without autoplay.
- **Version migration:** Uses JavaScript Injector script ID `jellyfin-franchise-explorer-my-media-v08913`. Attempts to retire only the plugin's older script IDs after successful registration. If your Injector dashboard has duplicate enabled Franchise Explorer scripts, verify v08913 is installed before disabling older ones.

## Test on your Jellyfin server

1. Confirm the installed DLL and JavaScript Injector both show **0.8.9.13**. In browser DevTools, `window.__franchiseAutoplayBridgeVersion` and `window.FranchiseExplorerNativePlayback?.version` should report `0.8.9.13`.
2. Turn **Hide franchise titles from Continue Watching and Next Up** on (checked) and reset your MCU chronological timeline using the three dots.
3. Confirm previous MCU titles such as Agent Carter are absent from native Continue Watching, while unrelated Firefly entries remain. The **Continue Your Franchises** card should still show the first MCU title.
4. Start a video from the Continue Your Franchises card, then close/back out of the Jellyfin video player. It should return to Jellyfin Home rather than leaving you on Details.
5. Start a video from within the separate Franchises browser, then leave the player. You should return to that Franchises page.
6. Use **Details** from the Home card's three-dot menu and confirm it opens the current movie/episode information screen **without** automatically starting playback.
7. Toggle hiding **off** (unchecked) and verify native Continue Watching/Next Up resume normal visibility.

Offline contracts check the routing, target collection, and menu action. Live Jellyfin Web/JS Injector integration still needs confirmation because other themes and player clients can use different route transitions. On clients that don't return to a `#/details?id=...` route after closing playback, Jellyfin's existing Back behavior is left unchanged.
