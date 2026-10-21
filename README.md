# Jellyfin Franchise Explorer

> [!CAUTION]
> **UNFINISHED EXPERIMENTAL PROJECT — USE WITH EXTREME CAUTION.**
> This project has **not been finalized** and is in its **very early stages of development**. It is **not ready for normal use or production installation**. The code has not yet been verified to compile or load against Jellyfin 12.2. Installing untested plugins may cause server instability, unexpected behavior, or data loss. **Do not install this on a server containing important data without complete, tested backups.**

Jellyfin Franchise Explorer is an experimental source-available Jellyfin plugin project for organizing existing movies and television shows into virtual franchises, eras, phases, subgroups, and custom viewing timelines **without moving or duplicating media files**.

## Project status

**v0.1 development scaffold only.** The repository currently contains a plugin entry point, configuration/data models, and an automated build workflow. **It does not yet provide a working franchise editor, navigation category, media linking interface, artwork management, or chronological playback.** The GitHub Actions workflow must pass before a compiled binary can be considered for testing. No installation manifest or installable release is published yet.

## Planned features (not yet implemented)

- A dedicated **Franchises** navigation category (client integration to be investigated)
- Nested franchise, era, phase, saga, and character groupings
- Virtual links to existing Jellyfin media and collections
- Collection-style artwork: posters, logos/icons, backdrops, banners, and thumbnails
- Release, chronological, and user-defined watch orders, eventually including individual episodes
- Import/export and backup of franchise definitions

## Development and testing

Target under investigation: **Jellyfin 12.2 / .NET 10**. Dependencies and compatibility are **not yet validated**. GitHub Actions attempts a restore and build on each push. A passing build does **not** establish runtime compatibility or safety.

**Do not upload this source ZIP to Jellyfin's plugin catalog.** Jellyfin's repository URL requires a valid published JSON manifest pointing to an actual, compatible, compiled release archive. We will add that after successful build and test verification.

For development details, see the C# project in `src/Jellyfin.Plugin.FranchiseExplorer/`.

## License

This project is **source-available, not OSI-approved open source**. See [LICENSE](LICENSE) for the full **Personal and Noncommercial Use License (Draft)**. Commercial use is not authorized without a separate written license.

## Project

https://github.com/Gost1o1/Jellyfin-Franchise-Explorer
