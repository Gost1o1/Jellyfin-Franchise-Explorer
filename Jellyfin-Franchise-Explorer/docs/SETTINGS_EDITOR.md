# Settings editor development preview

This branch integrates the approved settings UI into the actual Jellyfin plugin. It loads the existing plugin configuration and searches the signed-in user's Jellyfin library. The standalone UI prototype and its sample data are separate artifacts.

## Editing

- **Settings** contains subtitle preferences and the Home row visibility switch. **Advanced settings**, inside Settings, contains backup import/export and reusable IMDb lists. Viewer preferences are saved per user and server in the current browser; IMDb lists belong to the plugin configuration and its backups.
- **Franchises** starts closed. Add a franchise, or expand an existing franchise to see its rows and subgroups. Settings, plus and delete buttons stay beside each title on mobile.
- A franchise or subgroup's **settings** button opens its title, description, poster, backdrop and IMDb sources. Groups and subgroups can be added here, including inside an existing subgroup.
- A row's **settings** button opens its category and artwork. The category supplies the name; **Custom** reveals a name field. **Sub Group** creates a named subgroup. Converting an existing row keeps that row and its references inside the new subgroup.
- The **plus** button opens **Add/Modify/Delete Media**. This is the only library search surface. It also includes **Add group / row** and **Add subgroup** for the indicated owner.
- Movies search movies, TV Shows search series, and Collection searches collections. Chronological Order searches movies and series. Custom searches all three types. TV references can use a full show, seasons, an episode range or a specific episode chosen from the real library's season and episode lists.
- Drag handles reorder franchises horizontally and rows/subgroups vertically. Drop onto a group's insertion target to nest an entry. Enter or Space on a drag handle opens the equivalent placement dialog.
- Expand a media row to drag its movies, shows, episode ranges or collections up and down. The same handles are available under **Current media** in the plus popup. Each row keeps its own order, including rows inside subgroups. On a media handle, use **Alt+Up/Down** for a single step or **Enter/Space** to choose a position. Use **Save changes** to persist the order; Undo restores the prior arrangement. Reordering keeps media references, ranges, artwork and viewing progress intact.

Media dragging changes the order inside the same row. On touch screens, use the six-dot handle beside the media title. Opening the plus popup leaves the phone keyboard closed; tap **Search titles** to type.

## Subtitle playback

The subtitle switch applies when launching franchise playback and can update a currently playing franchise item. Off requests Jellyfin subtitle index `-1`, including forced, external and ASS subtitle streams. On chooses an available stream in the selected language, with the Jellyfin user's subtitle language as the default when no language is selected. Existing subtitles already burned into a source video cannot be removed.

The server records a temporary preference for the explicit item queue, signed-in user and selected playback device. This supports native queue advances while the web page is paused. It does not rewrite the Jellyfin user's settings. Each new franchise launch replaces the device's queue scope; it expires after twelve hours or a server restart. Replaying an enrolled item on that device during the scope can retain this preference. Unrelated items receive no override, and their metadata requests do not clear the active queue.

If the server cannot confirm the preference, the launch shows an error instead of starting with an unconfirmed setting. A change during playback uses Jellyfin's subtitle command for that user's active device. Android 2.7.3 Integrated Player does not implement that live subtitle command; use the preference before launching or restarting playback. Its later queue entries also receive the saved choice during playback negotiation.

Edits remain in the page until **Save changes**. Saving an individual settings dialog stages that edit; Cancel discards that dialog's pending edits. **Undo** restores prior staged edits. **Reload saved settings** reads the server configuration and keeps the prior draft available through Undo. A concurrent configuration change on the server blocks saving until the editor is reloaded.

Deleting a subgroup confirms that its owned rows, descendants and references will be removed. Removing a reference never deletes a Jellyfin media item. Legacy rows can share node-owned references: deleting such a row removes its membership while retaining references still used elsewhere. Moving shared memberships across incompatible owners is blocked instead of silently dropping them.

