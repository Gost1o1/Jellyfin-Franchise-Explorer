# v0.7.2.0 — Position My Media tile and preserve collection artwork

> EXPERIMENTAL. Back up your Jellyfin configuration, franchise JSON, and plugin artwork.

## Changes

- Web-only My Media tile is inserted **immediately after Collections**, not at the end. Other Jellyfin library cards retain their order. If Collections is missing from the user’s libraries, Franchises falls back to the end.
- Connecting a different Jellyfin collection defaults to **Preserve current artwork**. Existing associated collections retain their old **Use collection artwork first** behavior until deliberately changed.
- Explicit selector toggles artwork resolution between inherited parent/media first and associated collection first. Upload overrides are never replaced.
- **+ Same-level group** adds a sibling of the selected phase/era/collection, matching its type; **+ Subgroup** nests within the selected group. The sidebar and artwork scope label now update while you type the new name.

## Installation

1. Export the plugin backup JSON and back up its artwork directory and Jellyfin configuration.
2. Copy this repository's files into the GitHub repository root. **Do not overwrite `manifest.json`** with an older local catalog snapshot. Keep both `.github/workflows` files in the correct folder.
3. Commit/push and inspect **Build and validate**.
4. Use **Publish experimental release** with `0.7.2.0` and `RELEASE_EXPERIMENTAL` only once. Verify tag/assets/manifest before any repeat.
5. Update the plugin in Jellyfin, restart its Windows service, and hard-refresh Jellyfin Web.
6. For JavaScript Injector users who installed a manual tile script: disable/remove the old *manual* script if the automatically registered script is active. New versions re-register the same script ID, updating it in place.

No filesystem moves, native collection modifications, or extra Jellyfin libraries. The tile remains Jellyfin-Web-only; the actual native TV apps do not inherit it.
