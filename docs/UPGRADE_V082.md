# v0.8.2.0 — Experimental local playback hotfix

## Why this exists
Jellyfin Web (Chrome) may acknowledge a remote `POST /Sessions/{session}/Playing?playCommand=PlayNow` with HTTP 204, but never start playing. That response only means the server accepted the command, not that the selected Web client played anything.

## What changed
- **This browser (local playback — recommended)** is the default choice in the chronological playback dialog.
- The local path opens the normal Jellyfin Web details/player route with a one-time autoplay marker. The optional JavaScript Injector bridge clicks Jellyfin's native Play button, waits for the expected movie/episode to become the real active item in a Web session, and **only then** writes timeline progress.
- If no matching playback is confirmed, chronological history remains untouched. If your Web client's Play control is different, press the normal Play button manually on that title; the bridge will try to recognize the resulting playback.
- The optional web bridge attempts to open the next title after confirmed completion. This is **experimental**, requires the same browser tab to remain open, and may not work across all Jellyfin versions or clients. Native TV apps still require client-specific support.
- Remote-device PlayNow remains available but is not the default.

## Upgrade
1. Export your existing configuration JSON; back up your Jellyfin configuration and Franchise Explorer plugin data folder (including progress and uploaded artwork).
2. Extract the ZIP over the root of your existing GitHub repository. **Do not replace your live manifest.json.** This upgrade package deliberately excludes it.
3. Commit and push. Confirm Build and validate succeeds.
4. Manually publish version **0.8.2.0** with `RELEASE_EXPERIMENTAL` only once, after build success.
5. Check GitHub Releases and the updated plugin catalog. Upgrade in Jellyfin and restart the Windows service. Clear cache/hard-refresh the web client to ensure JavaScript Injector loads the new embedded script.

## First live test (don't start with 422 items)
1. Create a temporary chronological row containing **one short movie, one TV episode, and another movie** (or use three short episodes).
2. Click Play chronological order and choose **This browser (local playback — recommended)**, then Play from beginning.
3. Confirm Jellyfin Web starts the correct first item. If it opens the details page without starting, click native Play and see whether the timeline activates.
4. After finishing the first item, check whether the next item starts automatically. If not, report the exact browser URL, whether the player appears, and whether the next item changed in the timeline state; don't assume queue support.
5. Verify Replay only never rewinds timeline progress. Verify browser refresh/resume separately.

## Known limits
- Native Jellyfin clients (Roku, Android TV, etc.) do not support this web-only handoff automatically.
- Autoplay and sequential transitions depend on Jellyfin Web DOM behavior and the installed JavaScript Injector plugin. They are **not proven by offline simulated browser tests**.
- A success response from the remote Sessions API is not sufficient evidence of playback. Chronological history intentionally remains unmodified if playback is not observed.
- Without a reliable way to bind Web sessions to this exact browser's device ID, simultaneous Web sessions playing the **same item** under the same Jellyfin account could be ambiguous. The bridge requires exactly one matching Web session and refuses to save progress if multiple matches are found.
- The plugin does not alter media file names, folder names, original collections, or global Jellyfin subtitle preferences.
