# Upgrade to v0.6.2.0 — responsive editor and TV Show range dialog

1. Export your Franchise Explorer JSON backup. Separately back up your Jellyfin server configuration and plugin-owned image files; JSON backups do **not** include the uploaded image bytes.
2. Extract this package and copy its **contents** over the same GitHub repository checkout. Preserve the repository's latest `manifest.json` if it contains newer actual published releases. Keep `.github/workflows/build.yml` and `.github/workflows/release.yml` in that exact directory.
3. Commit/push, open GitHub Actions and confirm **Build and validate (no release)** succeeds.
4. Manually run **Publish experimental release (manual approval only)** with version `0.6.2.0` and confirmation `RELEASE_EXPERIMENTAL`.
5. Verify release ZIP and JSON catalog, then upgrade from Jellyfin's existing plugin catalog. Restart the Jellyfin Windows service.
6. In the admin configuration page, **confirm the badge reads `v0.6.2 preview`**. If it reads `v0.5`, hard refresh (Ctrl+Shift+R), then verify the installed plugin version in Jellyfin's plugin dashboard. Do not use an older screen to judge the new UI.
7. Narrow the browser: hierarchy and group details must stack without clipping the toolbar. Search for a TV Show and click **+ Choose TV Show range**. Test season-to-season and episode-to-episode. An existing linked TV Show now has **Edit TV Show range**.
8. Save plugin configuration and reload. Confirm the original nodes, order, link counts, and artwork overrides are preserved.

**Limitation:** this dialog records virtual metadata only. It does not build actual episode playlists or play ranges.

**Runtime safety:** GitHub compilation and the offline mock tests do not prove Jellyfin host compatibility. The plugin remains experimental and potentially unstable. Keep a server backup and do not test destructive actions on production.
