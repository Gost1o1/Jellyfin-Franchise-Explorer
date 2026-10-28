# Jellyfin Franchise Explorer v0.7.3.0 — Custom horizontal rows

> **UNFINISHED EXPERIMENTAL PROJECT — USE WITH EXTREME CAUTION.**
>
> Back up Jellyfin configuration, plugin XML configuration, uploaded franchise images, and export your Franchise Explorer JSON before upgrading. This code has not been tested on your server.

## What's new

- **Multiple named horizontal rows per franchise or subgroup:** e.g. `Phases`, `Character Collections`, `Chronological Viewing Order`, or `Marvel One-Shots`.
- **Create custom rows, rename them, change content type, drag to reorder, or delete.** Deleting a row does not remove the underlying group, movie/TV reference, original Jellyfin collection, or media file.
- **Choose the cards in each row.** Select existing direct child groups and/or linked movie/TV references, including season/episode-range references stored inside nested groups. Drag an assigned card or use up/down buttons to change its position.
- **Existing v0.7.2 data is maintained.** Without saved custom rows, the browser automatically groups your existing subgroups into suggested sections by type. The admin editor has **Create suggested rows** to persist editable versions and add an empty Chronological Viewing Order row.
- **No native client changes.** Existing Jellyfin Web My Media Franchises tile (when JavaScript Injector is enabled) and standalone `/FranchiseExplorer/Browse` are retained. Native Roku/Android TV apps still do not gain a new category.

## How to use it

1. In the plugin settings, select **Marvel Cinematic Universe** in the left hierarchy (not Phase One).
2. Scroll to **Browse rows** in the Group details panel.
3. Click **Create suggested rows**. You should see a *Phases* row populated with your existing phases and, if present, a *Collections* row with your existing collection/character groups. It also creates an **empty Chronological Viewing Order row**, because the plugin cannot infer a trustworthy chronology.
4. To make another row, type any name under **New row name** (such as *Defenders Saga*), choose **Subgroups**, **Movies / TV shows**, **Chronological / custom viewing order**, or **Groups and media**, and click **+ Add custom row**.
5. Open **Choose subgroups** or **Choose movies / TV shows**, then check the cards to include in that row. On each assigned item, use its grip to drag or the up/down arrows to reorder.
6. Change a row's **Row name** to rename it. Use **Delete row** to remove the display row (confirmation required); this does **not** delete its contents.
7. Drag a row by its ⠿ handle, or use its up/down buttons to move the whole shelf.
8. Click **Save plugin configuration** and refresh. Open **Franchises browser** to check the rows.

**Viewing-order limitation:** Chronological rows display media references in the *manual order you assign*. The plugin does **not** calculate a chronological timeline from MCU lore, and it still does not play a multi-title or episode-range queue. You can reference an existing movie/show in several separate rows without duplicating the media file.

## Upgrade through your existing GitHub repository

1. Download and extract the `v0.7.3.0` repository ZIP.
2. Copy its contents into your existing `Gost1o1/Jellyfin-Franchise-Explorer` repository, preserving folder hierarchy, especially `.github/workflows/`.
3. **Do not overwrite your live `manifest.json`.** The upgrade ZIP deliberately excludes it.
4. Commit and push. Confirm **Actions → Build and validate** succeeds.
5. Run **Publish experimental release (manual approval only)** once with `version = 0.7.3.0` and `confirm = RELEASE_EXPERIMENTAL`. Do not rerun after the release has already been created.
6. Confirm both the GitHub release asset and `manifest.json` advertise v0.7.3.0. Refresh Jellyfin's plugin catalog, install the update, and restart the Jellyfin Windows service.
7. Check that the settings page says **v0.7.3 preview**, and export a fresh JSON backup after verifying the new rows.

The included tests are structural and simulated-browser checks. Only GitHub Actions can compile the .NET plugin in the current workflow; a successful compile does not prove Jellyfin 12.2 runtime compatibility.

## Rollback

Use your saved XML/Jellyfin configuration and uploaded artwork backup if necessary. Existing `Nodes` and `MediaLinks` are retained, but the new `Rows` field may not be represented by old plugin versions. A backup exported before upgrading is the safest rollback point.
