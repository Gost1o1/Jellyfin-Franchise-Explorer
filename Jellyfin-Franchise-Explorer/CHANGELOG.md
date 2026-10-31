## v0.8.9.10 — Centered Home popups and stale menu recovery (experimental)

- Match the requested Jellyfin Home screenshot by keeping the complete chronological list in a centered, scrollable overlay, with Watch… controls and the existing tracked/untracked viewing choice.
- Replace the top-positioned browser confirmation with a compact centered dialog: “Are you sure you want to reset [franchise] chronological timeline?” and Cancel/Reset timeline buttons.
- Avoid older JavaScript Injector “already loaded” flags blocking updated home controls. Intercept lingering old action links before they navigate to Browse, while still recommending retirement of duplicate scripts.
- Keep the direct native-player restart behavior and separate Jellyfin watched history; add offline regression coverage for the confirmation and legacy link.

## v0.8.9.9 — Chronological controls directly on Jellyfin Home (experimental)

- Reset this user's franchise chronological history in place, without navigating to Browse or opening the timeline dialog. The home tracker refreshes afterward.
- Restart the current movie/episode directly via Jellyfin Web's native player, from 0:00, while preserving earlier franchise timeline entries. Add a scoped native-player seek safeguard for Jellyfin's Resume behavior.
- Reuse the **full chronological entry list** as a modal over Jellyfin Home. A selected item retains the choice between tracked chronology and one-off untracked franchise playback.
- Package the existing timeline engine with the single JavaScript Injector home script, including popup styling and error feedback. Add offline regression tests and a new unique script registration ID.
- No media is moved, no artwork sources are edited, and franchise timeline resets never change native Jellyfin watched history.

## v0.8.9.5 — Release-tag collision and Injector refresh (experimental)

- Publish the latest v0.8.9.4 bug fixes under a unique version rather than
  attempting to recreate the already-published `v0.8.9.4` GitHub release.
- Register an updated, version-specific JavaScript Injector script ID, then
  retire only previous Franchise Explorer owned scripts (v0.8.9.4/v0.8.9.3/v1).
- Keep the hover-only desktop three-dot menu and its revised browser test,
  which reveals the menu before clicking it. Touch and keyboard remain usable.
- The visibility preference now reads **Hide active franchise titles from
  Continue Watching and Next Up**: **on hides**, **off shows** (default off).
- The manual release workflow now checks whether the tag is already a GitHub
  release before doing the expensive compile-and-package work; it preserves
  existing published release assets rather than overwriting them.
- No changes to watched history, artwork overrides, or existing media files.

## v0.8.9.4 — My Media three-dot artwork alignment (experimental)

- Fix the confirmed screenshot bug: the three-dot Franchises options control
  was attached to the caption-inclusive outer native card and consequently
  appeared **below** the artwork. Place it in the actual image container.
- Align the control with the native bottom-right three dots, using a neutral
  white icon instead of a permanently filled turquoise circle. Reveal it on
  desktop hover/keyboard focus; keep it accessible on touch screens.
- Add a per-user, per-browser **Hide active franchise titles from Continue
  Watching and Next Up** option, disabled by default. When on, hide the
  currently active franchise movie/series from those two native Jellyfin Web
  homepage rows without modifying library data or watched state.
- On phone portrait orientation, prefer the film/series Primary vertical poster
  on homepage resume cards; keep Thumb/Backdrop art in landscape and on desktop.
  Re-render on rotation, and fall back gracefully when no poster exists.
- Add viewport-aware mock-browser geometry assertions to ensure the options
  control stays within the artwork at multiple screen widths and resize.
- Register a new v0.8.9.4 Injector script and retire only old, plugin-owned
  v0.8.9.3/v1 IDs after successful registration, avoiding stale code.
- Preserve the now-working homepage franchise card, progress display,
  authorized artwork loading and existing chronological playback behavior.

**Live test still required:** Browser mocks can verify image-relative
positioning but not every Jellyfin Web client or third-party skin.

