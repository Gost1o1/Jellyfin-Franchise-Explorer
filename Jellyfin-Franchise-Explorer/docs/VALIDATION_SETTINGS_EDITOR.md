# Settings editor integration validation

The approved settings UI is integrated with the production plugin. Source is now prepared as version 0.8.9.24; a successful manual release workflow is still required to publish its ZIP and update the catalog manifest.

## Passed checks

- .NET 10 Release build against Jellyfin 12.2.0: **zero warnings, zero errors**.
- C# executable tests: IMDb parsing and transport errors/pagination; configuration XML migration; row-source ownership and artwork XML persistence; immutable uploads; invalid upload rejection; video capabilities, access denial and revocation; authenticated subtitle enrollment, selected media versions, actual stream indices, pre-negotiation overrides, immutable responses, scope isolation and expiry.
- Static, model and playback checks from the build workflow and the release-only direct-Home regression. The generated settings resource matches its source modules.
- Browser scripts in the build workflow use mocked Jellyfin APIs. The production settings browser test additionally checks horizontal franchise dragging, row reordering, keyboard placement, nested-group settings and plus-button creation, transactional Cancel/Save/Undo, fixed search types, TV ranges, artwork scopes, uploads, video selection, manual-title deduplication, accurate review destinations, save conflicts and 390/320 px action alignment.
- Media ordering regression: mouse, real Chromium touch events and keyboard placement within every media row category and nested subgroups; popup dragging and long-list scrolling; secondary-pointer isolation, cancellation and no-op drops; Undo and Save/full-page reload; unchanged memberships, reference IDs, ranges, artwork, global positions and sibling rows. A timeline regression verifies that the new order resolves correctly while preserving cursor identity, position and completed history.
- Mobile regression: existing and newly added media reorder inside the same row at 390/320 px; 44 px handles, inline action bounds, initial popup focus and manually tapping search.
- Subtitle client regressions: saved Off overrides stale launch preferences; actual On stream indices/languages; authenticated enrollment before Web/Android launch; failure blocks launch; native queues and remote PlayLast source isolation; current-device event scoping; rapid preference changes and stale text-track timers.
- Settings switch regression: On → Off saves zero, updates the label and ARIA state, disables language selection, and emits the change after persistence; active API session resolution, alternate GUID formats, deferred sessions, preference-key aliases, account isolation, label activation and visible storage failures.
- Live IMDb controller retrieval: **571** entries from `ls539646485`, with explicit order and complete pagination. Those real results passed through the new production editor's preview, staged application and save against a simulated Jellyfin library. Exact-ID movie and episode matches imported successfully; missing titles remained review-only.
- Repository completeness and `git diff --check`.

The settings core tests include independent row sources with the same media or IMDb URL, preservation of manual edits, old ownership signatures, and destination-specific adjacent episode ranges.

## Reproduce

From `Jellyfin-Franchise-Explorer/`:

```sh
python3 scripts/build_settings_page.py --check
node scripts/test_settings_core.js
node scripts/test_playback_subtitles.js
node scripts/test_v08916_jellyfin_subtitle_inheritance.js
python3 scripts/check_repo.py
python3 scripts/check_repository_completeness.py
dotnet build src/Jellyfin.Plugin.FranchiseExplorer -c Release
dotnet run --project tests/AutoAdd.Tests -c Release
python3 scripts/test_settings_v9_browser.py
python3 scripts/test_viewer_preferences_browser.py
python3 scripts/test_media_ordering_browser.py
```

The browser test needs Playwright and Chromium. It writes a screenshot to the temporary directory, or to `FE_TEST_ARTIFACTS` when set. The workflows contain the remaining regression commands.

The separate opt-in network check is:

```sh
python3 scripts/verify_imdb_live.py
```

Historical settings-only scripts target the earlier editor's selectors. Their workflow entries were replaced by tests of the new production page and model; the scripts remain available as historical references. Shared playback and browser regression checks remain active.

## Remaining host validation

No running Jellyfin server was available for this integration. Dashboard page insertion, real plugin configuration persistence, library access policies, uploads into a real server data directory and browser video decoding still need testing on the target Jellyfin 12.2 installation. The live IMDb check verifies external retrieval while simulating Jellyfin's library and configuration endpoints. Browser mocks and controller tests do not establish end-to-end playback compatibility.

The subtitle integration was checked against Jellyfin MediaInfo controller/authentication and Android 2.7.3 player source contracts. Physical Android playback remains unverified. Android 2.7.3's integrated-player subtitle-change method is empty and its WebView pauses during native playback; its switch is enforced at launch and subsequent queue negotiation, while changes to an already-running native stream cannot be guaranteed.

Associated video backdrops support accessible local MP4/WebM files without transcoding. Clearing an uploaded artwork override leaves the immutable asset on disk. The release version is 0.8.9.24; test installations should replace the existing plugin DLL rather than load two copies of the plugin assembly.
