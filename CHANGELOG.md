# Changelog

## 0.3.0.0 — experimental upgrade (source)
- Redesigned the embedded settings page and placed its scoped CSS inside the embedded page so Jellyfin can render it.
- Added Jellyfin API media search (Movies, Series, Seasons, Episodes, BoxSets) and one-click virtual links.
- Added URL-based poster previews, hierarchy filtering, easier link management and modest duplicate protection.
- Preserved plugin GUID and v0.2 data model, including schema-version 1 JSON import/export.
- Retained existing v0.2.0.0 manifest catalog entry when creating the v0.3 source package.
- No media file moves, native collections modifications, artwork uploads, client navigation integration, or playback.

## 0.2.0.0 — first user-installed experiment
- Successfully built and installed via GitHub Actions and Jellyfin's plugin catalog on Jellyfin 12.2.
- Verified the admin page loads and example franchises survive save and refresh.
- Virtual group editing, media GUID references, artwork metadata and backups.

**Caution:** v0.3's new UI and media picker have not yet been runtime-tested on a Jellyfin host.
