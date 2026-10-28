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