## v0.8.9.3 — Injector script migration and refresh diagnostics (experimental)

- Give the My Media integration a new script ID to avoid reusing a cached
  legacy registration. Retire the exact old plugin-owned script ID only after
  the new registration succeeds, leaving manually added scripts alone.
- Add a distinct v0.8.9.3 version marker to the loaded browser JavaScript,
  My Media card and home tracker, with README troubleshooting steps for
  verifying that the installed server is serving the new code.
- Keep the franchise tracker visible with a loading placeholder while initial
  session data is pending, and preserve cached cards across intermittent API
  failures. Show per-franchise names, next episode/movie and artwork as in
  v0.8.9.2 once the timeline and catalog resolve.
- Make the tile's three-dot options explicit: Open Franchises and Franchise
  Explorer Settings. Retain the dedicated browser-header Settings control.
- Document both Jellyfin repository manifest URLs, Injector setup, and the
  manual experimental-release procedure. Preserve playback/session guards.

**Still needs live verification:** The v0.8.9.2 screenshot showed an older
card despite the Injector page identifying a newer script. The new script ID
and diagnostics address likely stale registration, not a proven root cause.

## v0.8.9.2 — Persistent homepage franchise cards and settings shortcuts (experimental)

- Replace the generic home 'Chronological Order' tile with separate,
  per-user franchise resume cards including the root franchise name, current
  film/series title, next episode (where available), Jellyfin artwork,
  completion percentage, queue position, and a resume link.
- Restore cards after Jellyfin Web redraws its home sections; use a short-lived,
  per-user session cache for fast rehydration on hard refresh without sending
  or storing authentication tokens in image URLs.
- Add a dedicated three-dot 'Franchise Explorer Settings' menu to the virtual
  My Media tile, and a settings shortcut in the Franchises browser header.
  Jellyfin's administrator permissions still govern plugin configuration.
- Bundle the supplied Gost1o1 logo and UI preview inside this repository so
  the root README does not depend on an image path in another project.
- Preserve v0.8.9.1 timeline JSON/playback state, server event processing,
  original Jellyfin cards, file locations, collections, and artwork overrides.

**Validation needed:** Browser mocks exercise homepage rehydration and
navigation; test on Jellyfin 12.2 with repeated refreshes and more than one
active franchise before treating home integration as stable.

## v0.8.9.1 — Timeline JSON response contract and local auto-next (experimental)

- Fix a confirmed Jellyfin 12.2 mismatch: `TimelineState` API responses were
  PascalCase (`RowId`, `CompletedKeys`, `PendingAutoAdvanceUtc`), while all
  browser views and the local auto-next bridge read camelCase properties.
- Make every timeline GET/PUT/Activate/Complete success response explicitly
  serialized with the plugin's camelCase JSON settings, independent of the
  host application's MVC serializer configuration.
- Defensively normalize either response form in the browsing timeline script,
  the optional home progress widget, and the injected Jellyfin Web bridge.
- Preserve v0.8.9.0 server-side arming, completion persistence, session checks,
  and the native My Media card's exact geometry and appearance.
- Add regression tests using a synthetic PascalCase response matching the
  real server's field names: 1/422 completed displays ~0.24%, the cursor is at
  the next episode, and a fresh pending marker is followed in Jellyfin Web.

**Live validation still required:** The prior server JSON actually had one
completed key and a pending next-item marker, but its marker expired before
inspection. This update does not replay stale transitions or alter history.
Test with a new short movie-to-episode timeline on actual Jellyfin.

## v0.8.9.0 — Explicit timeline activation and completion diagnostics (experimental)

- Before opening a local Jellyfin Web movie, persist a short-lived **armed**
  timeline row. Jellyfin server PlaybackStart/Progress binds its actual session
  to that row when the expected item begins, independent of brittle browser
  device-ID discovery. A stop alone cannot activate an armed row.
