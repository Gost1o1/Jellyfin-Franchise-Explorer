# v0.8.3.0 — Mobile and playback verification hotfix

This experimental source update is built on the complete v0.8.2 package. No media files, Jellyfin collections, or uploaded franchise artwork are modified by the update.

## Upgrade

1. Back up the Franchise Explorer JSON, artwork, and Jellyfin configuration.
2. Copy the entire extracted repository ZIP into your existing GitHub project. Keep your existing `manifest.json` (not included in this ZIP).
3. Run GitHub **Build and validate** before publishing. Publish experimental release with version `0.8.3.0` and confirmation `RELEASE_EXPERIMENTAL`, only once.
4. Update the plugin through Jellyfin, restart its Windows service, and hard-refresh Jellyfin Web / reload Android WebView.

## Test

- My Media: the Franchises card should have the same width as neighboring cards on phone and desktop.
- Admin: open a long TV show range within a row. Its name should wrap across readable lines; controls should appear below it on narrow layouts.
- Browser: My Media → Franchises → Marvel → a short three-entry timeline. Choose **This browser (local playback)**.
- Confirm real visible playback, not just a session record on Jellyfin Dashboard. If no local playback occurs, the plugin should not mark timeline history as started.
- A native Android player may not provide a DOM `<video>` element. In that case the plugin verifies that the matching **same-device** session is actively advancing, when its DeviceId is available. If neither condition is observable, it does not mark progress.

## Limitations

- The plugin does not yet force local playback on native Android TV or Roku clients.
- In-client video controls, subtitles and long playlists are client-dependent and remain experimental.
- The playback detector is intentionally conservative to avoid false progress.
