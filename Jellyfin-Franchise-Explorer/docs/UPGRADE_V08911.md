# Franchise Explorer v0.8.9.11 — Direct Jellyfin playback and restart-at-zero

This is a source release. Use the GitHub Actions release workflow to build a compatible plugin DLL and publish the release archive before updating Jellyfin. Uploading this ZIP alone does not install the plugin.

## Updated behavior

- **Restart chronological history:** The Home card opens a centered, in-page confirmation: "Are you sure you want to reset [franchise] chronological timeline?" Accepting resets that user's timeline in place, with no playback or browsing redirect.
- **Restart current viewing:** Requests Jellyfin's native **Play** action with position **0** (not **Resume**), preserves earlier completed entries in the franchise timeline, and launches video directly from Home where Jellyfin Web supports its delegated shortcuts.
- **Select from chronological list:** Keeps Jellyfin Home visible and opens the scrolling chronological list in a centered overlay. The per-item **Watch...** choice retains tracked or untracked playback options.
- **Play a movie or episode:** The direct local browser handoff uses Jellyfin Web's native shortcuts handler. This preserves Jellyfin's playback/transcoding negotiation without deliberately navigating through Details. In clients without the shortcuts handler, a timed compatibility fallback can still navigate through Details.
- **Timeline safety:** The server still activates chronology only after observing and verifying real local playback. A remote Session API HTTP 204 is never counted as playback success.

## Important: purge old Injected JavaScript registrations

The reset dialog in the user screenshot saying **"Reset all chronological progress for ...? Only this franchise timeline will reset..."** is from an **older script**. It is not the v0.8.9.11 confirmation.

1. Publish/build and install **v0.8.9.11**, then restart the Jellyfin server/service.
2. Go to **Dashboard → Plugins → JavaScript Injector → Plugin Scripts**. Verify the enabled **Franchise Explorer - My Media tile** script has ID `jellyfin-franchise-explorer-my-media-v08911` and Plugin Version `0.8.9.11`.
3. If the older `...-v08910`, `...-v0899`, etc. are **still enabled**, disable those stale plugin registrations **only after** verifying the v08911 entry is active. Disable manually pasted duplicates of Franchise Explorer as well. Do not delete unrelated user scripts.
4. Hard-refresh Jellyfin Web (`Ctrl+Shift+R`); test in a private browsing window if stale assets remain.
5. Optionally check the Web console: `window.__franchiseExplorerUiVersion` and `document.querySelector('#franchise-timeline-resume[data-fe-version="0.8.9.11"]')`. The first should print `0.8.9.11`, and the second should return a DOM element.

## Limitations

Direct playback in Jellyfin Web is dependent on its native delegated shortcut handler and the JavaScript Injector plugin. Offline contracts check the injection source and DOM action shape, **not** a running Jellyfin 12.2 browser. Please test a movie and an episode, particularly one with existing native Jellyfin resume progress. Other clients can require the legacy details handoff. This release does not erase Jellyfin watched history; it modifies only the separate franchise timeline.
