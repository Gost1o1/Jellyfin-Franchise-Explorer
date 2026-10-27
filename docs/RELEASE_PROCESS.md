# Release process — GitHub Actions only

The repository ZIP contains source code, not an installable Jellyfin DLL. It is intended to replace files in your existing GitHub repository; Jellyfin installs releases through the generated `manifest.json` catalog entry.

1. Preserve your currently published `manifest.json` if it is newer than the packaged one. Export a backup of your plugin configuration and back up uploaded image files.
2. Copy source files and `.github/workflows` into your GitHub clone; commit and push to `main`.
3. Check **Actions → Build and validate (no release)** for a successful compilation and static tests. This is not a host integration test.
4. When ready, run **Actions → Publish experimental release (manual approval only)** on `main` using version **`0.5.0.0`** and confirmation **`RELEASE_EXPERIMENTAL`**.
5. The workflow checks the project version, builds the plugin, packages the DLL, creates a GitHub prerelease, computes the ZIP checksum, and updates the manifest. Verify the release and manifest manually.
6. Use the existing catalog URL in Jellyfin and restart the service after updating. Validate your saved groups before importing collections.

Catalog URL: `https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`

The release workflow requires permission to publish GitHub Releases and commit `manifest.json` (`contents: write`). Never advertise a release before compilation succeeds. Prefer an isolated Jellyfin instance for runtime compatibility testing; without one, installing on the main service carries risk.
