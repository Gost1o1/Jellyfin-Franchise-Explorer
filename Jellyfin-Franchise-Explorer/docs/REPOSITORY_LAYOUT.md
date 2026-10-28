# Repository layout and GitHub update

The repository root intentionally contains only README.md, LICENSE, manifest.json, .gitignore, .github/, and Jellyfin-Franchise-Explorer/.

**Never move `.github/workflows/` below the root:** GitHub Actions will not discover workflows there.

## Uploading without the 100-file web limit

Use GitHub Desktop: **File → Clone repository**, then extract the source ZIP and copy the files into that clone, with hidden files enabled. Remove the now-obsolete root-level `src/`, `scripts/`, `docs/`, `examples/`, `CHANGELOG.md` and tracked mock screenshots after confirming the same files are present in `Jellyfin-Franchise-Explorer/`. Keep your existing `manifest.json`. Commit the changes and **Push origin**.

**Do not attempt to upload the ZIP itself as the source code.** Browser uploads do not extract ZIP files, and browser upload limits do not apply to GitHub Desktop/git pushes.

Before manually publishing any new version, check that **Build and validate** succeeds and the generated DLL is included. Publish through the approved workflow only after test installation/backup steps are complete.