- Add an authenticated, atomic `/TimelineState/{rowId}/Activate` confirmation
  endpoint for the browser. It cannot overwrite an already-completed item or
  replace an advanced server cursor with an older browser snapshot.
- Log clear server outcomes for completed playback: successful persisted rows
  or counts of valid, active, session-matching and item-matching rows. Logs do
  not contain media paths or authentication tokens.
- Normalize UserId GUID formatting in browser session verification, and stop
  the optional home widget from marking skipped items completed or writing
  stale state. Show fractional progress for long timelines (1/422 ~= 0.24%).
- Preserve the exact My Media tile layout/geometry, existing configurations,
  virtual hierarchies, user progress, media files and native collections.
- Add tests for arm/replay/failure safety, activation contracts and mocked Web
  follow-up. Real .NET compilation and Jellyfin 12.2 playback validation are
  still required; **automatic next-title playback is not yet confirmed fixed**.

## v0.8.8.0 — Local timeline completion persistence and quieter playback chooser

- Hide the remote-control capability warning when local playback is selected.
- Preserve verified movie/episode completion across Jellyfin returning to its details page, then retry the authenticated completion update when needed.
- Restore an interrupted next-item route if Jellyfin navigates back to the previous title; do not interrupt an actively playing video.
- Accept a single same-title Jellyfin session when the current local video demonstrably advances, even when the browser's cached device ID does not match the reported session ID.
- Wait for next-title details to settle before clicking Jellyfin's Play button, avoiding a stale button from the preceding movie.
- Preserve the exact My Media tile implementation from v0.8.7.0.

**Still experimental:** These changes are based on offline browser simulations. Automatic continuation across Jellyfin Web clients is not verified on a live server.

## v0.8.7.0 — Experimental playback completion handoff and banner cleanup

- Remove the two large on-screen caution banners from browsing and configuration pages; the README and license caution remains.
- Preserve the fixed My Media tile geometry.
- Treat guarded near-end playback evidence as a fallback when Jellyfin reports completion=false, without completing ordinary early stops.
- Add final-frame browser detection and force a fresh Jellyfin Web page navigation for the next chronological item to avoid a route race after playback ends.
- Add a simulated end-frame regression test. Live Jellyfin 12.2 validation is still required.

## 0.8.5.0 (experimental)
- Native Jellyfin library-card markup and CSS shape for the Franchises tile, including mobile.
- Timeline-specific progress bars underneath titles, partial in-progress fill, and Watched overlays after all selected timeline episodes complete.
- Completion-event capture fallback for local Jellyfin Web playback, retaining session and item checks.
- Browser-observed session progress fallback; no automatic completion from position alone.
- Preserve all existing groups, artwork, and row definitions.

## 0.8.4.0 — Completed-item handoff and My Media sizing (experimental)

- Add an explicit completion marker to the *per-user timeline* state on Jellyfin PlaybackStopped/played-to-completion. Auto-next no longer requires an ended item to remain in Jellyfin Now Playing.
- Add an authenticated and idempotent local HTML5 video-ended confirmation endpoint, scoped to the currently active timeline and session. It does not run on arbitrary player stops.
- The optional Jellyfin Web bridge follows fresh, exact completion markers, rejects unrelated playback, and opens the next real episode or movie through Jellyfin's native player. Native players without browser video events still depend on server stop reporting.
- Match the actual native My Media card *image height* and observe the native card on resize in addition to matching its width. Browser themes may still need separate live checks.
- Preserve existing franchise groups, image overrides, rows and timeline state; no media or collections are moved.

**Experimental warning:** This change has not been compiled with .NET or validated on a live Jellyfin 12.2 player. Auto-next must be tested with one short movie-to-episode sequence before trusting long timelines. The Web integration requires JavaScript Injector; native clients may not support it.

## 0.8.3.0 — Mobile and playback verification hotfix (experimental)

