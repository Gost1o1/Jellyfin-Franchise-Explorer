# Changelog

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
