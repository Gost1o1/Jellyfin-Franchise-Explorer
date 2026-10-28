# Franchise Explorer v0.8.0.0 — Chronological Playback Preview

> **UNFINISHED EXPERIMENTAL PROJECT — USE WITH EXTREME CAUTION.**
>
> This version has not been validated on a real Jellyfin 12.2 server. Back up the Jellyfin service configuration, the Franchise Explorer JSON export, and the plugin data directory (including uploaded artwork and `timeline-progress`) before installing or testing.

## Features

- **Chronological playback** of a saved Timeline row. A row combines movies, entire TV shows, season ranges, episode ranges, and referenced Jellyfin collections. Its **saved manual ordering is authoritative**.
- Episode ranges resolve through each viewer's Jellyfin library API into real episode IDs and are displayed in an episode-by-episode queue preview. Missing access, empty ranges and some episode gaps produce warnings.
- **Play from beginning**, **Resume timeline**, **Replay only**, and **Restart timeline here** from a timeline's playback dialog.
- Per-user chronological progress stored in the plugin's private `timeline-progress/<user>/<row>.json` files, not Jellyfin's regular watched-history records. Each saved row has its own independent cursor and completed-item list.
- Server-side `PlaybackStart`, `PlaybackProgress` and `PlaybackStopped` event listeners update the timeline when a matching item is watched in the **same Jellyfin session that started the timeline**, even when the browser tab has been closed.
- Optional JavaScript Injector home integration provides **Continue Your Franchises** with a resume link in Jellyfin Web. If only one controllable playback session is present, clicking that link can resume immediately; with more than one, use the device picker.
- Progress bars on chronological rows, on matching movie or TV show cards, and in the detailed episode queue.
- All prior groups, custom rows, sorting, artworks, and plugin settings remain unchanged.

## Setting up a timeline

1. In the admin configuration, choose **Marvel Cinematic Universe** or another franchise.
2. Create or edit a custom row with content type **Chronological or custom viewing order**.
3. Search the full Jellyfin library, adding existing movies, TV shows and collection references as needed. For a TV show choose **Entire TV Show**, **Season to Season**, or **Season/Episode to Season/Episode**. Set the row's item order and **Save plugin configuration**.
4. Visit **Franchises** and open the franchise. Find the chronological row and click **Play chronological order**.
5. Inspect the **full resolved list**. Confirm every film/episode is present and correctly ordered. Choose a Jellyfin device that permits remote control, then click **Play from beginning** or **Resume timeline**.
6. In the queue dialog, **Replay only** plays a single entry independently, while **Restart timeline here** asks for confirmation, resets subsequent completion *for this one timeline*, and queues the remaining items.

## Important limitations

- **Jellyfin client support is not uniform.** Remote `PlayNow`, `PlayLast`, and remote session control must be supported by the chosen player. Test short lists first. A queue longer than 60 items uses one `PlayNow` plus one or more `PlayLast` append commands. Some clients may reject or mishandle that sequence. Check playback order before relying on a multi-hundred-item Marvel timeline.
- This plugin **does not replace or intercept Jellyfin's built-in player**. Playback and transcoding are performed by Jellyfin. A movie/episode replay may still update native Jellyfin watched and resume data, although it will not deliberately rewind Franchise Explorer timeline state.
- Timeline state advances on **native playback events for the exact chosen session**. If an app fails to report completion, uses a different session ID after reconnecting, or skips items without completion events, its progress may need manual recovery. A dashboard card cannot be assumed to appear in every native client.
- A playlist's **repeated appearance of exactly the same media ID** is not perfectly distinguishable from another occurrence unless the client reports playlist position. Avoid deliberately duplicating the same episode in one timeline during this preview.
- Specials are excluded from **Entire TV Show** by default; you can explicitly reference season 0 episode ranges when present.
- When a media reference is removed or its season range changes, the timeline attempts to match current progress by item IDs. Review the order and progress after reorganizing a timeline.
- No native Roku, Android TV or Apple TV UI integration is bundled; the visual browser and dashboard widget target Jellyfin Web and compatible browsers, though Jellyfin session queues may be sent to other controllable clients.
- This is a preview; **the plugin has not yet been compiled or integration-tested against your live Jellyfin 12.2 instance**.

## Upgrade and release

1. Export Franchise Explorer's configuration JSON and back up its data folder (artwork and timeline-progress); back up Jellyfin itself.
2. Extract this ZIP into your existing [GitHub repository](https://github.com/Gost1o1/Jellyfin-Franchise-Explorer), **preserving the live `manifest.json`**. The ZIP omits it on purpose. Make sure `.github/workflows` is not nested twice.
3. Commit and push; check the **Build and validate** GitHub Actions workflow.
4. If green, manually run **Publish experimental release** with version `0.8.0.0` and confirmation `RELEASE_EXPERIMENTAL`. Do not rerun the same version after a successful release.
5. Confirm the new GitHub Release and Jellyfin catalog manifest; update through the normal Jellyfin plugin catalog; restart your Windows Jellyfin service.
6. Confirm the plugin configuration header shows **v0.8.0.0 preview** and verify the chronological row in the standalone Franchises browser.

### First live test — small non-destructive sequence

Create a temporary chronology row with **one short movie → two episodes → another movie**, then play via Jellyfin Web on your desktop. Verify that:

- The playback queue contains the exact chosen episodes and next title.
- Server-side state persists after closing the Franchises browser and restarting the Jellyfin service.
- Replay Only leaves the chronological cursor unchanged.
- Restart Timeline Here rewinds only this one timeline.
- **Continue Your Franchises** resumes correctly from Jellyfin Web Home if JavaScript Injector is installed.

If something fails, capture **Dashboard → Logs**, the screenshot/error from the Franchises dialog, and the relevant GitHub Actions log. Do not delete existing plugin data during diagnosis.

### v0.8.0.1 remote playback diagnostic

Jellyfin can acknowledge a Play Now command without the client actually starting playback. This update verifies the first Now Playing item before saving progress or appending the remaining timeline. A session reporting remote control disabled cannot be used for a chronological remote queue. If your Chrome web session is unavailable, try a Jellyfin client that supports casting/remote commands. The plugin does **not** automatically turn on remote playback in Chrome. Season `01` in a folder and numeric season `1` are equivalent for range matching because Jellyfin metadata is used.

### v0.8.1.0 Jellyfin Web item cards

Clicking a media card requests native Jellyfin Web playback via the optional JavaScript Injector integration. The adjacent ⓘ button opens details. On clients without the companion, clicking a card falls back to Jellyfin details rather than pretending playback started. For a TV show, this first version plays the first regular episode inside the chosen range; it is not a new full-timeline queue.

The Franchise Explorer subtitle toggle is **off by default** in each browser for each signed-in Jellyfin user. Playback uses the native Jellyfin player; that player may apply subtitle preferences or unsupported subtitle formats, so the toggle is a best-effort request rather than guaranteed global enforcement.

Rows now append media cards in deterministic saved order, independent of API response timing. Returning from the information page restores the group and scroll position.
