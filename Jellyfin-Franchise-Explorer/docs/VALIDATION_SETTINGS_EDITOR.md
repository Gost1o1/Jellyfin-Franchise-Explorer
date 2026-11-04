# Settings editor integration validation

This change integrates the approved settings UI with the production plugin. It does not publish a release, change the plugin version or update the catalog manifest.

## Passed checks

- .NET 10 Release build against Jellyfin 12.2.0: **zero warnings, zero errors**.
- C# executable tests: IMDb parsing and transport errors/pagination; configuration XML migration; row-source ownership and artwork XML persistence; immutable uploads; invalid upload rejection; video capabilities, access denial and revocation.
- **33** static, model and playback checks in total: the build workflow's checks and the release-only direct-Home regression. The generated settings resource matches its source modules.
- All **15** browser scripts in the build workflow, using mocked Jellyfin APIs. The production settings browser test additionally checks horizontal franchise dragging, row reordering, keyboard placement, nested-group settings and plus-button creation, transactional Cancel/Save/Undo, fixed search types, TV ranges, artwork scopes, uploads, video selection, manual-title deduplication, accurate review destinations, save conflicts and 390/320 px action alignment.
- Live IMDb controller retrieval: **571** entries from `ls539646485`, with explicit order and complete pagination. Those real results passed through the new production editor's preview, staged application and save against a simulated Jellyfin library. Exact-ID movie and episode matches imported successfully; missing titles remained review-only.
- Repository completeness and `git diff --check`.

The settings core tests include independent row sources with the same media or IMDb URL, preservation of manual edits, old ownership signatures, and destination-specific adjacent episode ranges.

## Reproduce

From `Jellyfin-Franchise-Explorer/`:

```sh
python3 scripts/build_settings_page.py --check
node scripts/test_settings_core.js
python3 scripts/check_repo.py
python3 scripts/check_repository_completeness.py
dotnet build src/Jellyfin.Plugin.FranchiseExplorer -c Release
dotnet run --project tests/AutoAdd.Tests -c Release
python3 scripts/test_settings_v9_browser.py
```

The browser test needs Playwright and Chromium. It writes a screenshot to the temporary directory, or to `FE_TEST_ARTIFACTS` when set. The workflows contain the remaining regression commands.

The separate opt-in network check is:

```sh
python3 scripts/verify_imdb_live.py
```

Historical settings-only scripts target the earlier editor's selectors. Their workflow entries were replaced by tests of the new production page and model; the scripts remain available as historical references. Shared playback and browser regression checks remain active.

## Remaining host validation

No running Jellyfin server was available for this integration. Dashboard page insertion, real plugin configuration persistence, library access policies, uploads into a real server data directory and browser video decoding still need testing on the target Jellyfin 12.2 installation. The live IMDb check verifies external retrieval while simulating Jellyfin's library and configuration endpoints. Browser mocks and controller tests do not establish end-to-end playback compatibility.

Associated video backdrops support accessible local MP4/WebM files without transcoding. Clearing an uploaded artwork override leaves the immutable asset on disk. The existing release version is retained for review builds; deployment should replace the existing test DLL in an isolated installation rather than install two copies of the same plugin assembly.
