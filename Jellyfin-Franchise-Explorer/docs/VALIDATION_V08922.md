# v0.8.9.22 — reviewed Auto-Add changes and grouped shows

Prepared on `feature/auto-add-show-grouping-v0.8.9.22`, based on published v0.8.9.21/main commit `560d896`. The published v0.8.9.21 catalog entry is retained. No release is published by this change.

## Resulting workflow

- Choose a manually created **Existing franchise**, or **Auto-Add from IMDb** with a new name and URL. A preview never creates or saves a franchise.
- Review **Additions**, **Removals**, and **Missing / needs review**. Proposed changes are selected by default. Compact range checkboxes can be expanded to choose individual episodes; Select all and Clear selection are supported.
- **Apply selected changes** saves the selected changes. Failed saves leave stored/editor data unchanged and the selection available for retry. The top Save button remains for manual editing.
- Removals are restricted to unchanged references with recorded Auto-Add ownership. Manual, edited, moved, reordered and older references without ownership metadata stay protected. Failed/disabled/removed sources and missing library titles cannot generate removals. Keeping an old range disables overlapping replacement additions.
- TV Shows contains one full-show card per series, opening its normal Jellyfin seasons/episodes page. New chronological imports combine consecutive verified episodes into ranges such as S01E01–S01E03. Movies, gaps, unmatched entries, season/show/source changes and excluded episodes split ranges.
- Older flat Auto-Add rows group only for display; saved references, queue keys and watched-state records remain unchanged. Progress decorations match the original episode sources. New range references resolve to exactly the original episode/movie sequence.

## Checks and evidence

- A complete run of **69 Python/Node commands passed**: all script/repository/version checks plus both JavaScript syntax checks. No test was disabled or marked expected-failure. The updated workflow contains 59 of those commands.
- Subsequent focused browser checks passed for the later new-franchise identity fix, valid Jellyfin item-field parameters, dependent replacement checkboxes and failed-save retry. A repeated full-suite run was interrupted; it was not counted as another completed run.
- Release compilation and the .NET assertion harness passed. XML coverage includes source settings, legacy defaults, category rows and removal-ownership records. Transport coverage includes pagination, explicit sorting, HTTP 403/429, GraphQL errors, private lists, verified empty lists, incomplete pages, repeated cursors, duplicate positions and limits.
- The opt-in **live IMDb-to-editor check passed with all 571 MCU entries**. The plugin controller retrieved real IMDb data; Chromium then matched, previewed and saved virtual movie/show-range references using a simulated Jellyfin library. A real Jellyfin server was not used.
- New grouping engine tests cover show deduplication, contiguous ranges, gaps/interruptions/seasons, missing metadata, manual ranges, repeated imports and exact queue resolution. New browser tests cover new/grouped and legacy-flat rows, watched-key preservation, progress display and show navigation.
- New change-review tests cover existing/new modes, no writes during preview, default/individual selections, safe removals, manual edit protection, source failures, XML/save/reload ownership, automated row shifts, range replacement order and atomic failed-save behavior.
- Inspection of Jellyfin 12.2's actual `ItemFields` enum confirmed that `ProductionYear` and `SeriesInfo` are not valid requested fields. Auto-Add now requests only `ProviderIds`; ordinary title/year/series/episode DTO properties provide the other metadata. A browser fixture rejects unsupported field parameters.
- Browser fixtures use system Chromium when available and fall back to Playwright's installed browser in GitHub Actions.
- Source/version/inventory checks and `git diff --check` passed. The source archive includes `.github/workflows` and excludes Git metadata, dependencies, build outputs and credentials.

Command counts describe runner outcomes, not individual assertions. Raw outcomes and the live check log accompany the source package. The optional live command is `python3 scripts/verify_imdb_live.py` with .NET 10 on PATH.

## Uploaded log

The supplied log records HTTP 429 responses during award-logo CDN refreshes, with stale cached assets used where available. Its components include CDN, Awards, TagCache and watchlist/request integrations. It contains no Franchise Explorer or IMDb error entries. This evidence does not establish a connection to Auto-Add; no unrelated CDN/plugin configuration was changed. The original user log is not included in the repository/package.

## Scope and remaining host checks

The editor, catalog presentation, ownership model, release identifiers, workflows, tests and documentation changed. The timeline client's only added logic concerns progress decoration for visually grouped legacy references; playback selection, launching, Android/desktop routing and completion/activation algorithms are unchanged. Original media, artwork, native collections and Jellyfin watched flags are never modified by Auto-Add.

A disposable Jellyfin 12.2 host must still verify plugin loading, real configuration save/restart and library permissions/provider metadata. Real desktop and physical Android playback remain unverified. Live IMDb availability was observed from this environment; its public API operation can change upstream and failures are reported without partial imports.

This branch is for pull-request review. Merging and publishing v0.8.9.22 remain separate actions.
