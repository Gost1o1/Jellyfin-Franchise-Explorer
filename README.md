# Jellyfin Franchise Explorer

> [!CAUTION]
> **UNFINISHED EXPERIMENTAL PROJECT — USE WITH EXTREME CAUTION.**
>
> **I have not finalized this project. It is in its very early stages of development and should be used with extreme caution.**
> This is a source-available project under a custom noncommercial license (not OSI-approved open source). Back up the Jellyfin server, plugin configuration, and plugin data before installing or upgrading.

Jellyfin Franchise Explorer manages **virtual** franchises, eras, phases, and media references without relocating or duplicating movies and shows. This code targets Jellyfin **12.2** / **.NET 10** and uses the same plugin GUID and backward-compatible configuration format as v0.2–v0.5.

## Version 0.7.0.0 — experimental Franchises browsing page

**UNFINISHED PROJECT — USE WITH EXTREME CAUTION.** Version 0.7 adds an authenticated, read-only franchise browser that displays your existing nested groups as poster tiles, inherited art and linked media in your browser. A new **Open Franchises browser** button in the plugin editor launches it. The browser lives at `/FranchiseExplorer/Browse` on your Jellyfin server. It does not alter your previous Jellyfin collections or move files.

The layout adapts from desktop widescreen to TV browsers, laptops, tablets and phones, with large clickable tiles, keyboard arrows/Enter, breadcrumbs, grid/list view and a search field. Media cards open Jellyfin details. Episode ranges remain labels and **do not yet provide continuous chronological playback**. All editing still happens in the plugin configuration page.

**Important navigation limitation:** A plugin cannot automatically create a native Jellyfin library tile in "My Media". To put Franchises in the Jellyfin Web navigation, configure a supported `menuLinks` entry in your `jellyfin-web/config.json` (optional, one-time action). This is documented in [Franchises navigation](docs/FRANCHISES_NAVIGATION.md). Native Roku/Android TV clients are not extended by the plugin, though a TV **web browser** can open the responsive page.

**Access:** The static page has no private content. Catalog access requires login, and linked items are resolved by each user's existing Jellyfin permissions. Franchise group titles, descriptions and uploaded group artwork are shared with authenticated users, and therefore should not contain access-restricted information. Uploaded images remain separate from your movie folders. Back up your plugin configuration and artwork first.

**Status:** Local checks can verify script syntax and mock browser layout; only a successful GitHub build and subsequent server tests can establish compatibility. Do not treat the release as production-ready.

### Upgrading via GitHub

1. Export a JSON backup of the v0.6.x configuration, and back up uploaded group artwork and Jellyfin configuration.
2. Extract the complete v0.7 repository package into your existing GitHub clone, **preserving the live `manifest.json`** if it has newer published releases. Ensure `.github/workflows/` appears only once.
3. Commit/push, wait for **Build and validate** to succeed.
4. Manually run **Publish experimental release** with version `0.7.0.0` and confirmation `RELEASE_EXPERIMENTAL`.
5. Verify the tag and manifest before upgrading through Jellyfin's plugin catalog. Restart the Jellyfin Windows service; hard-refresh the browser. The configuration page must display `v0.7 preview`.
6. Click **Open Franchises browser** to preview the UI before optionally adding a Jellyfin Web `menuLinks` entry.

## Version 0.6.2.0: fit to visible dashboard and TV Show range dialog

**Experimental / not tested on a live Jellyfin server.** This update addresses two issues reported in the Jellyfin Web admin page:

- **Visible-space layout:** the editor measures the available width to the right of the Jellyfin content area's on-screen left edge and constrains itself accordingly. It stacks the franchise tree above the details editor when needed. It no longer relies exclusively on browser or CSS container breakpoints, which could still center the editor inside an offscreen-sized dashboard container.
- **TV Show pop-up:** click **+ Choose TV Show range** next to a TV Show in search results. A centered dialog opens with **Entire TV Show**, **Season to season**, or **Season/episode to season/episode**. Enter the starting and ending season/episode numbers and click **Add to franchise**. Existing TV Show references also have an **Edit TV Show range** button; editing retains that link's position, ID, and saved artwork association.
- **Bulk selection:** checkbox bulk-adding explicitly creates complete-title links. To add only part of a TV Show, use the individual **+ Choose TV Show range** button. Multiple different ranges for the same TV Show are supported in one group; exact duplicates are blocked.

Season/episode ranges are virtual metadata only; they cannot yet launch sequential playback. Nothing is moved or rewritten in the media library. The internal Jellyfin API media type remains `Series`, displayed as **TV Show** in the editor.

**Version check:** The configuration page must say **v0.6.2 preview**. A page saying **v0.5 preview** is still running an older installed plugin. After updating through the catalog and restarting the Jellyfin Windows service, hard-refresh Jellyfin Web (Ctrl+Shift+R). If it still says v0.5, check Dashboard → Plugins → My Plugins for the installed version before diagnosing v0.6.2 functionality.

Offline Chromium tests cover 390, 620, 800, 1150, and 1600-pixel viewports with deliberately overwide parent layouts, including adding, editing, and dismissing a TV Show range through a mocked Jellyfin API. **These do not establish live Jellyfin compatibility.**

## Previous version 0.6.1.0: group organization and TV Show ranges

**Experimental / runtime unverified.** This build adds drag-and-drop groups, Move up/Move down buttons, a clearly scoped artwork editor, and TV Show season and episode ranges. It preserves the existing configuration model and artwork uploads. It is **not** a complete chronological playback feature: ranges are currently saved as virtual metadata for future expansion.

To create a TV Show range, search for a show and select **+ Season/episode range**. Choose entire seasons or specific episode endpoints, then save the plugin configuration. Jellyfin internally refers to TV shows as `Series`; Franchise Explorer displays them as TV Shows.

