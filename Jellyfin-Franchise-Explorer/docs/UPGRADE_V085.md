# Franchise Explorer v0.8.5.0 — Experimental Upgrade

Back up the existing Jellyfin configuration, Franchise Explorer JSON, uploaded artwork and timeline-progress folder.

This ZIP is a full repository upgrade, **excluding manifest.json**, which your GitHub publish workflow generates after the plugin assembly builds successfully.

Commit and push; verify Build and validate. Manually publish **0.8.5.0** once using confirmation `RELEASE_EXPERIMENTAL`. Refresh the Jellyfin plugin catalog and restart the Jellyfin Windows service. Hard-refresh Jellyfin Web and the Android WebView.

## Tests
1. Compare Franchises tile with Collections and Movies on desktop and Android WebView. It now clones the real native library card rather than approximating dimensions.
2. Start a short chronological row with Movie → TV Episode → Movie. Watch naturally to the end to test automatic advancing.
3. Confirm progress advances while playing (a single item in a 422-item timeline is only ~0.24%, so small percentages now show decimals); check Watched appears only when the title/selected episodes are completed in that timeline.
4. Stop manually mid-title: it must **not** auto-advance. Replay Only must not reset timeline progress.
5. Check both the Jellyfin Web browser console (filter for “Franchise Explorer”) and server logs if progress or auto-next does not advance.

## Limits
Jellyfin Web client playback event handling is not guaranteed to work across every client. If Jellyfin reports a stopped event without `PlayedToCompletion` and the player suppresses the HTML5 `ended` event, no automatic transition is triggered, deliberately avoiding a false completion when the user manually stops. This is **not** verified in your live Jellyfin 12.2 instance yet.
