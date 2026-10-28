# Updating the existing GitHub repository

The GitHub project already has an earlier v0.1 scaffold and two license files. For a clean upgrade:

1. Make a **backup** of the repository or work on a new branch.
2. Use **GitHub Desktop** (or a regular Git clone) to pull the existing repository to your PC. This is for file management only; **no compiling or PowerShell is required**.
3. Unzip this package, then **copy the contents** (including hidden `.github`) into the **root** of the cloned `Jellyfin-Franchise-Explorer` folder and overwrite matching files. Do not create an extra wrapper directory inside the repo.
4. Remove obsolete `LICENSE.txt` (the requested license is already in the root `LICENSE`). Remove obsolete `src/Jellyfin.Plugin.FranchiseExplorer/Models/MediaReference.cs` from the old scaffold if it exists. Keep the new `MediaLink.cs`.
5. Check GitHub Desktop's Changes list; commit and push. This only updates GitHub source, **not** your Jellyfin Windows service.
6. Verify the `.github/workflows` files and `manifest.json` appear in GitHub. `manifest.json` should still read `[]` until a verified, manually published release.
7. Watch the **Actions → Build and validate** workflow. If it fails, share the full failure log. **Do not release or install** until it passes and a separate host test is complete.

GitHub's web upload UI may refuse to overwrite pre-existing files, so GitHub Desktop is the least confusing option for the one-time repository replacement. Once GitHub Actions is configured, users install future verified releases through Jellyfin's standard plugin catalog — no local .NET SDK needed.
