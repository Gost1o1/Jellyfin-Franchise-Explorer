# Upgrade v0.7.4.0 (experimental)

1. Export configuration JSON from the existing plugin and separately back up the plugin artwork directory and Jellyfin configuration.
2. Replace source files in your GitHub repository with this package, **except manifest.json** (keep the live version).
3. Run Build and validate, then Publish experimental release with version `0.7.4.0`, confirmation `RELEASE_EXPERIMENTAL`.
4. Verify GitHub Release and catalog entry, install from the Jellyfin plugin catalog, restart the Windows service and hard refresh.
5. On a test row of type Movies / TV Shows, search a title in Jellyfin that is not linked to the parent group. Add it, save, and verify the browser shows it. For a TV Show, use Choose TV Show range.

Old row MediaLinkIds remain valid; newly selected items live in `Rows[].Items` and can be reordered among old `MediaLinkIds` using `Rows[].MediaOrder`. They do not create new `MediaLinks` or modify original Jellyfin collections. Deleting a row deletes only its presentation references.