## IMDb review

Under **Settings → Advanced settings → IMDb lists**, save named IMDb URLs, edit them, enable or disable them, or remove them from the reusable library. These changes participate in Undo, backup export/import and **Save changes**. Saving a list does not import its titles. Assigning a saved list creates an independent source for the selected franchise, subgroup or row; deleting a reusable list does not remove an already assigned source or any media.

Chronological Auto Add supports **Episode bundles** (the existing default) and **Individual episodes**. Individual mode keeps separate entries such as `S01E01`, `S01E02`, `S01E03` in IMDb order, including any movies between episodes. Bundles combine only verified consecutive entries and split at gaps or intervening titles. The TV Shows presentation row continues to use one full-show card.

Existing Auto-Add entries that need a formatting change appear in the review before replacement. Manual references and edited imports stay protected. A chronological row can override its franchise's episode format. When only reference formatting changes and the playable sequence remains identical, the timeline retains its current position and completed history.

Open a franchise or subgroup's settings, choose **Auto Add from IMDb**, enter a public list URL, and choose **Preview changes**. The review shows title, media type, destination and proposed change. Additions and safe removals start selected; missing titles are shown separately. Episode choices expand within a show, and verified adjacent episodes use a single range such as `S01E01–S01E03`.

**Advanced** provides separate URLs for subgroups and individual rows. Row overrides keep independent source ownership, including when two rows use the same IMDb URL or contain the same title. Changes apply only to the selected scope.

**Apply selected** stages the review. Use **Save changes** to persist it. Manually added references and edited Auto-Add references remain protected. A failed, disabled or removed source does not propose removals based on an empty result. The existing IMDb parser and retrieval implementation remain in use.

## Posters and backdrops

Click either artwork slot in settings to browse **Images**, **Videos**, or **Upload photo**. A delete icon clears each override. It does not delete source artwork or a Jellyfin media file.

The gallery resolves real images and local trailers, special features and theme videos associated with the assigned library media:

| Context | Gallery scope |
| --- | --- |
| Franchise / subgroup | Media in that branch |
| Movies | Movies within the franchise |
| TV Shows | Series within the franchise |
| Collection | Collections within the franchise |
| Custom / Chronological Order | All assigned media types within the franchise |
| Individual media reference | That reference's library item |

Selecting a video for a poster uses its thumbnail. A backdrop can use an associated video, with a static thumbnail fallback. Direct video previews require a locally available MP4 or WebM that the viewer can access and play. Other containers are not transcoded by this feature.

Uploads accept PNG, JPEG, WebP or GIF photos under 8 MB. The browser decodes and normalizes them to a raster image before upload. Each upload creates an immutable plugin asset, so a cancelled draft cannot overwrite an existing image. Clearing an override removes the configuration reference; asset files are retained. Back up the plugin data directory along with configuration when migrating uploaded artwork between servers.

Saved artwork contains image references or a video item ID, without API tokens. Video playback uses a short-lived capability for one video, and checks viewer access again for each request. Existing logo, thumbnail and banner overrides remain stored even though the new editor shows the requested poster and backdrop slots.

## Source and validation

The embedded page is generated from:

- `Configuration/settingsPage.template.html`
- `Configuration/franchise-settings-core.js`
- `Configuration/franchise-settings.js`
- `Configuration/franchise-settings-artwork.js`

Run `python3 scripts/build_settings_page.py` after editing them. Commit the resulting `Configuration/configPage.html`; Jellyfin loads this self-contained embedded resource. CI checks that it is current.

Validation includes model migration and source ownership tests, production-page Playwright tests against mocked Jellyfin APIs, real XML configuration round trips, artwork controller tests, and the existing browsing/playback regressions. A running Jellyfin server is still required to verify dashboard integration, real library permissions, actual IMDb retrieval and browser video codecs in the target installation. This branch does not publish a release or update the catalog.
