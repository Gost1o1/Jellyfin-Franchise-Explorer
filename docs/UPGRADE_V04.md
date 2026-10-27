# Upgrade v0.3 → v0.4 — Jellyfin 12.2 Windows service

1. In v0.3, export **backup JSON** and back up Jellyfin's server configuration.
2. Commit all files from this source ZIP to your existing repo (keep `.github/workflows` at the repository root). Remove obsolete files not in the ZIP.
3. Run **Build and validate** in GitHub Actions. Do not proceed if it fails.
4. Manually run **Publish experimental release** with version `0.4.0.0` and `RELEASE_EXPERIMENTAL` only after the build passes.
5. Verify GitHub Releases and `manifest.json` before installing the catalog upgrade and restarting Jellyfin.
6. Verify your seven example groups remained, then select Marvel or one of its subgroups.
7. For an existing saved group, click **Upload image**, choose a PNG/JPEG/WebP file, wait for the upload success notice, then click **Save plugin configuration**.
8. Refresh and confirm the image remains. Confirm no media files or original Jellyfin collections were modified.

The image GET/POST APIs require administrator privileges. Saving is separate from upload. JSON backups do not contain binary artwork; include the plugin data folder in server backups.
