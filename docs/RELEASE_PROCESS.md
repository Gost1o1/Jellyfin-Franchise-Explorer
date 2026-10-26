# Publish from GitHub only — no local SDK needed for installation

## Push the repository

This repository ZIP contains **source files**, not an installable Jellyfin plugin. Extract the ZIP and add the files to your GitHub repo, keeping folders. Do not upload the ZIP as though Jellyfin could install it directly.

A GitHub Desktop clone/commit/push is a reliable way to replace files already in an existing repository, without using PowerShell or compiling locally. You can also use GitHub's web editor and file uploader while preserving folders.

## Confirm CI

Open **Actions → Build and validate**. A green run indicates a successful .NET build and basic file checks, **not** runtime compatibility.

## Controlled pre-release (only after isolated testing)

1. Open **Actions → Publish experimental release (manual approval only)**.
2. Select **Run workflow**, main branch, version `0.3.0.0` and enter exactly `RELEASE_EXPERIMENTAL` in the confirmation field.
3. The workflow builds the DLL, packages a minimal ZIP, makes a GitHub **prerelease**, then computes its Jellyfin-compatible checksum and commits the updated `manifest.json`.
4. Verify the release asset, the manifest's `sourceUrl` and `checksum`, and that GitHub Actions was successful.
5. Copy the Jellyfin repository URL only after that: `https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`.

Until then, `manifest.json` is intentionally `[]`, so the Jellyfin Catalog correctly shows **no installable release**. **Never invent a release URL or checksum.**

## Critical safeguards

- The workflow publishes only when manually invoked with the confirmation phrase and from `main`.
- The version must exactly match the `.csproj` `<Version>`.
- Do not publish merely because a build passes. First test loading on an isolated Jellyfin 12.2 instance.
- GitHub Actions needs repository Actions enabled and workflow `contents: write` permission to commit the manifest and publish a release.
- Prerelease visibility/installation behavior may vary by client; verify in a disposable environment.

**v0.3 specific:** Keep the existing v0.2 manifest entry; do not replace `manifest.json` with `[]`. Run the UI contract test with `node scripts/ui_contract_tests.js`.
