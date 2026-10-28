# Upgrade to 0.7.0.0

1. Export a backup JSON from the existing plugin. Back up your Jellyfin configuration and plugin-owned artwork folders separately.
2. Copy this full repository into your GitHub clone **but retain the live root `manifest.json`** from the currently published GitHub branch.
3. Commit/push. Check the `Build and validate` workflow.
4. Trigger `Publish experimental release` with version `0.7.0.0` and confirmation `RELEASE_EXPERIMENTAL`.
5. Verify the GitHub Release archive and manifest before updating in Jellyfin. Restart the Windows service and hard-refresh.
6. Click `Open Franchises browser` in the plugin settings to preview the new page.
7. Read [navigation](FRANCHISES_NAVIGATION.md) before adding a `menuLinks` entry for a Franchises link in Jellyfin Web.

This release adds a read-only browsing page, not a native Home/My Media library or a Roku/Android TV feature. Media links, franchise nodes and uploaded artwork survive without schema migration.
