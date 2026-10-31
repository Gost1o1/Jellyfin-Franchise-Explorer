# Franchise Explorer v0.8.9.14 — Homepage progress and confirmation buttons

This is an experimental source release for Jellyfin 12.2. Build and publish a compiled plugin through the **Publish experimental release** GitHub Actions workflow; do not install this source ZIP as a Jellyfin plugin.

## Changes since v0.8.9.13

- The **Continue Your Franchises** card now shows the current movie or episode's playback position above the overall chronological progress bar.
- While the current entry is part of a multi-episode TV range, a middle progress bar shows the number of **completed episodes in that configured range**. It is hidden for movies and single-episode entries. Consecutive ranges of the same series are kept separate by their reference IDs.
- Tracking-choice confirmation buttons match the centered reset dialog: a dark, rounded Cancel button and a teal, rounded primary action. The dialog remains centered.
- The My Media integration uses a fresh JavaScript Injector script ID, `jellyfin-franchise-explorer-my-media-v08914`, and retires the previous `v08913` script **only after** successful registration. Franchise watch state, original artwork and media files are not changed.
- Version metadata, the release workflow default and offline tests have been updated to `0.8.9.14`. Existing GitHub releases must never be overwritten.

## Upgrade and verify

1. Back up Jellyfin and the Franchise Explorer configuration. In GitHub Actions, publish **version `0.8.9.14`** with the required experimental-release confirmation, provided that tag is not already published.
2. Install the compiled plugin update, restart the Jellyfin service and hard-refresh the Jellyfin Web client.
3. In JavaScript Injector, confirm **only** the `v08914` Franchise Explorer My Media script is enabled. If duplicates remain, verify the new entry is installed before disabling older, manually injected copies.
4. On Jellyfin Home, confirm that a movie shows **Movie progress → Chronological progress**, while a multi-episode TV segment shows **Episode progress → TV segment episodes watched → Chronological progress**.
5. Verify that moving from Agent Carter S1 to S2 uses the new segment's episode total, not the whole series. Movies and single-episode references must not show the segment bar.
6. Open **Select from chronological list** and confirm the **Watch and track** confirmation uses the rounded dark/teal buttons. Confirm the popup closes correctly after Cancel or acceptance.

The offline tests validate the calculations, button styling and version identifiers. Live Jellyfin playback and JS Injector behavior require host testing.
