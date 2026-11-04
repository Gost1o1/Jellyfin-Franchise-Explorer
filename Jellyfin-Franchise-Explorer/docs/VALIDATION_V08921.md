# v0.8.9.21 review and validation

Work remains on `feature/franchise-auto-add-v0.8.9.21`, based on commit `b11638f09c85f43db93a59389c377cad89352038`. The starting checkout was clean. The supplied v0.8.9.20 source ZIP matched 161 files byte-for-byte; its only differing tracked file was root `manifest.json`, whose actual published catalog entry was retained. An archive-only screenshot temporary file was excluded. No real Jellyfin configuration, media, artwork or watched data was modified.

## Current results

- **All 65 Python/Node commands passed**: 63 script/repository/version checks and two Node syntax checks. No historical tests are skipped or counted as expected failures.
- The updated GitHub build workflow's **55 Python/Node commands are covered by that passing run**. This is local execution, not a claim that GitHub Actions ran remotely.
- **Release build passed with zero warnings and errors**, using .NET SDK 10.0.403, targeting net10.0/Jellyfin 12.2.0.
- **.NET assertion harness passed**: JSON-LD compatibility parsing, URL safety, old XML defaults, source and category-row persistence; explicit API sorting, cursor pagination, episode metadata, HTTP 403/429, GraphQL errors, private lists, incomplete responses, repeated cursors, duplicate positions and size/count limits.
- **Live IMDb controller retrieval passed: 571 MCU entries**, with explicit list positions and all pagination completed. First title: Captain America: The First Avenger.
- **Live IMDb-to-editor browser check passed**: real data from that controller was fed into Chromium's preview/apply/save workflow with a simulated Jellyfin library. An exact-ID movie and episode matched; missing titles remained preview-only; two actual-library references entered the virtual timeline and were saved. The library was mocked; this was not a running Jellyfin host.
- **Auto-Add browser and engine checks passed**, including PascalCase/camelCase DTOs, source styling/persistence, priorities, deduplication, dashed/compact GUID identity, exact episode matching, renamed/deleted rows, rerun idempotency, preservation of manual show/range assignments, source failures and no placeholder entries.
- **Home recovery browser check passed**: visible failed request, Retry, confirmed empty, and later successful card rendering.
- Existing desktop-isolation, Android Integrated Player/queue, timeline, notification, layout, artwork and native-row filtering checks passed.
- Source inventory, version consistency and `git diff --check` passed. The review patch is checked against the unchanged v0.8.9.20 baseline. The source ZIP includes hidden `.github/workflows`, excludes Git metadata/build caches/credentials, and passes ZIP integrity validation.

Counts describe executed commands, not individual assertions. Offline suites use synthetic media metadata. Live source access is separately identified above.

## Six formerly failing tests

These failures also existed in v0.8.9.20. Their fixtures now exercise the current behavior without reintroducing obsolete UI/playback paths:

| Script | Correction and assertions |
| --- | --- |
| `test_autonext_browser.py` | Use a real test origin for sessionStorage. Verify the native Home quick-play request, next-item intent, and refusal for missing completion/wrong session/unrelated playback. Assert no activation or completion without observed playback. |
| `test_card_navigation_v081.py` | Verify subtitle defaults through the current playback preference, stable delayed row order, distinct information controls, and native delegated itemAction launch with restart offset zero and no Details navigation. |
| `test_local_web_handoff.py` | Simulate the current native Home shortcut, visible local video and matching advancing session. Assert one activation only after verification; an ineffective native click leaves history unchanged and the retry intent intact. |
| `test_timeline_browser.py` | Select the remote session explicitly instead of relying on the local-playback default. Preserve episode-range resolution, remote playback observation, replay history, and responsive layout assertions. |
| `test_live_ui_browser.py` | Add and edit episode ranges through visible row library search instead of the hidden legacy main-link search. Preserve modal add/edit/Escape and responsive layout checks. |
| `test_v072_regressions.py` | Create the subgroup through the visible parent/Subgroup workflow instead of the hidden same-level button. Preserve parent relationship, type, live renaming, artwork mode and save assertions. |

All six are included in the browser CI job. None requires modifying desktop playback algorithms or relaxing playback verification.

## IMDb retrieval fix

Ordinary requests to the IMDb HTML list page, including browser headers and its export endpoint, reached IMDb but returned HTTP 403. The environment's current network policy permits those requests; this was an upstream website denial.

IMDb's **public GraphQL endpoint (`api.graphql.imdb.com`) successfully returned the list**. `Api/ImdbListClient.cs` uses its public `TitleListMainPage` operation with explicit ascending `LIST_ORDER` sorting. Kometa's public integration was consulted as a reference; no Plex configuration, third-party runtime code, account credentials, HTML challenges or anti-bot bypasses are used.

The adapter follows all cursor pages and verifies totals, cursor progress, explicit positions and completeness before returning a preview. Partial/error/private responses never become partial imports. The public operation identifier is pinned and can change upstream; failures remain visible and logged. The host must permit outbound HTTPS to `api.graphql.imdb.com`.

The source contains individual episodes. They require exact IMDb/provider IDs and use their existing Jellyfin episode IDs directly; no title/year episode guessing, fabricated chronology or placeholder episodes are introduced. Whole-show ranges remain manual. Source order is verified list order, not independent proof of in-universe chronology.

Reproduce the opt-in live check with .NET 10 on PATH:

```sh
python3 scripts/verify_imdb_live.py
```

A controller-only live check is also available:

```sh
dotnet run --project tests/AutoAdd.Tests -c Release -- --live
```

## Main changed files

- `Models/FranchiseSource.cs`, `Models/FranchiseNode.cs`: additive XML source settings and stable presentation-row identities.
- `Api/FranchiseAutoAddController.cs`, `Api/ImdbListClient.cs`: elevated/admin-only retrieval, bounded paginated public-list transport, validation and logged failures.
- `Configuration/configPage.html`: source controls, priority/category assignments, matching preview, exact episode imports, atomic local apply, persistent settings and existing top Save button.
- `Web/franchise-my-media.js`: bounded Home tracker requests, retryable failure state, current version identifiers and five-second notices. `browsePage.html` and `franchise-timeline.js`: notice duration only. Desktop playback selection, launch, routing, queue and history algorithms remain unchanged.
- Existing and new JavaScript/browser/.NET tests, `.github/workflows`, current-version assertions and documentation. The release workflow defaults to 0.8.9.21; root catalog still references the last actual published release until a new real DLL archive is approved and published.

## Remaining host-only checks and release status

A disposable Jellyfin 12.2 host must still verify plugin loading, real configuration save/restart, actual library provider IDs/permissions, row presentation, and absence of media/artwork/native-collection changes. Physical Android must still verify the reported Captain America → Agent Carter handoff and observed playback before history advances. Live desktop/Android playback is **unverified**; existing Android-only queue behavior is retained.

This source change does not create a tag or publish a release. The branch and pull request are for review; merging and release publication remain separate actions. Validation outcomes and the live-verification procedure are documented above.
