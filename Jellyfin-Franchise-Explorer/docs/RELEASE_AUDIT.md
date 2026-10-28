# v0.8.6.0 pre-publish audit notes

- **Verified baseline**: the latest user-uploaded GitHub repository ZIP, supplemented with the previous v0.8.5.0 source update package. That ZIP contained all 79 v0.8.5 expected paths, but the two workflow files were older. It also included `Models/MediaReference.cs`, which this source package preserves.
- **Not verified**: the user's manual edits to the **live** GitHub workflows after their last ZIP upload. Live GitHub content could not be retrieved from this environment.
- **Source changes**: root README simplified; code/tests/docs/examples relocated into `Jellyfin-Franchise-Explorer/`; workflows remain at root `.github/workflows/` and use the new paths; native card layout no longer forces measured dimensions; stale browser test selectors corrected.
- **Manifest preservation**: `manifest.json` is deliberately absent from the upgrade ZIP. It must already be present in the existing Git clone and is only changed by the approved release workflow after a successful release.
- **Local verification**: static repository tests, JavaScript tests, YAML parsing and browser mock sizing/layout checks passed in this sandbox. No .NET SDK or authenticated Jellyfin 12.2 server is available here for integration testing.
- **Publishing gate**: after applying source update, confirm both Build and validate GitHub Actions jobs pass; check the source tree contains all expected files before manually publishing v0.8.6.0. Do not publish a release if either build or UI tests fail.

## Browser card geometry rationale

Jellyfin's My Media cards are responsive; card dimensions are controlled by their `.card` and `.cardBox` scaffolding plus theme layout. A clone inherits those rules. Applying a measured outer width as an inline CSS width can double-count padding/margins and shift the next card. The fixed plugin only synchronizes explicit inline size overrides, not calculated outer dimensions.
