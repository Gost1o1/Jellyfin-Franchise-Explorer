# Auto-Add Franchise — 0.8.9.21

Open the Auto-Add Franchise panel above the editor. Create the MCU preset, or select an existing top-level franchise. The preset uses https://www.imdb.com/list/ls539646485/. Rename a new franchise before creating it, then replace its sources as appropriate.

Each franchise stores up to 30 IMDb list URLs in its plugin XML configuration. Add/edit/remove sources, enable or disable them, assign multiple presentation categories, and adjust priority. Lower priority numbers run first; up/down controls resolve equal-priority ties. Duplicate URLs are rejected after URL normalization. When titles occur in several sources, the highest-priority enabled source owns their order and category assignments. Disabling a source retains its URL and settings; text becomes grey without strikethrough. Re-enabling restores normal brightness.

Preview retrieves public lists through an administrator-only server endpoint and scans the administrator's visible Jellyfin movies, shows, collections, and (when sources contain them) episodes. IMDb ID matches take precedence. Title/year matching requires an exact normalized title and year, a compatible known type, and no conflicting IMDb ID. Episodes and unknown source types require exact IMDb IDs, with no title/year fallback. Multiple candidates are ambiguous and never applied. Missing titles remain preview-only. Source failures are displayed individually and logged; other sources can still be previewed. Changing a source invalidates the preview. Response casing is normalized for Jellyfin hosts returning camelCase or PascalCase DTO properties.

Apply matched titles locally, inspect the resulting editor, then use **Save plugin configuration** in the top toolbar. Apply does not save automatically. Backups/export/import include source settings. Existing XML without sources loads with an empty list; no destructive migration is required. Disabling or removing a source never removes previously imported links.

New franchises have Chronological Timeline, Movies, TV Shows, Collections, and Other presentation rows. IMDb does not define Jellyfin collections: Collections remains available for virtual references to existing BoxSets. No native collections, placeholder media, files, or original artwork are created or modified. Explicit source positions establish list order. Whole shows still need manually configured episode ranges and chronology. Individually listed episodes can enter the timeline only when their exact IMDb IDs match actual library episodes; their existing Jellyfin episode IDs are referenced directly. This does not infer chronology from episode titles, release years, or missing data. IMDb source order is not independent verification of in-universe chronology.

Rerunning imports skips existing item IDs across the franchise and all its subgroups, treating compact and dashed Jellyfin GUIDs as the same identity. Existing manual whole-show/range references are preserved, and their episodes are not implicitly imported as duplicate direct links. Imports never move or reorder existing references, edit their row memberships, or change artwork overrides. Stable category-row identities respect manual row renames and deletions. New references append to compatible rows. Removed links can be imported again; removing a source does not undo prior imports.

## IMDb retrieval

The Jellyfin host must permit HTTPS to **`api.graphql.imdb.com`**. Source URLs remain normal `https://www.imdb.com/list/ls…/` links, but retrieval uses IMDb's public GraphQL list operation. This works even when IMDb's HTML page returns HTTP 403, as observed in the live cloud check. No cookies, account tokens, HTML challenges, or anti-bot bypasses are used. Kometa's public integration was used as a reference for the public list operation; no Plex configuration or Kometa runtime dependency is required.

The adapter requests explicit `LIST_ORDER` ascending sorting and follows all cursor pages. It verifies consistent total counts, unique explicit positions, advancing cursors, and complete results before returning a list. Responses are bounded to 8 MB per page, 30 pages/3,000 entries and a 35-second total retrieval deadline. Rate limits, HTTP errors, private/unavailable lists, expired operations, malformed responses, stalled pagination and incomplete results fail visibly without partial imports. Unsupported or missing chronology is never filled in.

IMDb's public `TitleListMainPage` operation identifier is pinned in `Api/ImdbListClient.cs`; it can change upstream. Expired/forbidden operations are reported rather than silently using stale source data. Live availability is an observation, not a guarantee that IMDb will allow every host indefinitely. If retrieval fails on a particular Jellyfin host, inspect its server log and outbound API access, then retry or use manual linking.

## Validation

Offline checks:

- `node scripts/test_autoadd.js`
- `python3 scripts/test_autoadd_browser.py` (Playwright + Chromium)
- `python3 scripts/test_home_recovery_browser.py`
- `dotnet run --project tests/AutoAdd.Tests -c Release`
- All Python `scripts/test_*.py`, Node `scripts/*.js`, and repository/version checks.

Opt-in live check, with .NET 10 on PATH:

```sh
python3 scripts/verify_imdb_live.py
```

This calls the actual plugin controller against IMDb and feeds its real response into Chromium's preview/apply/save workflow with a simulated library. It verified all 571 entries in the MCU source, exact movie/episode matching, and preview-only missing titles. It does not test a running Jellyfin server or physical playback. A controller-only check is also available with `dotnet run --project tests/AutoAdd.Tests -c Release -- --live`.

Use a disposable Jellyfin 12.2 instance for plugin-loader and playback integration. Desktop playback selection, launch, queue, and watch-history algorithms are unchanged. Existing Android-only queue behavior is retained; no physical-device playback fix is claimed.

The published catalog in root `manifest.json` intentionally continues to reference the last actual released archive. The release workflow defaults to 0.8.9.21 and generates the new catalog checksum from a real DLL ZIP only after an approved release; no catalog checksum is fabricated for an unpublished version.
