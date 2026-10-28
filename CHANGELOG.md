# Changelog

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
