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

Ambiguous versions require your selection. Older imports can use trustworthy saved IMDb ownership evidence even when the move preceded the first recovery snapshot. Legacy manual references without stored provider identity need an explicit library search and choice. No match is guessed from its display name. Recovery changes reference targets while preserving franchise/row order, selected ranges, artwork overrides and plugin reference IDs. Plugin-owned per-user timeline queues, ticks and completed keys are remapped transactionally. Jellyfin's own watched history cannot be reconstructed if it was lost during the move.

Portable snapshots improve future moves; the first upgrade cannot recover identity that was never saved. Keep a backup of the plugin configuration and plugin data folder. Browser tests and server-component tests use fixtures; an installed Jellyfin server is still needed to validate a particular drive migration and native-client behavior.

## Missing items that still appear in settings

Saved labels and native Jellyfin IDs are separate. A move or rescan can change native IDs while the plugin still retains a title. Older direct franchise links now appear under **Franchise media** in the tree as well as the media popup; showing that section does not move or recreate anything.

A notice above Settings reports unresolved references, unavailable scans and recovery API failures even when Settings and Advanced are closed. Choose **Review media references** or **Review reference** beside an unavailable title. The review keeps the saved name and pre-fills a library search; select the real replacement and use **Reconnect selected**. Reference IDs, membership, ranges, artwork and plugin progress remain in place.

Automatic reconnection still requires a healthy snapshot and one verified identity. An unrelated offline file no longer blocks an explicit available replacement while the library is not scanning. Missing identity or conflicting versions remain a manual decision. If the server reconnects a title while the editor is open, the notice offers **Reload saved settings**; the draft is not silently replaced, and explicit reload keeps the previous draft in Undo.

The viewer-facing browser counts only titles that resolve through that viewer's Jellyfin access. It uses a neutral unavailable message for deleted and inaccessible media instead of exposing saved administrator labels or reporting nonexistent playable titles.
