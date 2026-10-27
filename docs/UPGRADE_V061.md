# Upgrade v0.6 → v0.6.1 (responsive layout hotfix)

1. Export a Franchise Explorer configuration JSON backup and back up Jellyfin service settings, plus existing plugin-owned artwork.
2. Copy this repository's files over the existing GitHub checkout **without overwriting the live `manifest.json`** if it contains more recent release entries. Keep `.github/workflows` at the repository root.
3. Push to `main` and check **Build and validate** succeeds.
4. Manually run **Publish experimental release** with `version=0.6.1.0` and `confirm=RELEASE_EXPERIMENTAL`.
5. Verify the GitHub Release and JSON manifest before upgrading from Jellyfin's plugin catalog. Restart your Windows service after install.
6. Test the admin page in wide and narrow browser windows; 2-column layout should become 1-column when available space shrinks, without horizontal clipping.

This hotfix changes administration-page styles only, not stored groups, artwork, or media links. Runtime Jellyfin 12.2 testing remains required.
