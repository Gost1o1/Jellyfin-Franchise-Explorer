# Safe testing (Windows service, Jellyfin 12.2)

**Do not install this experimental plugin on your primary server until you have a tested backup and a successful isolated test.**

1. Confirm the GitHub Actions **Build and validate** workflow is green. This checks compilation but **does not test** Jellyfin's plugin-loader or database safety.
2. Set up a disposable Jellyfin 12.2 installation with its own data directory and dummy media.
3. Before any test, back up Jellyfin's full data/configuration directories and verify restore works. A simple media-folder backup alone is not enough.
4. Only after the release is published and the manifest contains a real entry, add this URL in Dashboard → Plugins → Repositories:
   `https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`
5. Install **Franchise Explorer**, restart the disposable instance and check its logs for assembly-load errors.
6. Open Dashboard → Plugins → Franchise Explorer configuration page. Add a demo hierarchy, save, restart the test instance, and verify your groups persist.
7. Export JSON, delete a virtual group, save, and confirm no original Jellyfin collection or file has changed.
8. Uninstall and verify server startup; retain the backup for rollback.

Uninstallation may leave plugin configuration data behind; refer to Jellyfin's documented plugin-management behavior. Test backup/restore and removal procedures on a disposable instance first.

**v0.2 limitations:** the plugin can only store IDs and images as text references. It does not resolve whether those IDs point to accessible media or display artwork, and it does not create a native user-facing franchise category.
