# Jellyfin Franchise Explorer

<p align="center">
  <a href="https://www.Gost1o1.pro">
    <img src="docs/Gost1o1-logo.png" alt="Gost1o1" width="220" />
  </a>
</p>

<p align="center">
  Create virtual franchises, eras, phases, and custom watch orders for your existing Jellyfin library—without moving or duplicating your media.
</p>

<p align="center">
  <a href="#install-or-update"><img alt="Install in Jellyfin" src="https://img.shields.io/badge/Install-Jellyfin%20Plugin-086C4F?style=for-the-badge&logo=jellyfin&logoColor=white" /></a>
  <a href="https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/releases"><img alt="Plugin releases" src="https://img.shields.io/badge/Download-Plugin%20Releases-325A82?style=for-the-badge&logo=github&logoColor=white" /></a>
  <a href="https://www.Gost1o1.pro"><img alt="Visit Gost1o1.pro" src="https://img.shields.io/badge/Website-Gost1o1.pro-4C5364?style=for-the-badge&logo=googlechrome&logoColor=white" /></a>
</p>

<p align="center">
  <a href="https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/actions/workflows/build.yml"><img alt="Build status" src="https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/actions/workflows/build.yml/badge.svg" /></a>
  <a href="https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/actions/workflows/build.yml"><img alt="Development builds" src="https://img.shields.io/badge/Preview-Test%20Builds-325A82?logo=githubactions&logoColor=white" /></a>
</p>

> [!IMPORTANT]
> **Experimental project for Jellyfin 12.2.** Franchise Explorer is unfinished and is being tested on a personal Jellyfin server. Features and client compatibility can change. **Back up Jellyfin and your plugin data before installing or updating.** Chronological playback and automatic next-item playback are still experimental; do not assume they work in every client.

## Preview

![Franchise Explorer showing the Marvel Cinematic Universe, phases, collections, and chronological watch order](docs/franchise-explorer-preview.png)

## Install or update

Franchise Explorer has a standalone Franchises browser, but its **My Media tile, Continue Your Franchises homepage tracker, and tile settings menu require the separate [JavaScript Injector plugin](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector)**. Install both plugins for the complete Jellyfin Web experience. JavaScript Injector is not bundled with Franchise Explorer.

### Step 1 — Add both plugin repositories

1. Open **Jellyfin Dashboard → Plugins → Repositories**.
2. Select **Add** (or the **+** button).
3. Give the first repository the name **Gost1o1 — Franchise Explorer** and paste this URL:

```text
https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json
```