- Remove the `45vw` My Media tile width cap. Match the measured native Jellyfin library card without inventing a fallback width.
- Verify that local playback belongs to the current browser/device and actually advances. Ignore matching sessions on other devices, and display a visible warning when no local playback can be verified. Do not mark timeline history as started on an unverified session.
- On mobile, keep long chronological entry names readable on a full line, with action controls beneath rather than squeezing words into a narrow column.
- Shorten the mobile browser's experimental caution banner and update the stale administrator description.
- Keep the original custom license, all virtual groups, artwork, and media references unchanged.

**Caution:** This cannot guarantee every embedded Android/native video player exposes enough progress information to verify playback. Native and long-queue autoplay must still be tested in Jellyfin 12.2; `PlayNow` acknowledgement alone is not proof of visible playback.

## 0.8.2.0 — Experimental same-browser playback handoff

- Add **This browser (local playback)** as the default chronological playback destination. This avoids Jellyfin's unreliable remote `PlayNow` commands directed at the same Web browser.
- Use the optional installed JavaScript Injector bridge to open Jellyfin Web's own player and validate the actual first movie/episode before activating per-user timeline history.
- Preserve the existing remote device mode for clients that do support remote queueing.
- Add a guarded local follow-up mechanism for advancing to the next title after a completed episode or movie. It is not yet verified against every Jellyfin Web player/version.
- **Replay only** does not intentionally affect the chronological cursor; a failed local start does not create false timeline progress.
- Added offline browser regression tests for positive/negative playback verification.
- **Caution:** The integrated browser bridge uses Jellyfin Web DOM controls and requires the optional JavaScript Injector. Browser history, native player behavior, and cross-device queue management require live verification. Test with three short items first.

## 0.8.1.0 — Playback handoff, subtitle preference, stable media order

- Clicking a movie or TV-show card requests playback through Jellyfin Web's native player via the optional JavaScript Injector, rather than simply showing its details. TV-show cards resolve the first episode within the saved episode/season selection.
- New separate information (ⓘ) button opens the original Jellyfin details page.
- Deterministic card rendering: results fetched asynchronously are appended in saved row order, not network-completion order. Returning from details restores the browsing group and scroll position.
- A per-browser, per-Jellyfin-user subtitle option defaults to **off** for Franchise Explorer-launched playback. Jellyfin's native player may override it; web text-track suppression is best-effort, not a guaranteed override of every subtitle format.
- Fix false timeline playback success: wait for the selected device to report the requested media playing before changing timeline progress.
- Move custom-row bulk-selection checkboxes left and rename to **Add Selected (X)**.

## 0.8.0.1 — Playback verification and UI hotfix

- Fix false playback success: confirm that the selected Jellyfin session reports the requested movie or episode as Now Playing before saving timeline progress or appending queue chunks.
- Reject sessions that explicitly report remote-control support as disabled, with actionable feedback instead of a silent no-op.
- Preserve timeline state on unsuccessful playback attempts. Treat HTTP 204 as command acknowledgement, not proof of playback.
- Use smaller initial batches to avoid building large queues on nonresponsive clients.
- Align row library search checkboxes to the left and simplify the bulk action to Add Selected (X).
- No change to season/episode filename parsing: resolution uses numeric Jellyfin episode metadata.

## 0.8.0.0 — Chronological Playback Preview (EXPERIMENTAL)

- Resolve exact Jellyfin movie and TV episode IDs for each chronological row, including whole seasons and cross-season episode ranges; warn about inaccessible content and missing episode boundaries.
- Build a remote Jellyfin Play Now queue in saved chronological order, with chunked Play Last append commands for longer timelines where supported.
- Add per-user timeline progress saved to plugin-owned JSON files, separate from Jellyfin's original watched flags and playlist state.
- Follow Jellyfin playback start, progress and stop events for the selected session; keep unrelated viewing and independent replays from rewinding the timeline.
- Add Play From Beginning, Resume, Replay Only, and Restart Timeline Here with confirmation, plus episode-by-episode progress and queue preview.
- Optional Continue Your Franchises home section (JavaScript Injector); progress bars for timeline rows and associated media cards; adaptive TV/desktop/tablet/phone layout.
- Preserve all existing 0.7.x franchise groups, art, custom rows, and media links. Same plugin GUID.
- **UNFINISHED.** Mock tests pass; real Jellyfin 12.2 compile and device playback validation pending.

