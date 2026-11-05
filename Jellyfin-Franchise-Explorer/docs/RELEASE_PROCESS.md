# Release process — GitHub Actions only

The repository ZIP contains source code, not an installable Jellyfin DLL. It is intended to replace files in your existing GitHub repository; Jellyfin installs releases through the generated `manifest.json` catalog entry.

1. Preserve your currently published `manifest.json` if it is newer than the packaged one. Export a backup of your plugin configuration and back up uploaded image files.
2. Prepare the source version before releasing. `Version`, `AssemblyVersion` and `FileVersion` in `src/Jellyfin.Plugin.FranchiseExplorer/Jellyfin.Plugin.FranchiseExplorer.csproj` must match the requested version. Keep the catalog API, Injector runtime markers/current script ID, release-workflow default and version assertions aligned. Retain the previous plugin-owned Injector ID in the legacy list.
3. Run `python3 scripts/build_settings_page.py` to update the embedded settings version, then `python3 scripts/check_version.py 0.8.9.24` from the source folder. Merge the prepared source into `main` and check **Actions → Build and validate (no release)** for successful build and browser jobs. These checks are not a host integration test.
4. When ready, start a **new** **Actions → Publish experimental release (manual approval only)** run on `main` using version **`0.8.9.24`** and confirmation **`RELEASE_EXPERIMENTAL`**. Use the version declared by the source for future releases. Rerunning a failed job uses its original commit, so a version fix merged afterward requires a new workflow run.
5. The workflow checks the project version, builds the plugin, packages the DLL, creates a GitHub prerelease targeting the validated commit, computes the ZIP checksum, and updates the manifest. Verify the release and manifest manually. Keep the published manifest unchanged while preparing source; the workflow updates it from the actual release ZIP.
6. Use the existing catalog URL in Jellyfin and restart the service after updating. Validate your saved groups before importing collections.

Catalog URL: `https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`

The release workflow requires permission to publish GitHub Releases and commit `manifest.json` (`contents: write`). Never advertise a release before compilation succeeds. Prefer an isolated Jellyfin instance for runtime compatibility testing; without one, installing on the main service carries risk.
