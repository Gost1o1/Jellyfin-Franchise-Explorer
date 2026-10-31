# Franchise Explorer v0.8.9.9 — Home-page chronological controls (experimental)

The **Continue Your Franchises** three-dot menu now handles its actions on the same Jellyfin Home page.

- **Restart chronological history:** After a confirmation, clear this user's saved progress and return the timeline to its first item. The card refreshes on Home. No video automatically starts and no browse modal opens. Jellyfin watched flags are unaffected.
- **Restart current viewing:** Launch the active movie/episode directly using Jellyfin's normal browser player, with the franchise timeline position set to 0:00. Preserve earlier completed franchise entries. A native-player start-over seek also counters Jellyfin's usual resume behavior; verify on your Jellyfin Web version.
- **Select from chronological list:** Open the same chronological entry picker as in Franchise Explorer **over Home**, without a redirect. Choose a Jellyfin device and then **Watch only · No franchise tracking** or **Watch and track from here**. One-off viewing can still affect Jellyfin's own watched history.

The server bundles its existing `franchise-timeline.js` playback engine before `franchise-my-media.js` as one JavaScript Injector registration. This avoids diverging playback implementations. It also supplies the list's styling on Jellyfin Home. An expired or missing chronology queue produces a visible error rather than altering an unrelated timeline.

## Update

1. Back up plugin configuration and artwork. This code never changes the original linked media.
2. Install the **compiled** `v0.8.9.9` release artifact when its GitHub Actions publication succeeds. Do not install the source ZIP as a Jellyfin plugin.
3. Restart the Jellyfin service; confirm **JavaScript Injector → Plugin Scripts** shows `jellyfin-franchise-explorer-my-media-v0899`. The plugin removes its older registered ID after successful registration.
4. Hard-refresh Jellyfin Web. Verify `window.__franchiseExplorerUiVersion` returns `0.8.9.9` in DevTools, then test all three homepage menu actions on a **disposable test franchise** before resetting a long-running watch history.

## Verification limits

Offline contract checks verify action routing, preserved franchise progress, and the local player handoff. Test the actual 422-item list, local seeking to 0:00, real Jellyfin playback, and all target clients on your Jellyfin server. Native Jellyfin TV clients cannot use JavaScript Injector browser overlays.
