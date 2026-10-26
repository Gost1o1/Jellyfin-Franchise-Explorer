# Upgrading v0.2 to v0.3 safely

You already have Franchise Explorer v0.2 installed and a successful saved group test. This upgrade should preserve the same plugin configuration keys and GUID.

### Before GitHub

1. In Jellyfin, open Franchise Explorer's settings and **Export backup JSON**; store that file away from the Jellyfin server.
2. Back up the Jellyfin data/configuration folders before changing installed plugins.
3. This ZIP is a **repository source package**, not a plugin you upload into Jellyfin. Do not point Jellyfin at this ZIP.

### Update GitHub without nested workflow folders

Use GitHub Desktop to clone/open `Gost1o1/Jellyfin-Franchise-Explorer`, then copy the extracted files **into the local repository's root**, keeping the `.github` folder. Replace matching source files. Do not create a `.github` folder inside another `.github/workflows` folder. Commit and **Push origin**.

Double-check these exact links, which must resolve after uploading:

- https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/blob/main/.github/workflows/build.yml
- https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/blob/main/.github/workflows/release.yml
- https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/blob/main/src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html

### Build, publish, upgrade

1. Open GitHub **Actions > Build and validate**. A green checkmark is required for publication.
2. Open **Actions > Publish experimental release**, select `main`, enter version **`0.3.0.0`** and confirmation **`RELEASE_EXPERIMENTAL`**, then click **Run workflow**.
3. Verify the release appears at https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/releases and `manifest.json` has both `0.3.0.0` and `0.2.0.0`.
4. In Jellyfin **Dashboard > Plugins**, choose the newer version from the plugin's Catalog listing or update controls as available, then restart the Jellyfin Windows service and hard-refresh the web client.
5. Confirm the original groups remain after upgrading; try searching an item title and linking it to a test subgroup, then save and refresh.

### Rollback

If the v0.3 settings page fails, use the backed-up configuration and your original v0.2 release to roll back. Do not remove the plugin data or attempt to reinitialize its configuration before making backups. A previous version's DLL may be incompatible with configuration created by later versions; v0.3 intentionally does not add new configuration properties to reduce that risk.