4. Save, select **Add** again, name the second repository **n00bcodr — JavaScript Injector**, and paste the repository URL from the [JavaScript Injector project's installation instructions](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector#installation). The maintainer states the same catalog URL supports Jellyfin 10.11 and 12:

```text
https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/manifest.json
```

5. Save. If either repository is already present, keep its existing entry rather than creating a duplicate.

### Step 2 — Install the plugins

1. **Back up** Jellyfin and your Franchise Explorer configuration and artwork. The plugin's JSON export includes franchise metadata, **not uploaded image files**.
2. Open **Dashboard → Plugins → Catalog**. Install the Jellyfin 12-compatible **JavaScript Injector** plugin and **Franchise Explorer** from their respective repositories.
3. **Restart Jellyfin** after installing or updating either plugin (on Windows, restart the Jellyfin service).
4. Open **Dashboard → Plugins → JavaScript Injector** (or **JS Injector** in the dashboard sidebar). Under **Plugin Scripts**, you should see **one enabled Franchise Explorer - My Media tile** entry registered by Franchise Explorer itself. In **v0.8.9.3**, its Script ID is `jellyfin-franchise-explorer-my-media-v0893` and Plugin Version is `0.8.9.3`. You do **not** need to click **Add Script** or paste JavaScript manually when this entry is present.
5. Hard-refresh Jellyfin Web with **Ctrl+Shift+R**, then check **Home → My Media → Franchises**, **Continue Your Franchises**, and the separate **Franchises browser**. The My Media tile's three-dot button should open the settings shortcut; clicking the rest of the tile opens browsing.
6. Open Franchise Explorer settings to create or manage franchises and chronological watch orders.

**Already installed JavaScript Injector?** Keep the one registered Franchise Explorer plugin script enabled. Avoid creating a second, manually pasted copy; conflicting older scripts can interfere with the homepage integration. Version **0.8.9.3** registers a new script ID and attempts to retire only the old plugin-owned `jellyfin-franchise-explorer-my-media-v1` entry. If both IDs remain, confirm the new script is installed before disabling the old entry. If the browser still displays an older tracker, verify the installed DLL version, restart Jellyfin, and try a private browsing window to rule out cached web assets.

**Still seeing the small “Chronological Order” card?** v0.8.9.3 should display the root franchise name, the current series or movie, the next episode (where applicable), thumbnail artwork, and progress. In Jellyfin Web's browser DevTools Console, run `window.__franchiseExplorerUiVersion` to check the actual script; it should return `0.8.9.3`. You can also inspect `document.querySelector('#franchise-timeline-resume')?.dataset.feVersion` for the tracker and `document.querySelector('#franchise-explorer-my-media-tile')?.dataset.feVersion` for the tile. Missing/old values indicate the new web script did not take effect. For detailed troubleshooting see [v0.8.9.3 upgrade notes](Jellyfin-Franchise-Explorer/docs/UPGRADE_V0893.md).

**Using a GitHub download instead?** See [Releases](https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/releases) for compiled plugin packages when a release is published. **Do not install GitHub's “Source code” ZIP as a Jellyfin plugin.** The Actions **Preview — Test Builds** link is for development artifacts, not a verified stable release.

**Developer note:** Pushing updated source files or passing GitHub Actions does **not** update the plugin already installed on your Jellyfin server. Publish and install the compiled release (or explicitly deploy a compatible test DLL), restart Jellyfin, then refresh the browser. A newer source version may not appear in the Jellyfin catalog until that version is actually released and added to the repository manifest.

## What it does

- Build virtual franchise hierarchies, such as Marvel phases or Star Wars eras.
- Arrange collections, movies, shows, seasons, and episode ranges into custom horizontal watch-order rows.
- Reuse Jellyfin artwork or apply plugin-specific poster, backdrop, logo, and banner overrides.
- Track per-user progress in an experimental chronological player, with resume options and watched indicators.
- Add an optional **Franchises** entry to Jellyfin Web's **My Media** section.
- Resume different franchise watch orders from persistent homepage cards showing the next title, artwork, and individual progress (on supported Jellyfin Web installations).
- Open Franchise Explorer's administrator settings from the My Media Franchises tile or the browser header.

**Your existing movies, shows, files, and native Jellyfin Collections remain in place.** Normal franchise browsing does not rename, move, or duplicate library media. Plugin watch-order progress is separate from Jellyfin's native watched state.

## Need help?

- [Report a bug or request a feature](https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/issues)
- [Source code and developer notes](Jellyfin-Franchise-Explorer/)
- [Development history](Jellyfin-Franchise-Explorer/CHANGELOG.md)
- [Build and browser tests](https://github.com/Gost1o1/Jellyfin-Franchise-Explorer/actions/workflows/build.yml)
- [Visit Gost1o1.pro](https://www.Gost1o1.pro)

## License and credits

[**Personal and Noncommercial Use License (Draft) v0.1**](LICENSE). This is a custom source-available license, **not an OSI-approved open-source license**. Commercial use requires separate written permission; third-party software and artwork retain their own terms.

Created by **Quinton Burgess (Gost1o1)**, with development assistance from **ChatGPT (OpenAI GPT-6)**. Project direction, configuration, and hands-on Jellyfin testing are by Gost1o1. Testing on one server is not a compatibility guarantee.

> [!CAUTION]
> **UNFINISHED PROJECT — USE WITH CAUTION.** Make backups and test new versions with a short timeline before relying on playback automation.
