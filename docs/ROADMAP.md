# Jellyfin Franchise Explorer development roadmap

## Experimental v0.6 source implementation
- Existing persisted nested groups and virtual media links.
- Styled administrator UI with search, checkbox bulk linking, image uploads and backups.
- Dynamic image inheritance per slot: user override → associated Jellyfin BoxSet → parent → linked media → placeholder.
- Optional native BoxSet association and opt-in one-time import of movie/show members.
- No physical file reorganization, no modifications to native Jellyfin collections.

## Not implemented
- First-class **Franchises** navigation category and viewer-facing card page in Jellyfin Web.
- Support across all Jellyfin TV/mobile clients, with client-specific extensions as needed.
- Native Jellyfin Web right-click **Add to Franchise** menu action.
- Live automatic collection synchronization; unassigned-title discovery and verified franchise matching.
- Cross-title/episode chronological playback and per-user progress.
- Larger-scale plugin-owned database and migration/backups.

All functionality requires CI compilation and live compatibility verification on Jellyfin 12.2. This plan does not promise that Jellyfin's supported plugin API can add a native navigation category by itself.
