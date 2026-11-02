# Franchise Explorer v0.8.9.16 — Language and unassigned-reference fixes

Experimental upgrade for Jellyfin 12.2. Back up your plugin configuration and artwork separately before installing.

## What's fixed

1. **Franchises missing for German display language:** The Jellyfin Web script previously searched for the literal English heading `My Media`. The new tile detection also finds native library rows structurally, and the resume card anchors to the inserted Franchises tile. German, English and other localized Home screens should be tested on the target client. Purely native Android screens are not injected by JavaScript Injector.
2. **Subtitle language:** Settings → Playback & Home preferences now includes **Preferred subtitle language** beneath the Enable subtitles checkbox. The default inherits the current signed-in user's **Jellyfin preferred subtitle language** (shown in the dropdown when available) and follows subsequent changes to their Jellyfin setting. A manually chosen language overrides it for this browser. The plugin tries to apply the resolved language to Jellyfin Web text tracks; this cannot guarantee selection for every subtitle type or remote player. Enable subtitles separately; that checkbox still defaults to off.
3. **Unassigned Movies & TV Shows after disconnecting a collection:** This is an automatically generated row for virtual links that still exist but aren't in a custom browse row. Select the franchise in settings, scroll to **Manage imported virtual references**, choose **Remove unassigned references**, confirm the count, and **Save plugin configuration**. You can remove individual links from the collapsible list. No Jellyfin collections or media files are deleted.

## Updating

1. Commit/upload the updated source from the v0.8.9.16 package into your GitHub repository, preserving `.github/workflows/`.
2. Run the existing **Publish experimental release** workflow for version `0.8.9.16` once the source checks pass. Do not reuse an existing release tag.
3. Install the compiled update from the Jellyfin plugin catalog after the manifest release entry is published. Restart Jellyfin.
4. Open JavaScript Injector settings and verify there is exactly one enabled plugin-owned **Franchise Explorer - My Media tile** script, ID `jellyfin-franchise-explorer-my-media-v08916`; the plugin attempts to unregister the older v0.8.9.15 entry automatically.
5. Hard-refresh the Jellyfin Web client (Ctrl+Shift+R) or reload it in a fresh browser session. Test **Jellyfin user display language = German**, then English, and test subtitle selection with a playable video that actually contains the chosen subtitle language.
6. Validate a franchise with previously imported collection members and custom rows; the unassigned cleanup button should remove only links that aren't assigned to any configured row.

## Limitations

- JavaScript Injector affects Jellyfin **Web** and compatible web-based views, not every platform's native app interface.
- Subtitle language selection is not guaranteed when Jellyfin's player uses externally rendered subtitles, lacks a matching text track, or applies its own track preferences later.
- The live Jellyfin 12.2 UI and all languages still require real-device testing. Offline contracts do not prove compatibility.
