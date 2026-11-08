# Version 0.8.9.25 validation

This source prepares the approved episode-selection and reusable IMDb-list UI. It does not publish a release or change the catalog manifest.

## Automated checks

- 37 build-workflow, release-only and version checks, including the episode-format model suite.
- 20 browser scripts: the existing 17 regressions plus specific episodes, IMDb list/episode-format editing and browse presentation.
- Five C# suites covering IMDb parsing/transport, artwork, subtitles and configuration persistence. Release compilation succeeds; local restores reported NU1900 when NuGet vulnerability metadata was unreachable.
- Generated resource consistency, repository completeness and whitespace checks.

Specific episodes use real-shaped Jellyfin season and episode endpoints with pagination, missing/virtual item filtering, authorization, retries and stale-request isolation. Singleton references retain the existing series/range model and editing retains reference IDs. Browser checks run at desktop, 390 px and 320 px, including full save/reload and specials.

Saved IMDb lists support add/edit/delete, availability, canonical URLs, independent source IDs, Cancel, Undo and save/reload. Assignments persist independently of the reusable library. Tests cover legacy XML/JSON defaults, multiple sources on a row and conflict fingerprints including the list library.

Row-only first imports retain their planned mapping without creating unrelated rows. A browser regression deletes the row through the UI and verifies that subsequent planning respects that deletion.

Individual chronological episodes preserve IMDb order and movie interruptions. TV shelves remain grouped. Format changes propose explicit replacements of unchanged Auto-Add references; manual or edited references remain protected. Unselected removals block overlapping additions. Shared bundles retain their IDs and memberships in other rows. Source failures do not authorize removals. Repeated imports remain idempotent.

Timeline progress remaps replaced reference keys only when every item ID at every queue position remains identical, including repeated occurrences. Changes to membership or order retain the prior conservative behavior. Resolving a format change does not itself save state or start playback.

## Host validation

Browser and controller tests use mocked Jellyfin APIs. No live Jellyfin installation was available. Actual dashboard loading, library access and playback still require testing on the target server. IMDb retrieval and matching use the existing implementation; this feature changes saved source selection and episode presentation.

The standalone revision 11 preview is generated from the production settings resource with an isolated offline adapter. It exercises the new controls at 1280/390/320 px, startup, storage-denied frames, CSP, offline HTML and sample-data save/reload. It makes no Jellyfin or IMDb requests.