## v0.7.4.1 — Full-library row search focus hotfix (experimental)

- Fix loss of keyboard focus while typing in Collections / Movies / TV Shows and Timeline / Mixed row search fields.
- Search now updates results and status below the existing input instead of rebuilding the row editor after each character or async response.
- Preserve caret position, selection, input text, and scroll position while searches complete.
- Keep existing full-library selection, TV show range, saved rows, group artwork and media references unchanged.
- No change to original Jellyfin media files or native collections.

## v0.7.4.0 — Full-library row selection (experimental)

- Restrict Subgroups rows to direct child groups, as before.
- Let media/mixed/timeline rows find any existing Jellyfin collection, movie or TV show without pre-linking to the franchise.
- Per-row full-title selection, bulk adding and TV show range picker (whole show, season-to-season, season/episode-to-season/episode).
- Independent direct row references with responsive cards; existing row memberships, artwork and configuration survive.
- One combined presentation order across legacy franchise media links and newly selected row entries.
- Browse each row's directly selected media using the viewer's own Jellyfin access.
- Does not modify native collections or files; no continuous timeline playback yet.

## 0.7.2.0 — My Media positioning and artwork association preferences

- Place the Franchises card immediately after the Collections card, maintaining original library ordering.
- Add a non-destructive artwork priority selector for associated collections. Newly linked collections preserve previously inherited artwork by default; old groups retain prior display behavior.
- Add **+ Same-level group** to the admin editor and update sidebar names as you type.
- Existing artwork overrides, virtual references, GUIDs and configuration backups remain compatible.
- Experimental; GitHub build and live Jellyfin 12.2 runtime tests still required.

# Changelog

## 0.7.3.0 — Editable horizontal browse rows

- Add XML-compatible `FranchiseRow` models stored as presentation-only references. `Nodes` and `MediaLinks` remain unchanged.
- Allow **custom rows with user-defined names** to be created, renamed, deleted, assigned content, dragged and reordered (with touch-friendly move-button alternatives).
- Assign existing direct-child groups or movies/TV show links from a franchise's descendants; cards have independent order in each row.
- Browse rows as responsive horizontal carousels with snapping and scroll arrows; keep unassigned groups and media visible.
- In the absence of saved rows, show suggested Phases, Collections, Eras, Sagas, other group and media sections automatically.
- Add optional **Create suggested rows** migration assistant; Chronological Viewing Order starts empty until intentionally curated.
- Continue preserving custom artwork, original Jellyfin collections, media files, per-user access, and the optional My Media tile integration.
- Experimental: no continuous timeline playback, no universal native TV-client integration, and live Jellyfin runtime tests required.


## 0.7.1.0 — Experimental optional My Media tile

- Add an **opt-in web-only Franchises card** to the existing My Media row using the independent JavaScript Injector companion (when installed). This card links to `/FranchiseExplorer/Browse` and does not create a physical/virtual Jellyfin media library.
- New bounded startup registration through the companion's published `PluginInterface.RegisterScript(JObject)` reflection contract. No runtime dependency is shipped and the server continues loading if Injector is absent or its API changes.
- The JavaScript is isolated and idempotent, supports a Jellyfin base URL, watches for Home rerenders, and follows native My Media sizing when possible.
- Maintain existing Franchise Explorer data model, artwork, media references and browsing interface; no changes to native Collections.
- Include optional manual fallback script and setup/rollback guide. Test via simulated DOM only; the actual Jellyfin 12.2 Home UI remains unverified.


## 0.7.0.0 — Experimental read-only Franchises browser

