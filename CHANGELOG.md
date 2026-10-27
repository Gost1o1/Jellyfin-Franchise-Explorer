## 0.6.1.0 — Responsive editor hotfix

- Fix main page running past the right edge of Jellyfin when the browser or dashboard content area is narrower.
- Introduce container-width breakpoints, stacking the hierarchy and details when needed.
- Prevent fixed-width fields, cards, and link actions from overflowing on narrow windows.
- Preserve all v0.6 configuration and behavior.
- Experimental preview; GitHub build and Jellyfin runtime validation are required.

# Changelog

## v0.6.0.0 (experimental / unverified)

- Drag-and-drop ordering for franchises and nested groups, including reparenting with circular-tree protection and visible drop targets.
- Accessible Move up/Move down buttons; Delete virtual group moved to the top of the editor.
- Clear scope indicator for artwork belonging to the selected group only, with protected overrides when media links change and guards for asynchronous preview updates.
- Display "TV Show" instead of "Series" while retaining Jellyfin API type `Series` internally.
- Metadata-only TV Show ranges for whole seasons (1–3) or individual episode boundaries (S1E5 through S2E8), without changing original episodes.
- Preserve v0.5 saved groups, collection links, image overrides, and media links through XML-friendly optional range fields.
- Offline range and drag-and-drop regression tests. No native Franchises category or playback engine yet.


## v0.5.0.0 (experimental / unverified)
- Implemented automatic image inheritance from existing Jellyfin BoxSets, parent nodes, and linked media; no edits to original image files.
- Added independent artwork overrides with **Restore inherited** for each image type.
- Added a native BoxSet finder, persistent `CollectionId` association, and opt-in snapshot import of its current movie/show members.
- Added select-all/checkbox bulk media linking to the existing Jellyfin search experience.
- Preserved previous v0.2–v0.4 virtual groups, media links, uploaded artwork references, and custom license.
- Retained explicit warning that a custom nav category/context-menu integration and timeline player remain unimplemented.

## v0.4.0.0
- Admin-only group artwork upload and preview endpoints.

## v0.3.0.0
- Styled administration editor and Jellyfin item search.

## v0.2.0.0
- Nested virtual group editor, backup/restore, and media references.
