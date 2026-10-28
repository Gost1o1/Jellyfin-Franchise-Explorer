# v0.7.1.0 — Upgrade from v0.7.0.0

**EXPERIMENTAL, UNVERIFIED ON A LIVE JELLYFIN 12.2 SERVER.** Preserve the existing plugin configuration and take backups before upgrading.

## Source repository upload

This is an **upgrade package** for `https://github.com/Gost1o1/Jellyfin-Franchise-Explorer`. The download ZIP intentionally **does not include `manifest.json`** so it cannot overwrite your existing, live Jellyfin plugin catalog entries when its contents are copied to the repository. Keep your current `manifest.json` in place.

1. Export the v0.7 Franchises JSON configuration; separately back up uploaded plugin artwork and Jellyfin data.
2. Extract the ZIP. Copy **all its contents** into the root of your existing GitHub clone. Do not create a second `Jellyfin-Franchise-Explorer` directory inside the repository.
3. Preserve `.github/workflows/build.yml` and `release.yml` in that exact path (only once).
4. Commit and push. Check **Actions → Build and validate**. A green build confirms compilation, NOT runtime behavior.
5. Manually run **Publish experimental release** with `version=0.7.1.0` and `confirm=RELEASE_EXPERIMENTAL`. Verify the published release and manifest entry before installing.
6. Install/update via your existing Jellyfin plugin catalog and restart the Windows Jellyfin service.
7. Install the **JavaScript Injector** companion separately for the optional My Media tile as described in `docs/MY_MEDIA_TILE.md`, or continue using the standalone browser if you prefer to avoid any web modification.

## Expected result

When the optional companion registration succeeds and Jellyfin Web shows the **My Media** section, a new Franchises card is appended after the normal Books, Collections, Live TV, Movies, etc. cards. Its click opens the existing `/FranchiseExplorer/Browse` page.

This new card is **not a native Jellyfin library**. Native Android TV/Roku apps won't show it; the standalone Franchises browser remains functional and doesn't move or rename any media.

## Rollback

Disable the script in JavaScript Injector and hard-refresh the browser. To revert the plugin DLL, install the previously working v0.7 version from the catalog (after backups). Keep the original plugin settings and artwork directories untouched.
