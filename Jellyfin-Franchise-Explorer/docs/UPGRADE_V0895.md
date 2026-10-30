# Franchise Explorer v0.8.9.5 — Experimental release

This is an experimental Jellyfin 12.2 **source** package, not an installable
plugin ZIP. Back up the Jellyfin server and Franchise Explorer data first.

## Why a new version?

The GitHub prerelease `v0.8.9.4` already exists, so a second manual publish
attempt failed at `gh release create`. Recreating or replacing the same tag
could confuse plugin updates and Jellyfin's JavaScript Injector cache. Release
the current fixes as `v0.8.9.5`; leave `v0.8.9.4` available for rollback.

## Included corrections

1. **Hover menu:** The My Media three-dot button is inside the artwork. On a
   desktop, hover or focus the Franchises tile to reveal it. On touch devices,
   the button stays accessible. Browser tests must hover first, then click.
2. **Home-row filtering:** Open Franchises and check **Hide active franchise
   titles from Continue Watching and Next Up** to hide the current watch-order
   show/movie from those two native Jellyfin Web rows. Uncheck to show them.
   Off is the default; the watch-order card and Jellyfin watched flags remain.
3. **Portrait artwork:** Phone portrait prefers Primary series/movie posters;
   landscape and desktop retain the wide art, with fallback and live rotation.
4. **Injector script refresh:** The new owned script ID is
   `jellyfin-franchise-explorer-my-media-v0895`. Only obsolete scripts owned
   by Franchise Explorer are retired after registration succeeds.
5. **Release validation:** A duplicate release tag now fails early with a
   message explaining that the project version must be bumped. Existing
   GitHub releases are not overwritten.

## Upload and publish

1. Extract the complete source ZIP at the repository root, retaining its
   folder structure. Do not replace the workflow-managed `manifest.json`.
2. Push to `main`. Confirm both `build` and `ui-browser` GitHub Actions jobs
   succeed. Browser mocks cannot substitute for testing on live Jellyfin.
3. Manually run **Publish experimental release (manual approval only)** with
   version `0.8.9.5` and confirmation `RELEASE_EXPERIMENTAL`.
4. Install the resulting compiled release through your Jellyfin plugin
   repository, restart Jellyfin, then hard-refresh Jellyfin Web.
5. Confirm **Dashboard → Plugins → JS Injector** has one enabled Franchise
   Explorer script with Plugin Version `0.8.9.5`.

Jellyfin watched state and existing media files are not modified by the
home-row visibility preference. Native-client compatibility is unverified.
