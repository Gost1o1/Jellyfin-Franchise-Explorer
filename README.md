# Jellyfin Franchise Explorer

> [!CAUTION]
> **UNFINISHED EXPERIMENTAL PROJECT — USE WITH EXTREME CAUTION.**
>
> **I have not finalized this project. It is in its very early stages of development and should be used with extreme caution.**
> The project is **not ready for normal or production installation**. A successful GitHub Actions build does not establish safe operation inside Jellyfin 12.2. Do not install it on an important server without tested backups and prior isolated testing.

**Jellyfin Franchise Explorer** is an experimental source-available plugin for organizing existing movies and television shows into virtual franchises, eras, phases, sagas, and custom viewing sequences — without physically moving or duplicating media files.

**Repository:** https://github.com/Gost1o1/Jellyfin-Franchise-Explorer

## Status — v0.2.0.0 development preview

The repository contains **source code**, not a ready-to-install Jellyfin plugin. It targets **Jellyfin 12.2 / .NET 10**, and includes GitHub Actions to build it. The code has **not yet been independently confirmed to compile and load in a Jellyfin 12.2 instance**.

### Features currently implemented in source (pending runtime validation)

- Admin-only Jellyfin plugin configuration page using Jellyfin's documented embedded-web-page pattern.
- Create, rename and delete **virtual** nested franchise groups; choose types including Era/Phase/Saga.
- Add/remove **textual Jellyfin item ID references** (Movie, Series, Season, Episode or Collection).
- Set display labels, timeline names and numeric order; **does not implement playback**.
- Store **metadata-only artwork references** for poster, backdrop, clearlogo, thumb/icon and banner. **No upload, rendering, or automatic lookup yet.**
- Import/export virtual configuration as JSON; example franchise folders.
- Changes write to plugin-owned XML configuration only; no actual Jellyfin libraries, media files, or collections are modified by this source code.

### NOT implemented yet

- A native Movies-style **Franchises** category in Jellyfin navigation.
- A user-facing franchise browser, full artwork upload/display, movie/episode lookup, chronological playback, linked Jellyfin collection synchronization, or per-user timeline progress.
- Secure media resolution/access checks; this preview only stores item IDs and must not be treated as a client-facing API.
- Durable plugin-owned database/migrations (large datasets will need storage migration beyond XML configuration).

## Installation / catalog URL

A Jellyfin plugin repository must point to a **published release ZIP with a real checksum**. The `manifest.json` here starts as an **empty array** (`[]`) on purpose; this safely prevents unfinished source code from appearing as installable.

After an isolated Jellyfin host test, the **manually gated** GitHub Actions release workflow can compile a DLL, create an experimental release ZIP, and update `manifest.json` from the real ZIP checksum.

**Planned catalog URL (inactive until an actual release is published):**

`https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json`

For replacing the existing GitHub files see [docs/UPDATING_EXISTING_REPO.md](docs/UPDATING_EXISTING_REPO.md). For publication steps see [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md). For safe testing see [docs/SAFE_TESTING.md](docs/SAFE_TESTING.md).

## Compatibility and user safety

Target framework: `.NET 10`, `Jellyfin.Controller` and `Jellyfin.Model` version `12.2.0`. The catalog ABI for Jellyfin 12.x is `12.0.0.0`. Targeting these packages is not a guarantee of runtime compatibility.

Virtual hierarchy data is stored inside Jellyfin plugin configuration **for this limited preview only**. Back up/export before every update; do not store extensive collections in this prototype. Future versions are intended to move data into a separate plugin-owned data store with migrations.

No filesystem-moving, library-modifying, or native-collection-mutation methods are included. Deleting a virtual link or group removes only plugin configuration records.

## Build and release automation

- `.github/workflows/build.yml` — basic checks + .NET build; produces **test-only DLL artifact**.
- `.github/workflows/release.yml` — manual confirmation gate; publishes a prerelease, computes checksum, then updates the manifest.
- `scripts/check_repo.py` — validates structure and embedded JavaScript syntax (when Node is available).
- `scripts/publish_manifest.py` — never adds an entry without an existing compiled release ZIP.

See [the roadmap](docs/ROADMAP.md) for future feature plans.

## License

This project is **source-available, not OSI-approved open source**. The root [LICENSE](LICENSE) contains the requested **Personal and Noncommercial Use License (Draft)** exactly. Commercial use requires a separate written license. This draft and third-party dependency interactions should be reviewed by a qualified legal professional before broad distribution.

This project is not a fork of Smart Collections or the Jellyfin plugin template; it uses documented Jellyfin plugin API patterns.

## Development references

- [Official Jellyfin Plugins Documentation](https://jellyfin.org/docs/general/server/plugins/)
- [Official Jellyfin Plugin Template](https://github.com/jellyfin/jellyfin-plugin-template)
- [Smart Collections](https://github.com/johnpc/jellyfin-plugin-smart-collections) — comparison and packaging reference
- [JellyWatch Collections Guide](https://jellywatch.app/blog/jellyfin-collections-smart-playlists-organize-library-2026) — collection/playlist concept reference
