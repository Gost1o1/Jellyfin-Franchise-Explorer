# Upgrade v0.7.4.1 — Row search focus hotfix

This release corrects the full-library search field repeatedly losing focus during typing. No configuration migration is needed.

1. Export the Franchise Explorer JSON backup. Back up Jellyfin plugin configuration and uploaded images separately.
2. Copy the contents of this ZIP into your existing GitHub repository. Keep your existing `manifest.json` from GitHub (do not overwrite it).
3. Commit and push to main, check **Build and validate**.
4. Run **Publish experimental release** once with version `0.7.4.1` and confirmation `RELEASE_EXPERIMENTAL`.
5. After verifying the published release and catalog, update through Jellyfin, restart its Windows service and hard refresh Jellyfin Web.
6. Confirm the admin header displays `v0.7.4.1 preview`. In a custom row, type the full word `Loki` or `Captain America` without clicking the search field between letters. Wait for results, then type more and confirm focus stays in the input.

No native Jellyfin media files or collections are modified. This remains an experimental plugin; the GitHub build and a server test are still needed.
