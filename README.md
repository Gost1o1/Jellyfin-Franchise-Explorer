# Jellyfin Franchise Explorer

> [!CAUTION]
> **UNFINISHED EXPERIMENTAL PROJECT — USE WITH EXTREME CAUTION.**
>
> **I have not finalized this project. It is in its very early stages of development and should be used with extreme caution.**
> Version 0.3 is experimental; test after backing up the Jellyfin configuration and exporting the plugin's JSON data. Do not rely on it for critical media management. This project is source-available, not OSI-approved open source.

**Jellyfin Franchise Explorer** is an experimental plugin for organizing existing movies and television shows into **virtual** franchises, eras, phases, sagas, and viewing orders — without moving or duplicating any media files.

**Repository:** https://github.com/Gost1o1/Jellyfin-Franchise-Explorer

## v0.3.0.0 — what changed

- Reworked administration page with a dark, responsive **two-column layout** and hierarchical folder navigator. Page-local styles now ship **inside** the embedded page, avoiding the missing styles seen in v0.2.
- **Search your Jellyfin library** for movies, shows, seasons, and episodes using the authenticated Jellyfin API, and click to create a virtual reference. No copying GUIDs required; manual entry remains under **Advanced** as a fallback.
- Preview a group's primary poster from a supplied HTTPS or same-origin relative URL. Store the other collection-style artwork URLs (backdrop, clearlogo, thumb/icon, banner) as metadata.
- Filter existing groups by name or kind; display linked items with lightweight order adjustment.
- Retain every v0.2 XML configuration property, plugin GUID and JSON export schema, so previously saved groups remain readable.
- Prevent duplicate references to the same media item in one group from the search picker. Media remains untouched.

### Known limitations

This is **only an administrator configuration page**. It does not create a new Franchises tab alongside Jellyfin's libraries, produce nested collection pages in clients, automatically generate artwork, upload images, or play chronological sequences. The picker depends on APIs available in your Jellyfin Web instance and may vary with browser/server versions. Artwork previews require a reachable URL and do not upload images to Jellyfin. No media files or native Jellyfin collections are changed. Media IDs are not validated server-side and references will not automatically reconnect after a library rebuild.

Timeline fields and numeric order exist, but **playback, custom playback progress, and episode-level chronological orchestration are not yet implemented**.

## Important: Updating from v0.2

1. Open v0.2 settings and choose **Export backup JSON**. Keep the file in a safe location.
2. Also back up your Jellyfin server's configuration. Your Windows service does not need any local .NET build tools for the GitHub release process.
3. Replace the source files in your GitHub repository with the contents of this ZIP, preserving the `.github/workflows` paths. **Do not delete or overwrite v0.2's existing release or clear its `manifest.json`**. This ZIP includes a snapshot of the currently published v0.2 manifest so upgrading the source will not drop that catalog version.
4. Wait for **Build and validate** to pass on GitHub Actions.
5. Open **Publish experimental release**, run on `main` with version `0.3.0.0`, confirmation `RELEASE_EXPERIMENTAL`. It creates a new prerelease and prepends v0.3 to the manifest while retaining v0.2.
6. Check `manifest.json` includes both versions and the `v0.3.0.0` GitHub Release has the DLL ZIP. Update through Jellyfin's Plugins catalog, restart your Jellyfin Windows service, and refresh the browser (`Ctrl+Shift+R`).
7. Open the plugin settings. Verify your existing Star Wars/Marvel sample groups are still there **before making edits**. Test a Jellyfin library search. If results fail to load, the manual GUID workflow remains available.

**One-click Jellyfin catalog URL** (after a release is published):

`https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`

For additional details see [Upgrade instructions](docs/UPGRADE_V03.md), [Release process](docs/RELEASE_PROCESS.md), and [Safe testing](docs/SAFE_TESTING.md).

## Compatibility and data boundaries

- Intended for **Jellyfin 12.2**, `.NET 10`, and plugin ABI `12.0.0.0`.
- Stores data in the plugin's existing XML configuration; capacity limited to 250 virtual groups and 3,000 links. This is temporary storage for preview releases, not a scalable long-term database.
- Changes only plugin-owned configuration records, not Jellyfin's original files, library database or native collections.
- Search is a foreground action in the authenticated admin web UI; no scheduled library scans are created.
- URL previews may request images from external domains you provide. Avoid untrusted image URLs; only HTTPS or single-leading-slash relative references are accepted.

## License

This project uses the root [PERSONAL AND NONCOMMERCIAL USE LICENSE (DRAFT)](LICENSE), **unchanged** from the project owner's supplied text. It is a non-OSI-approved custom source-available license and should receive legal review before wide redistribution, particularly for plugin/dependency license compatibility.

## Development references

- [Official Jellyfin Plugins Documentation](https://jellyfin.org/docs/general/server/plugins/)
- [Official Jellyfin Plugin Template](https://github.com/jellyfin/jellyfin-plugin-template)
- [Smart Collections](https://github.com/johnpc/jellyfin-plugin-smart-collections) (conceptual and packaging reference)
- [JellyWatch Collections Guide](https://jellywatch.app/blog/jellyfin-collections-smart-playlists-organize-library-2026)
