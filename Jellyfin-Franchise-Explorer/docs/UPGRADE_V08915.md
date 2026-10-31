# Franchise Explorer v0.8.9.15 — Native Home playback and poster artwork

This experimental source release targets Jellyfin 12.2. Use GitHub Actions to build a compiled release; the source ZIP itself is not a plugin installation archive.

## Improvements

- Clicking the artwork or **Resume Watch Order** on **Continue Your Franchises** starts the current playable title from Jellyfin Home using the native player. No transition to the standalone Franchise Explorer browser and no chronological-list modal should appear.
- After an episode genuinely completes and the timeline engine confirms the next entry, the existing Jellyfin Web bridge schedules the next title from Home, without routing to the old episode's or new episode's Details page. When a player cannot be started directly, it reports the problem and does not falsely count it as a completed watch.
- **Details** in the three-dot menu remains an explicit, non-autoplay route to Jellyfin's title information.
- The Continue card now prefers the series/movie **Primary poster** in both landscape and portrait layouts, fitting the whole image with a softly blurred poster background. The prior landscape artwork is only a fallback when no poster exists.
- The v0.8.9.15 Injector script ID is `jellyfin-franchise-explorer-my-media-v08915`. The plugin attempts to retire the prior v0.8.9.14 script after registering the new one; original artwork, library media, and user timeline history are preserved.

## Publish and check

1. Back up your Franchise Explorer settings. Push the new source to GitHub and run **Publish experimental release** for `0.8.9.15`, provided that release tag is not already in use. Existing published releases are not overwritten.
2. Install the **compiled plugin archive** from GitHub Releases, restart Jellyfin and refresh Jellyfin Web.
3. In JS Injector, ensure only the new v0.8.9.15 plugin-owned My Media script is enabled. Disable older manually added duplicates after verifying the replacement.
4. From **Jellyfin Home**, click both the poster and **Resume Watch Order**. The current video should begin without showing the Franchises browser, selection popup or title Details. Confirm it resumes its saved position.
5. Let an episode finish normally. The next chronological episode should start through the native player, without a Details-page handoff. Verify no duplicate starts and that the next item is tracked only after real playback begins.
6. Verify poster artwork is the same on desktop and a portrait-oriented phone, and the three progress bars still show the right totals.
7. Test **Details** separately; it should open the title information without automatically playing.

Static contracts and offline simulations cannot prove compatibility with the installed Jellyfin Web client. Please capture live playback errors if the native shortcut is unsupported.