- New `/FranchiseExplorer/Browse` standalone responsive page for Jellyfin Web desktop, laptop, tablet, phone and TV web browsers.
- Uses existing saved groups, nested structure, linked media IDs, sort positions, overview text and artwork; no data migration.
- Resolves inherited artwork from collection → parent → linked item, with existing image overrides taking precedence.
- Browse nested franchise/era/phase cards, choose grid/list display, search current group, navigate with breadcrumbs and keyboard.
- Linked items resolve through the viewing user's Jellyfin API permissions; TV show ranges display metadata only.
- Adds a read-only authenticated `/FranchiseExplorer/Catalog` endpoint and grants authenticated users read access to uploaded group previews (uploads remain admin-only).
- Adds **Open Franchises browser** to the administrator page.
- Documents supported Jellyfin Web `menuLinks` integration; native "My Media" tiles and non-web-client categories are not provided.
- Preserves original Jellyfin files, collections, plugin GUID, virtual group config and personal/noncommercial license.

**Warning:** Untested on a running Jellyfin 12.2 server; back up configurations before installing. Runtime validation remains required.

See Git history for earlier releases.
## v0.8.9.6 — Homepage artwork and streamlined plugin settings (experimental)

- Bundle cinematic artwork for the Franchises My Media tile; show full landscape resume images with blurred letterbox fill.
- Move subtitle and native-row display preferences to the admin plugin editor; keep the existing per-browser user keys.
- Remove the large root library hero, simplify the browser branding, and keep franchise-specific hero artwork.
- Put Save and the dirty indicator at the top; show six editor toolbar actions in the requested order.
- Hide the legacy linked-media search/manual-ID area, same-level and demo controls, and future-navigation label without deleting saved group, collection, or reference data.
- Rotate the JavaScript Injector script identity to v0896 and retain legacy ID cleanup behavior.

## v0.8.9.7 — Clearer franchise browser and centered My Media artwork (experimental)

- Center the "Franchises" title on My Media artwork, increasing contrast with a subtle blurred/dimmed overlay.
- Remove the redundant root "Groups and subgroups" heading, the browser's experimental-version footer, and the tiny "Franchise" badges on franchise posters (other subgroup labels remain).
- Replace generic "Franchise · X linked items" captions with "TV Shows X · Movies Y" counts, including nested franchise links and explicit row media, without counting the same Jellyfin item twice.
- Add media item types to the read-only catalog response to support accurate counts; do not mutate existing links or groups.
- Default navigation to "Your order" when opening a franchise, while retaining manual A–Z selection.
- Make the top-left "F" logo and "Franchise Explorer" title a single, padded home link back to "Your franchises" (also accessible with keyboard navigation).
- Update installer script identity and release version to 0.8.9.7.
- Add three-dot actions to each Continue Your Franchises card: reset per-user chronological history, restart the current title without clearing earlier history, or choose a title from the full viewing list. One-off playback explicitly skips franchise timeline tracking and clears any stale local auto-next handoff.
- Add a native show/hide arrow for each editor row's included-items list. Lists longer than eight items start collapsed; their ordering, selection, and data are unchanged. Expanded/collapsed state is remembered during editing.
- Refresh GitHub Actions to Node 24-compatible action majors and pin Ubuntu 24.04 to remove deprecation and runner migration warnings.

## v0.8.9.8 — Release version alignment (experimental)

- Set the project, assembly, file, GitHub Actions release default, browser version markers, and optional Injector registration to `0.8.9.8` so manual dispatch with that version passes the release gate.
- Register a new `jellyfin-franchise-explorer-my-media-v0898` script ID and retire the plugin-owned v0897 registration after the new one succeeds; other plugins' Injector scripts remain untouched.
- Fail fast on mismatched versions before installing Playwright and running the browser suite. Validate all three assembly-version fields during the release check.
- Preserve the v0.8.9.7 UI improvements, one-off chronological playback menu, collapsible editor lists, and upgraded GitHub Actions.
