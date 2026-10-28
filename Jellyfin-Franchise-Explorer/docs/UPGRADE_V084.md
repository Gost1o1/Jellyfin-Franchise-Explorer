# v0.8.4.0 experimental upgrade

1. Export your Franchise Explorer JSON and back up the plugin data directory (artwork and timeline-progress) and Jellyfin configuration.
2. Extract the complete ZIP into the existing GitHub repository. Do not overwrite the currently published `manifest.json` — not included.
3. Commit and push; confirm Build and validate passes.
4. Run Publish experimental release with version `0.8.4.0` and confirmation `RELEASE_EXPERIMENTAL` **only once**.
5. Update the installed plugin from Jellyfin, restart the Windows service and hard-refresh Jellyfin Web to refresh the JavaScript Injector script.

## Verify
Use a short chronological row with a short movie or episode followed by a different show episode. Choose **This browser (local playback)**. Watch the first item actually finish (not stop manually). The completion marker is generated on Jellyfin PlaybackStopped or the verified browser video `ended` event. Auto-next should use the second item's real Jellyfin ID. No timeline progress should change on ordinary replay or manual stop. The My Media Franchises tile should match nearby library cards in width and artwork height. These are acceptance criteria, not live-tested guarantees.

Native Android/Roku playback queues are not controlled by the optional Jellyfin Web bridge. Browser video `ended` only operates where the Jellyfin Web client exposes an HTML5 player; clients that don't expose it rely on server completion events.
