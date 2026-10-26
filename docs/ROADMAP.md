# Franchise Explorer roadmap

## Current 0.2 preview (intended, pending build/load test)
- Plugin dashboard page for virtual hierarchy editing.
- Group types including franchise, era, phase, saga and character.
- Virtual item ID references with display labels, item type and an ordered timeline label.
- Metadata-only references for primary poster, backdrop, clearlogo, thumbnail/icon and banner.
- JSON backup import/export; no real media file operations.

## Next milestones
- Dedicated plugin-owned persistence rather than growing an XML settings file; safe migrations and automated backups.
- Authorized Jellyfin API integration to search/respect current-user item access and resolve existing item IDs.
- Upload/display collection-style artwork, multiple backdrops, safe image validation and built-in media-image reuse.
- Dedicated Franchises browsing interface within Jellyfin Web, followed by possible native navigation integration.
- Playback and multiple named timelines across movies, seasons and individual episodes.
- Optional live references to Jellyfin collections without changing native collection membership.
- Cross-client research and real-life testing.

Nothing in this roadmap is an implementation promise. Native Jellyfin category integration differs across clients and may require a companion UI.
