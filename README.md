# Jellyfin Franchise Explorer

**Experimental Jellyfin 12.2 plugin** for creating virtual franchises, eras, phases and custom watch orders. Organize existing movies, shows, season ranges and episodes without moving, renaming or duplicating your media. This project is **unfinished**. Back up your server and plugin data before trying it.

## What it does

- Creates virtual franchise hierarchies (for example, Marvel phases or Star Wars eras).
- Displays custom horizontal rows of groups, Jellyfin collections, movies, shows and episode ranges.
- Uses existing Jellyfin artwork where available, with optional independent poster, backdrop, logo and banner overrides.
- Includes an experimental chronological player with independent per-user progress tracking, resume controls and poster watch indicators.
- Offers a **Franchises** tile in Jellyfin Web's **My Media** section using the optional JavaScript Injector integration. Client support varies; playback handoffs remain experimental.

**No library files or native Jellyfin collections are moved or modified by normal franchise browsing.** Artwork overrides belong to this plugin.

## Install or update

1. **Back up** Jellyfin and your Franchise Explorer configuration/artwork. Export your franchise metadata in the plugin's configuration page; exported JSON does not include the actual image bytes.
2. In Jellyfin, open **Dashboard → Plugins → Repositories → Add** and add the catalog URL below. If it is already present, don't add a duplicate.
3. Open **Catalog** and select **Franchise Explorer**. Install the available experimental version, then restart the Jellyfin server (Windows: restart the Jellyfin service).
4. Open the plugin settings to create and edit virtual franchises. The plugin can open its own **Franchises browser**.
5. For a My Media tile and local-browser timeline features, install/configure the compatible [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) integration. This integration is optional, and its availability/compatibility may vary.

**Plugin catalog URL** (paste into Jellyfin's plugin repository field):

```text
https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json
```

GitHub releases contain the compiled plugin. **Do not install this repository source ZIP as a Jellyfin plugin.** Jellyfin's catalog installs the compiled release package.

## Source and contributions

Source code, tests, documentation, and example data are in [`Jellyfin-Franchise-Explorer/`](Jellyfin-Franchise-Explorer/). GitHub Actions is configured in the hidden `.github/workflows/` directory (GitHub needs those files at the repository root).

For updating this source repository, use **git/GitHub Desktop** rather than GitHub's browser upload limit. The root `manifest.json` is managed by the release workflow and should not be reset when replacing source files.

## Credits and testing

Developed with assistance from **ChatGPT (OpenAI GPT-6)**. Project direction, configuration and hands-on testing are by **Gost1o1**, using their personal Jellyfin server. Testing on that server does not establish compatibility with other clients or guarantee experimental chronological playback is reliable.

## License

[**Personal and Noncommercial Use License (Draft) v0.1**](LICENSE). This is a custom source-available license, **not an OSI-approved open-source license**. Personal, noncommercial use is permitted under its terms; commercial use requires separate written permission. Third-party projects and artwork remain subject to their own licenses.

> [!CAUTION]
> **UNFINISHED PROJECT — USE WITH EXTREME CAUTION.** Features, APIs and playback support may change. Make backups and test with a short timeline before relying on the player.
