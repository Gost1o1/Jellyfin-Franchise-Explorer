# Auto Franchises and media recovery (0.8.9.26)

Open Franchise Explorer settings, then **Settings → Advanced settings**. The settings page talks to authenticated server APIs; tasks continue when the browser is closed.

## Enable scheduled franchises

Open **Auto Franchises** to inspect the eleven initial IMDb lists, select an existing franchise or create a new one, enable individual sources, and choose episode bundles or individual entries. The global midnight switch starts off. Reusable IMDb lists remain separate; saving a list there does not schedule it. Add an explicit Auto Franchises registry entry to schedule another source.

New franchises receive **TV Shows**, **Movies**, and **Chronological Order** rows. TV Shows contains one card per show. Chronological Order uses verified IMDb positions, expanding a whole-show source entry into available episodes at that position. A series-only list does not establish interleaving with other titles. A chronological row's episode format overrides its franchise default.

The **Auto Franchises** Jellyfin scheduled task runs daily at midnight in the **server's local timezone**. Startup catches up a missed local day; a completed day is not repeated after restart. Runs wait for active scans and do not overlap. Private, failed or incomplete sources and unavailable library media preserve existing content. A failed source is reported for review and checked on a later run.

## Review and saved choices

New unambiguous additions can apply automatically. Removals, manual conflicts, excluded titles and replacements of selected ranges appear in the settings inbox with their source, target row, reason and proposed details. Protected changes start unchecked. **Keep current choices** acknowledges proposals without reintroducing skipped content.

Removing a title, editing its allowed episode range, deleting a scheduled row/franchise, or deliberately unchecking an eligible addition before **Apply selected** records that choice in the same configuration draft. **Save changes** persists it; Undo restores the previous draft. Cancel and failed previews do not create exclusions. Dependency-driven deselection is not a manual skip.

Use **Saved choices** to explicitly restore selected restrictions, then preview the resulting additions. Restoring a whole-show or season restriction allows that entire scope; an individual held episode cannot silently clear a broader restriction. Other restrictions stay active. Playback queue expansion also filters these choices, including episodes reached through a whole-show or collection reference.

Scheduled changes cannot overwrite an unsaved editor draft. If the server configuration changed after loading, Save asks for a reload so both changes can be reviewed.

## Recover after moving media

Bring all drives online and complete a Jellyfin library scan. **Media recovery → Check references** lists verified replacements, ambiguous versions and missing media. A unique match requires compatible media type and stable IMDb/TMDb/TVDb identity; episodes also require a verified parent show and episode coordinates. Automatic reconnection follows healthy library changes and also checks existing references on startup. A periodic catch-up check runs once a minute so missed events do not leave references permanently stale; incomplete snapshots retry after 15 seconds.

Ambiguous versions require your selection. Older imports can use trustworthy saved IMDb ownership evidence even when the move preceded the first recovery snapshot. When no trustworthy provider identity was saved, older movie, show and collection references can reconnect through a single exact title and media-type match. Title normalization handles Unicode, case, whitespace and subtitle separators such as colons and dashes; it retains the full word sequence and does not use fuzzy or partial matching. A stored year constrains the match. Conflicting import history, duplicate versions and episodes lacking parent/coordinate context remain explicit choices. Recovery changes reference targets while preserving franchise/row order, selected ranges, artwork overrides and plugin reference IDs. Plugin-owned per-user timeline queues, ticks and completed keys are remapped transactionally. Jellyfin's own watched history cannot be reconstructed if it was lost during the move.

Portable snapshots improve future moves; the first upgrade cannot recover identity that was never saved. Keep a backup of the plugin configuration and plugin data folder. Browser tests and server-component tests use fixtures; an installed Jellyfin server is still needed to validate a particular drive migration and native-client behavior.

## Missing items that still appear in settings

Saved labels and native Jellyfin IDs are separate. A move or rescan can change native IDs while the plugin still retains a title. Older direct franchise links now appear under **Franchise media** in the tree as well as the media popup; showing that section does not move or recreate anything.

A notice above Settings reports unresolved references, unavailable scans and recovery API failures even when Settings and Advanced are closed. Choose **Review media references** or **Review reference** beside an unavailable title. The review keeps the saved name and pre-fills a library search; select the real replacement and use **Reconnect selected**. Reference IDs, membership, ranges, artwork and plugin progress remain in place.

Automatic reconnection uses a complete, current library snapshot while the library is not scanning. An unrelated offline file does not block a clear replacement when the original native ID was removed. A present-but-offline original is retained to avoid substituting another edition during a temporary drive outage. Conflicting versions or insufficient matching information remain a manual decision. If the server reconnects a title while the editor is open, the notice offers **Reload saved settings**; the draft is not silently replaced, and explicit reload keeps the previous draft in Undo.

The viewer-facing browser counts only titles that resolve through that viewer's Jellyfin access. It uses a neutral unavailable message for deleted and inaccessible media instead of exposing saved administrator labels or reporting nonexistent playable titles.

## Auto remap

Recovery runs on startup and subsequent background checks when automatic reconnection is enabled. **Auto remap** in the review dialog runs an immediate pass over all saved references, without selecting each record or changing the background preference. It uses provider evidence first, then the exact unique title/type rule described above for references without trustworthy historical identity.

Opening review runs an immediate automatic pass first when automatic reconnection is enabled and the editor has no unsaved changes. The dialog lists only references requiring your choice; after the pass, the report shows the number reconnected and the remaining exceptions. **Find candidate** also checks for newly available clear matches before searching. With automatic reconnection off, use **Auto remap** to request that pass explicitly. An unsaved draft stays read-only until it is saved or reloaded.

For unresolved items, **Browse library** lists actual available titles even without a search term. Filter by movies, TV shows or collections, move between pages, and use **Open in Jellyfin** to inspect a candidate. **Choose replacement** stages the choice and collapses the search area, keeping the selected media visible. **Change replacement** reopens the previous search, filters and page; it also works with the keyboard. **Reconnect selected** saves the staged choice. If an older reference was mistakenly saved as a TV show instead of a movie, the selected candidate shows that type correction explicitly. Only full-media references support this correction; episode ranges, direct episodes, collection bindings and conflicting provider evidence retain their checks.

Every write revalidates the library and configuration, preserves reference IDs, row membership, artwork and ordering, and does not overwrite an unsaved editor draft. Timeline remapping remains transactional with the reference update.

Manual search and library browsing also accept an exact IMDb ID or IMDb title URL. For example, `tt0076759` can find an indexed movie named **Star Wars** even if the filename says **Star Wars Episode IV A New Hope**. The library item must have that IMDb provider ID in Jellyfin; a matching filename on disk does not by itself add the item to Jellyfin's index. If it is absent from Jellyfin's normal Movies library, complete a library scan and check that the Jellyfin server can read the media path. Use **All media** when browsing a reference with an incorrectly saved type; selecting a replacement still follows the type-correction and identity checks above.