To reorganize groups, drag them above or below another group to reorder siblings, or onto a group's center to nest them. You can also use Move up / Move down. Always check the resulting hierarchy before pressing Save.

**Custom artwork:** Each image belongs to the selected franchise, phase, era, or subgroup. Adding a media item never intentionally replaces an uploaded group image. The resolver and asynchronous preview handling prioritize the selected group's explicit override. If an uploaded image appears to change unexpectedly, stop and export a backup before saving.

## Previous v0.5: automatic inheritance, collection import, bulk linking

### Default: inherit existing Jellyfin artwork

Every group automatically displays the first available image for each **image type** in this order:

1. **Explicit custom override** on that group (previously uploaded image or saved URL).
2. An explicitly **connected Jellyfin collection (BoxSet)**.
3. **Parent group's image**, including its effective inherited or custom image.
4. An **existing linked movie/show image** indexed by Jellyfin.
5. Placeholder if no suitable image exists.

Each poster, backdrop, logo, thumb, and banner is computed independently. A poster is **never** stretched into a logo or treated as an available backdrop. Existing files downloaded by Artwork/Fanart into movie folders are reused through Jellyfin's image metadata and API; **no filesystem scan or image copying is required**. If an upload is used, it overrides only its specific image type. Click **Restore inherited** to remove the override; the original images are never modified. This is dynamic: if Jellyfin changes the source image, the inherited image is resolved again on the next view. Some Jellyfin image types may not be present on every title.

**Important:** Artwork inheritance works in the plugin **administration page**. A public-facing Franchises section/home tile, native client integration, and playback are *not* available yet.

### Import from your existing Jellyfin collections

- Select a virtual franchise/era/phase; under **Existing Jellyfin collection**, search for a collection.
- Click the collection to **connect it**. Its images become the default artwork for this group.
- Click **Import collection members** to add its current movies/shows as **virtual references**, without changing the original collection or any file.
- Existing links are deduplicated by item ID. The import is a **one-time snapshot**, **not** live syncing. Nested collection entries and other unsupported item types are skipped. Preview limits remain 250 groups, 3,000 virtual references, and 1,200 collection entries per import.
- Confirm the preview prompt and click **Save plugin configuration** to persist.

### Bulk linking

Search for Jellyfin media within a selected group, use checkboxes and **Select all results**, then **Add selected media**. Results are intentionally limited to 25 per search; refine search to find additional items. The added media are virtual references, not new physical copies.

### Existing functionality retained

- Editable nested groups, sortable virtual references, JSON metadata backup/restore.
- Admin-only JPEG/PNG/WebP uploads up to 8 MB per image (five types).
- Custom per-group poster/backdrop/logo/thumb/banner overrides.
- Stable plugin configuration GUID and backwards-compatible `Nodes`, `MediaLinks` and artwork URL fields. New optional `CollectionId` is backward compatible.

### Unavailable features

- New Franchises library in Jellyfin's standard navigation or right-click context menu.
- In-universe chronological playlist playback and automatic per-user franchise watch progression.
- Ongoing collection membership synchronization, recognition of every possible ungrouped franchise item, or nested BoxSet expansion.
- Broad Jellyfin client compatibility outside the installed Jellyfin Web administrator editor.

## Safe update / GitHub publishing

1. In your current installed version, export the **backup JSON** and back up the Jellyfin server's plugin configuration and `franchise-artwork` files. JSON backup contains metadata and references, **not the uploaded image bytes**.
2. Extract the v0.6.2 repository ZIP and replace the project source and workflows in your existing GitHub clone. **Preserve your current root `manifest.json` if it contains newer published versions**; don't overwrite a live catalog with an older copy from the source ZIP. Both workflows must be in `.github/workflows/` exactly once.
3. Commit and push to `main`. Confirm **Build and validate (no release)** completes successfully.
4. Only after a successful build, manually run **Publish experimental release (manual approval only)** using version `0.6.2.0` and confirmation `RELEASE_EXPERIMENTAL`.
5. Verify the GitHub Release ZIP and manifest before updating from Jellyfin's plugin Catalog. Restart the Windows Jellyfin service after updating.
6. Select an existing group and verify its image override is unchanged when linking media. Try ordering groups and saving a TV Show range, then refresh and confirm persistence.

Catalog URL, only after a published successful release:
`https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`

**Status:** Source code static tests can pass while a build or runtime API still fails. No Jellyfin 12.2 host integration test is claimed. Do not treat a green GitHub Actions checkmark as proof of runtime safety.

## License

See [LICENSE](LICENSE): **PERSONAL AND NONCOMMERCIAL USE LICENSE (DRAFT)**, preserved exactly as supplied by the project owner. Third-party dependencies remain subject to their own licenses. Seek legal review before broader distribution.

## References

- [Jellyfin Plugins documentation](https://jellyfin.org/docs/general/server/plugins/)
- [Official Jellyfin plugin template](https://github.com/jellyfin/jellyfin-plugin-template)
- [Smart Collections](https://github.com/johnpc/jellyfin-plugin-smart-collections) (technical inspiration only)

## Earlier responsive layout work (v0.6.1)

The administration interface now responds to its available **Jellyfin content width**, not only the full browser window width. Its two columns stack as necessary, artwork tiles and form controls wrap, and the overall page stays within its containing region. This is a CSS-only layout change; franchise data, custom artwork, and media references are unchanged.

## Development-only browser regression test

Run `python3 scripts/test_live_ui_browser.py` only in an environment with Playwright and Chromium installed at `/usr/bin/chromium`. This test uses simulated Jellyfin responses and is **not** part of GitHub Actions (the hosted runner lacks that local Chromium test environment). The GitHub build executes the static layout and range-dialog contract checks.
