# Franchises browser — user-visible navigation (experimental, Jellyfin 12.2)

The virtual hierarchy is **not a Jellyfin collection or physical library**. Version 0.7 adds a standalone, read-only browser at the same origin as your server:

`https://YOUR-JELLYFIN-HOST/FranchiseExplorer/Browse`

If your Jellyfin reverse proxy uses a base URL such as `/jellyfin`, retain that prefix:

`https://YOUR-JELLYFIN-HOST/jellyfin/FranchiseExplorer/Browse`

## Try the page first

Open **Dashboard → Plugins → Franchise Explorer → Open Franchises browser**. On the same browser and origin where you're logged into Jellyfin Web, the browser should show your top-level franchise posters, nested eras/phases, and linked titles. It uses the **existing plugin configuration**. Uploads override inherited Jellyfin collection/parent/item artwork. It doesn't create any Jellyfin collections or edit media.

The standalone browsing page uses the Jellyfin Web login already stored by your browser. If it says no Jellyfin login was found, log into Jellyfin Web using the exact same host and origin, then retry. Unlike a login form, the browser page does not accept or store passwords.

## Add a Franchises navigation link in Jellyfin Web

The server plugin **cannot register a native Movies-style library tile through the standard API**. Version 0.7.1 optionally adds a **web-only Franchises card** via the external JavaScript Injector companion; see `MY_MEDIA_TILE.md`. Jellyfin Web does offer [supported custom menu links](https://jellyfin.org/docs/general/clients/web-config/). To show `Franchises` as a navigation entry, add a link to the `menuLinks` array in the **Jellyfin Web `config.json` file**, not the Jellyfin server's XML plugin settings. For example:

```json
"menuLinks": [
  {
    "name": "Franchises",
    "icon": "folder_special",
    "url": "https://YOUR-JELLYFIN-HOST/FranchiseExplorer/Browse"
  }
]
```

Replace the URL with the working browser URL for your instance; keep other existing `menuLinks` entries. **Do not replace the entire `config.json` with this excerpt.** Locate your web root via the Jellyfin startup `--webdir` setting or the installation's `jellyfin-web` directory, back up `config.json`, modify the existing property while preserving valid JSON, restart the Windows service if needed, and hard-refresh clients. A common Windows installation location is `C:\Program Files\Jellyfin\Server\jellyfin-web\config.json`, but actual paths vary.

Jellyfin Web 12 Modern/TV layouts can show custom menu links in different places or overflow menus. This gives a **Franchises navigation link**, not a native library tile; it is not a modification to the Movies/Shows/Collections catalog. If you prefer not to modify Jellyfin Web configuration, bookmark the direct URL instead.

## Devices

| Device | v0.7 support |
| --- | --- |
| Desktop/laptop web browser | Responsive standalone page; custom menu link where Jellyfin Web displays it |
| Phone/tablet web browser | Responsive touch targets and adaptive grid; use the same server URL |
| TV browser / Jellyfin Web TV layout | Large, focusable cards with arrow-key/Enter navigation; real remote implementations may vary |
| Native Android TV, Roku, tvOS and other standalone Jellyfin applications | **No new native Franchises menu** from this plugin; requires dedicated client integration |

## Safety and privacy

The static HTML page contains no private user data; its catalog requires a Jellyfin-authenticated account. Linked media **names, posters and metadata are fetched with the viewing user's own token through Jellyfin**, which determines whether the viewer may access each item. The plugin catalog endpoint supplies only linked item IDs, not administrator-entered display labels. Virtual franchise group names/descriptions and group-uploaded artwork are shared with all authenticated Jellyfin viewers; avoid sensitive names or images if your accounts have different parental access. The page cannot enforce universal restrictions on group names. A user without permission for a particular movie won't receive that movie from Jellyfin's Items API.

No automatic playback or episode-range chaining is implemented. Selecting a movie/show card opens the corresponding Jellyfin details page. Season and episode ranges are displayed as labels only. All writes still occur in the existing administrator editor.

Back up plugin configuration and uploaded artwork before installing. A source build is not proof of Jellyfin host or device compatibility.
