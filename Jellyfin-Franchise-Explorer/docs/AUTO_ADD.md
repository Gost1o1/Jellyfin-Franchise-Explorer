# Auto-Add Franchise — 0.8.9.22

Open **Franchise setup & IMDb changes** above the manual editor.

1. Choose **Existing franchise** to select a franchise you already created, or **Auto-Add from IMDb** to enter a new franchise name and IMDb list URL. The MCU URL is available as the initial example. A new franchise is staged only; opening a preview does not save or create it.
2. Open **Source URLs, categories and priority** when you need multiple URLs, per-source enable/disable, category assignment or priority. Lower numbers run first; up/down controls break ties. Duplicate URLs are rejected after normalization. Disabled sources retain their URLs and display grey text without strikethrough.
3. Click **Preview changes**. The review separates **Additions**, **Removals**, and **Missing / needs review**. All proposed changes are checked by default. Use Select all/Clear selection, uncheck individual titles, or expand a compact episode range to choose its individual episodes. Missing or ambiguous titles cannot be added.
4. Click **Apply selected changes**. This saves the checked changes to plugin configuration. A failed save leaves the editor model and stored data unchanged and the selection available for retry. The top **Save plugin configuration** button remains available for ordinary manual editing and source-setting edits.

The preview matches visible Jellyfin items by IMDb ID first. Title/year fallback requires an exact normalized title/year, compatible type, and no conflicting IMDb ID. Episodes and unknown source types require exact IDs. Parent shows and reliable season/episode numbers must be available before episode ranges can be imported. Source failures remain visible in the review and cannot generate removals.

Removal proposals are limited to unchanged references whose Auto-Add ownership is recorded and whose enabled sources were fetched successfully. Manual references, edited/moved/reordered Auto-Add references, and older imports without ownership metadata remain protected. Disabling or removing a source does not delete prior imports. A library title missing during preview is not treated as a removal from its IMDb source. Verified empty source lists can propose removal of unchanged owned references; nothing is removed without Apply.

When a source changes within an owned episode range, the review proposes removing that old range and adding the surviving ranges. Keeping the old range disables overlapping additions. Replacement ranges retain source order around existing titles. No original media, artwork or native Jellyfin collection is deleted. Exports/imports and XML saves retain ownership metadata; old XML initializes it as an empty list without a destructive migration.

Each franchise supports up to 30 sources. When several enabled sources contain the same title, the highest-priority source owns its order/category assignment. Changing a source invalidates the preview. CamelCase and PascalCase host responses are supported.

New franchises have Chronological Timeline, Movies, TV Shows, Collections, and Other presentation rows. IMDb does not define Jellyfin collections: Collections remains available for virtual references to existing BoxSets. No native collections, placeholder media, files, or original artwork are created or modified. Explicit source positions establish list order. TV Shows displays one whole-show card per series, with its seasons and episodes available through the normal Jellyfin show page. Its presentation reference is independent of chronological ranges. Whole-show chronology still requires manually configured ranges when the source provides only a show title. Individually listed episodes match only by exact IMDb IDs. Preview also requires the existing parent show and reliable Jellyfin season/episode numbers. New imports create parent-show episode ranges: for example, consecutive S01E01, S01E02 and S01E03 become one S01E01–S01E03 reference. These ranges resolve to the exact matched episodes during playback. A movie, different show, season change, missing/unmatched episode, source change or numbering gap breaks the range. This does not infer chronology from episode titles, release years, or missing data. IMDb source order is not independent verification of in-universe chronology.

Rerunning previews compares existing item IDs across the franchise and its subgroups, treating compact and dashed Jellyfin GUIDs as the same identity. Existing manual whole-show/range references are preserved, and covered episodes are not imported again. New ranges append without extending or rewriting existing references. Older flat Auto-Add rows are grouped only for display: TV Shows coalesces episodes into show cards, and chronological rows display adjacent episodes as ranges. Their original saved reference IDs, queue keys and watched history remain unchanged. This also respects custom ordering and renamed category rows. Imports never move or reorder existing references, edit their row memberships, or change artwork overrides. Stable category-row identities respect manual row renames and deletions. New references append to compatible rows. Removed links can be imported again; removing a source does not undo prior imports.

## IMDb retrieval

The Jellyfin host must permit HTTPS to **`api.graphql.imdb.com`**. Source URLs remain normal `https://www.imdb.com/list/ls…/` links, but retrieval uses IMDb's public GraphQL list operation. This works even when IMDb's HTML page returns HTTP 403, as observed in the live cloud check. No cookies, account tokens, HTML challenges, or anti-bot bypasses are used. Kometa's public integration was used as a reference for the public list operation; no Plex configuration or Kometa runtime dependency is required.

The adapter requests explicit `LIST_ORDER` ascending sorting and follows all cursor pages. It verifies consistent total counts, unique explicit positions, advancing cursors, and complete results before returning a list. Responses are bounded to 8 MB per page, 30 pages/3,000 entries and a 35-second total retrieval deadline. Rate limits, HTTP errors, private/unavailable lists, expired operations, malformed responses, stalled pagination and incomplete results fail visibly without partial imports. Unsupported or missing chronology is never filled in.

IMDb's public `TitleListMainPage` operation identifier is pinned in `Api/ImdbListClient.cs`; it can change upstream. Expired/forbidden operations are reported rather than silently using stale source data. Live availability is an observation, not a guarantee that IMDb will allow every host indefinitely. If retrieval fails on a particular Jellyfin host, inspect its server log and outbound API access, then retry or use manual linking.

## Validation

Offline checks:

- `node scripts/test_autoadd.js`
- `python3 scripts/test_autoadd_browser.py` (Playwright + Chromium)
- `node scripts/test_autoadd_grouping.js`
- `node scripts/test_autoadd_changes.js`
- `python3 scripts/test_autoadd_grouping_browser.py`
- `python3 scripts/test_autoadd_review_browser.py`
- `python3 scripts/test_home_recovery_browser.py`
- `dotnet run --project tests/AutoAdd.Tests -c Release`
- All Python `scripts/test_*.py`, Node `scripts/*.js`, and repository/version checks.

Opt-in live check, with .NET 10 on PATH:

```sh
python3 scripts/verify_imdb_live.py
```

This calls the actual plugin controller against IMDb and feeds its real response into Chromium's preview/apply/save workflow with a simulated library. It verified all 571 entries in the MCU source, exact movie/episode matching, and preview-only missing titles. It does not test a running Jellyfin server or physical playback. A controller-only check is also available with `dotnet run --project tests/AutoAdd.Tests -c Release -- --live`.

Use a disposable Jellyfin 12.2 instance for plugin-loader and playback integration. Desktop playback selection, launch, queue, and watch-history algorithms are unchanged. Existing Android-only queue behavior is retained; no physical-device playback fix is claimed.

The published catalog in root `manifest.json` intentionally continues to reference the last actual released archive. The release workflow defaults to 0.8.9.22 and generates the new catalog checksum from a real DLL ZIP only after an approved release; no catalog checksum is fabricated for an unpublished version.
