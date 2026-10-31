# Franchise Explorer user guide

**Applies to experimental v0.8.9.5 on Jellyfin 12.2.** This guide covers the administrator editor, the Franchises browser, the Jellyfin Web homepage integration, and a practical Marvel Cinematic Universe example. Labels and capabilities may change in future releases.

> [!IMPORTANT]
> Back up Jellyfin and Franchise Explorer's configuration **and uploaded artwork** before experimenting. Franchises are virtual references to existing Jellyfin items; they do **not** move, rename, copy, or delete your media. Chronological playback is experimental and not guaranteed on every Jellyfin client.

## Contents

1. [What the pieces mean](#what-the-pieces-mean)
2. [Install Franchise Explorer and JavaScript Injector](#install-franchise-explorer-and-javascript-injector)
3. [Example: build a Marvel Cinematic Universe franchise](#example-build-a-marvel-cinematic-universe-franchise)
4. [Administrator editor: every control explained](#administrator-editor-every-control-explained)
5. [Artwork and inherited images](#artwork-and-inherited-images)
6. [Add existing Jellyfin media and episode ranges](#add-existing-jellyfin-media-and-episode-ranges)
7. [Set up browse rows and chronological viewing order](#set-up-browse-rows-and-chronological-viewing-order)
8. [Franchises browser and viewer preferences](#franchises-browser-and-viewer-preferences)
9. [Jellyfin homepage and mobile behavior](#jellyfin-homepage-and-mobile-behavior)
10. [Backups, troubleshooting, and current limitations](#backups-troubleshooting-and-current-limitations)

## What the pieces mean

| Term | Purpose | Example |
| --- | --- | --- |
| **Franchise** | Top-level virtual group; displayed in the Franchises browser. | Marvel Cinematic Universe |
| **Subgroup** | A nested virtual group, which can be marked as an Era, Phase, Saga, Character, Collection, or Custom group. | Phase One under Marvel Cinematic Universe |
| **Linked Jellyfin media** | A reference to an existing Jellyfin title or a selected TV show range. The original item stays in its library. | *Agent Carter*, seasons 1–2 |
| **Browse row** | A horizontal presentation row you configure for one franchise or subgroup. | Phases, Collections, Chronological Viewing Order |
| **Chronological / custom viewing order** | A browse row whose titles are ordered for sequential viewing, with separate progress. | A movie followed by selected *Agent Carter* episodes |
| **Continue Your Franchises** | Jellyfin Web homepage card for resuming an active Franchise Explorer watch order. | Next episode and percent complete |

The **Group type** label helps organize browsing; naming a group **Collection** does not create a new native Jellyfin collection.

## Install Franchise Explorer and JavaScript Injector

1. In **Jellyfin Dashboard → Plugins → Repositories**, add the Franchise Explorer catalog URL:

   ```text
   https://raw.githubusercontent.com/Gost1o1/Jellyfin-Franchise-Explorer/main/manifest.json
   ```

2. Add the JavaScript Injector catalog URL as a second repository:

   ```text
   https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/manifest.json
   ```

3. Under **Plugins → Catalog**, install **Franchise Explorer** and a **Jellyfin 12-compatible JavaScript Injector**. Restart the Jellyfin service after installing or updating.
4. In **Dashboard → Plugins → JS Injector**, expand **Plugin Scripts**. Confirm an enabled **Franchise Explorer - My Media tile** script. For v0.8.9.7, its script ID is `jellyfin-franchise-explorer-my-media-v0897`.
5. **Do not manually add a duplicate script** if the plugin-owned one is present. Hard-refresh Jellyfin Web (**Ctrl+Shift+R** on a desktop) after the restart.

The JavaScript Injector companion is required for the **My Media** tile, homepage resume card, and tile menu in Jellyfin Web. The standalone Franchises browser and administrator editor are provided by Franchise Explorer itself. The companion does not add a Franchises category to native TV/mobile applications.

For installation details and troubleshooting, see the [repository README](../README.md#install-or-update).

## Example: build a Marvel Cinematic Universe franchise

You can use a completely different universe; the screenshots below show one personally configured example, **not media or artwork packaged with Franchise Explorer**.

### Step 1 — Create the virtual hierarchy

1. Open **Dashboard → Plugins → Franchise Explorer**.
2. Select **+ New franchise**, then change **Name** to `Marvel Cinematic Universe` and **Group type** to **Franchise**.
3. With it selected, click **+ Subgroup**. Rename the subgroup **Phase One** and change its group type to **Phase**.
4. Select the parent franchise again, then repeat for **Phase Two** through **Phase Six**.
5. Drag groups in the left hierarchy, or use **↑ Move up / ↓ Move down**, to adjust their order. The **Sort position** field is another way to set the relative order.

![Administrator editor with the MCU hierarchy and its six phase subgroups](screenshots/01-franchise-editor.png)

### Step 2 — Add existing titles

1. Select the appropriate phase or other group in **Your franchises**.
2. Open **Browse rows**, add a row with **Movies / TV shows** or **Chronological / custom viewing order**, and expand its media selector.
3. Search your Jellyfin library by title (at least two characters), then select the movies or TV shows for the row.
4. For TV shows, use **Choose TV Show range** if only certain seasons/episodes belong in that group. These links are virtual and do not copy files.

You can also connect an existing Jellyfin collection under **Existing Jellyfin collection**, then optionally **Import collection members** as a one-time snapshot. See [collection controls](#connect-an-existing-jellyfin-collection) below.

### Step 3 — Add artwork

Select the franchise or phase, then scroll to **Edit Images**. Upload a **Primary poster** and (optionally) a **Backdrop**, **Clearlogo**, **Thumb / icon**, and **Banner**. Artwork applied to a phase belongs to that phase; it does not overwrite its parent or the original Jellyfin items. If you do not upload an override, the plugin attempts to inherit images from relevant existing artwork.

### Step 4 — Create separate browse rows

1. Select **Marvel Cinematic Universe** and go to **Browse rows**.
2. Click **Create suggested rows** to generate applicable categories based on your existing groups, or add rows manually:
   - **Phases** → **Subgroups**; tick the six phase groups.
   - **Collections** → **Subgroups**; tick any collection-like subgroups you've created.
   - **Chronological Order** → **Chronological / custom viewing order**; add titles from your full Jellyfin library in the exact order you want to watch them.
3. Use each row's **⠿ drag handle** or **↑ / ↓** controls to set its position. Use the included items' own reorder controls to arrange their sequence.
4. Click **Save plugin configuration** at the **top of the editor**. Most changes are only drafts until this button is clicked.

### Step 5 — See the browsing result

Click **Open Franchises browser** near the editor's top toolbar. Your new franchise should appear on the main Franchises page, with a poster if artwork is available.

![Example Franchises root with available posters (older screenshot includes preferences that have since moved to the editor)](screenshots/02-franchises-library.png)

Click the franchise to see its banner and configured rows.

![Marvel Cinematic Universe detail page with Phases and Collections rows](screenshots/03-marvel-franchise.png)

Scroll to **Chronological Order** to review title order, range labels, and progress. A **Play chronological order** control is available for a populated watch-order row on supported Jellyfin Web installations; test it with a short sample timeline first.

![Chronological order row with films, selected Agent Carter seasons, watched markers, and progress](screenshots/04-chronological-watch-order.png)

### Step 6 — Resume from Jellyfin Web's homepage

After starting a supported chronological watch order, return to Jellyfin Web's homepage. The **Continue Your Franchises** card can show the franchise, current movie/series, next episode, progress, and **Resume Watch Order**.

![Jellyfin homepage with the Franchises tile and an MCU resume card](screenshots/05-jellyfin-home-integration.png)

## Administrator editor: every control explained

Open **Dashboard → Plugins → Franchise Explorer**. This is the **editor**; it is different from the viewer-facing **Franchises browser**.

### Top toolbar

| Control | What it does |
| --- | --- |
| **+ New franchise** | Adds a new top-level group. Rename it in **Group details** and save. |
| **+ Subgroup** | Adds a child under the currently selected group. Useful for an era, phase, saga, or character grouping. |
| **Open Franchises browser ↗** | Opens the separate browsing page, where you can inspect the saved structure and start supported watch orders. |
| **Export backup** | Downloads a JSON snapshot of the virtual configuration to your device. It can contain item IDs; **it does not include uploaded artwork files**. |
| **Import backup** | Loads a compatible JSON backup into the *unsaved* editor workspace. Confirm, review, then **Save plugin configuration** to persist. It replaces your current unsaved workspace, not Jellyfin media. |
| **Discard edits** | Reloads the saved configuration, abandoning unsaved changes after confirmation. |
| **Save plugin configuration** | The primary **top-right** action. Persists virtual groups, row definitions, existing references, and artwork settings. |

### Your franchises (left panel)

| Control | What it does |
| --- | --- |
| **Filter groups** | Searches the existing virtual group hierarchy, not the Jellyfin media library. |
| **Click a franchise/subgroup** | Selects it for editing in the right panel. |
| **Drag above, below, or onto a group** | Reorders sibling groups or nests a group inside another, without moving media. |
| **↑ Move up / ↓ Move down** | Moves the selected group relative to siblings when drag-and-drop is inconvenient. |
| **Delete virtual group** | Removes the selected virtual group after confirmation. It does **not** delete the corresponding movie files, shows, or native Jellyfin collections. Back up before making structural changes. |

### Group details (right panel)

| Field | What it controls |
| --- | --- |
| **Name** | Display title for the selected franchise or subgroup. |
| **Group type** | Semantic category: **Franchise**, **Era**, **Phase**, **Saga**, **Character**, **Collection**, or **Custom**. This is a virtual organization label. |
| **Description** | Optional text shown in the franchise browsing header. |
| **Sort position** | Numeric ordering among sibling groups. Moving or dragging groups can also update order. |
| **Artwork scope message** | Reminds you that uploaded images affect **only the selected group**. |

### Status and preferences (top of editor)

| Control | What it does |
| --- | --- |
| **Playback & Home preferences** | The subtitle and native-row visibility switches are located here, rather than on the franchise browsing page. These changes save immediately in the current browser. |
| **Save plugin configuration** | Persists changes to virtual groups, row definitions, media references, and artwork settings. Watch for the status message near the top of the editor. |
| **No unsaved edits / unsaved indicator** | Helps you tell whether the editor contains uncommitted changes. |

## Artwork and inherited images

The **Edit Images** section has five independent slots:

| Image slot | Intended use |
| --- | --- |
| **Primary poster** | Portrait poster for franchise or subgroup cards. |
| **Backdrop** | Wide background in the franchise detail header. |
| **Clearlogo** | Logo artwork where the UI can use it. |
| **Thumb / icon** | Alternative thumbnail/icon image. |
| **Banner** | Wide banner image. |

For each slot:

1. Click **Upload image** to choose a **JPG, PNG, or WebP** file (up to **8 MB**).
2. The upload becomes a plugin-specific override; it does not overwrite artwork in Jellyfin's original media directories.
3. Click **Restore inherited** to remove that slot's override and let the plugin choose inherited art again. The other four slots are unchanged.
4. Click **Save plugin configuration** to retain the artwork reference.

Inherited artwork may come from the connected Jellyfin collection, a parent group, or linked media. The plugin's automatic fallback depends on what images actually exist and are accessible. **Custom uploads win** over inherited art. Keep a separate backup of the plugin's uploaded-artwork storage; the JSON export is not an image backup.

### Connect an existing Jellyfin collection

In **Existing Jellyfin collection**:

1. Enter part of a collection name in **Find a collection** and click **Find collections**.
2. Select a result to associate the collection with the currently selected virtual group.
3. Choose **Artwork when a collection is connected**:
   - **Preserve current artwork (recommended):** Keep current/inherited artwork priority; the collection is a fallback when necessary.
   - **Use linked collection artwork first:** Prefer artwork from the connected Jellyfin collection, unless you have a custom uploaded override.
4. Optionally click **Import collection members** to create virtual links for its movies/shows. This is a **one-time snapshot**, not continuous sync with future Jellyfin collection edits.
5. **Disconnect collection** removes the collection association; it **does not** automatically delete links already imported from that collection.
6. **Save plugin configuration**.

## Add existing Jellyfin media and episode ranges

The **Browse rows** section associates titles with the selected franchise or subgroup. The older separate **Linked Jellyfin media** search/manual-GUID section is hidden from the editor; existing saved references are preserved.

| Control | What it does |
| --- | --- |
| **Media selector inside a browse row** | Searches the full existing Jellyfin library by title. |
| **Select titles for a row** | Adds existing movies and TV shows as virtual references in that row. |
| **Reorder/remove a row item** | Changes what that row displays, without touching media files. |

For a TV show, the **Choose TV Show range** dialog offers:

| Include option | What it includes |
| --- | --- |
| **Entire TV Show** | All seasons and episodes. |
| **Season to season** | Inclusive range from a starting season to an ending season. |
| **Season/episode to season/episode** | Inclusive boundaries for a precise episode span, including a span that crosses seasons. |

Use season/episode numbers **as Jellyfin lists them**. Specials use **Season 0**. Click **Add to franchise** in the range dialog and then **Save plugin configuration**. Range support in automatic playback is experimental; verify the resulting order before relying on it.

Manual GUID entry is no longer displayed in the main editor. Existing linked GUID references remain stored; the usual workflow is to search Jellyfin titles from a row.

## Set up browse rows and chronological viewing order

Rows are configured **per selected franchise or subgroup** under **Browse rows**. They affect presentation only and do not create real Jellyfin collections or reorder your original library.

### Content types

| Content selector | Displays | Example |
| --- | --- | --- |
| **Subgroups** | Selected immediate child groups. | Phase One through Phase Six |
| **Movies / TV shows** | Selected movie/show/collection cards. | Iron Man, Captain Marvel |
| **Chronological / custom viewing order** | A manually ordered sequence of media references with experimental playback/progress. | MCU chronological watch order |
| **Groups and media** | A combination of selected child groups and media. | Collections plus individual specials |

### Create and edit rows

1. Enter **New row name**, choose **Content**, and click **+ Add custom row**. Or click **Create suggested rows**, which can add applicable Phase/Era/Saga/Collection rows and a **Chronological Viewing Order** row based on your current groups.
2. Use **Row name** to rename it and **Content type** to change what it accepts.
3. For subgroup rows, expand **Choose subgroups from [franchise]** and check the groups you want visible.
4. For media or chronological rows, use **Add from your entire Jellyfin library**. Search for existing titles, use **+ Add** or **Add Selected**, or **Choose TV Show range** for a series. **You do not need to link an item to the main franchise first** to use it in a row.
5. Reorder whole rows with the **⠿** grip or **↑ / ↓**. Reorder items *inside* each row with their own handles/buttons. If an item is a directly added TV series, **Edit range** can update its season/episode selection.
6. Use **×** to remove an entry from a row or **Delete row** to remove the whole presentation row. These actions do not delete media from Jellyfin.
7. Click **Save plugin configuration** before leaving the editor.

**For chronological playback:** Put titles in the exact sequence you intend. **Chronological / custom viewing order** does not automatically research or calculate a universe's canonical timeline. Progress is tracked separately from Jellyfin's regular watched flags; a watched marker in the franchise sequence should not be treated as proof of native Jellyfin watch history.

## Franchises browser and viewer preferences

Click **Open Franchises browser** in the editor, or open the **Franchises** tile in Jellyfin Web's **My Media** section. The browser uses the Jellyfin login already active **on that same server and browser origin**.

To return to **Your franchises** from any franchise or subgroup, click the top-left **F logo** or the **Franchise Explorer** title. Both are one large, keyboard-accessible home link.

| Browser control | Behavior |
| --- | --- |
| **⚙ Settings** | Opens the administrator editor; administration permission is required. |
| **← Jellyfin** | Returns to Jellyfin Web. |
| **↑ Back** / breadcrumbs | Goes up to the parent franchise/group. |
| **Search this level...** | Filters visible entries at the current hierarchy level. It is not a full server search. |
| **Your order** | Uses the custom order saved in the editor. |
| **A to Z** | Alphabetical display order. Opening a franchise resets the selector to **Your order**; you can switch to alphabetical for that browsing session. |
| **☷ List** | Changes how cards are displayed at that level. |
| **Play chronological order** | Starts an experimental sequential watch order for that row. |
| **Episodes & progress** | Opens the timeline entry/progress view when available. |

### Two per-browser viewer preferences

These checkboxes are now located at the top of **Dashboard → Plugins → Franchise Explorer**, under **Playback & Home preferences**. They are no longer displayed on the viewer-facing browsing page.

| Setting | OFF (unchecked) | ON (checked) |
| --- | --- | --- |
| **Enable subtitles during Franchise Explorer playback** | Do not request subtitles from the plugin (default). | Request subtitles during supported plugin playback. Jellyfin client/player settings may override it. |
| **Hide active franchise titles from Continue Watching and Next Up** | Keep active franchise titles in Jellyfin's native homepage rows (default). | Hide the currently active franchise show/movie from those **two** Jellyfin Web rows; leave **Continue Your Franchises** visible. Other unrelated titles remain. |

The second switch is **ON = hide, OFF = show**, exactly as labeled. It is a **display-only** preference stored for the current Jellyfin user and browser; it does not change native watch data and will need to be set again on a different browser/device.

## Jellyfin homepage and mobile behavior

When JavaScript Injector is running the current Franchise Explorer script:

- **My Media → Franchises** opens the standalone browser. The text is centered over dimmed cinematic artwork. On desktop, the tile's three-dot menu appears when you **hover** over or keyboard-focus the tile; on touch screens, the control remains available. Clicking the menu should not itself open the browser.
- Franchise posters show **TV Shows X · Movies Y** counts rather than a generic linked-item total. They count distinct titles, including nested groups and media added to custom rows; collection containers are excluded. The small **Franchise** badge is omitted, while era/phase badges remain.
- **Continue Your Franchises** appears for active supported watch orders and shows the franchise, current title, next episode where available, completion progress, and a resume action.
- On a phone held **vertically**, the resume card prefers the title's **Primary poster** artwork. **Landscape** and desktop display the full wide image without cropping, with a blurred background fill where the image aspect ratio differs from its card. Rotating the phone updates the chosen image without losing the current resume card.
- If you enable the **Hide active franchise titles** viewer preference, the native **Continue Watching** and **Next Up** rows may no longer show the active title, while the franchise resume card remains available.

These features are injected into **Jellyfin Web**. Native Jellyfin Android TV, Roku, Apple TV, and other clients do not necessarily load or support them.

## Backups, troubleshooting, and current limitations

### Back up the right data

1. Click **Export backup** in the editor to save franchise groups, links, and rows as JSON.
2. Separately back up the plugin's uploaded artwork storage and your Jellyfin server configuration. The JSON file **does not include uploaded image bytes**.
3. Before a major restructure, keep a known-working export so you can use **Import backup** and **Save plugin configuration** to recover virtual metadata.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| **No Franchises tile on Home** | Install/enable JavaScript Injector; confirm one current plugin-owned My Media script, restart Jellyfin, hard-refresh the browser. |
| **No homepage resume card** | Start a supported chronological watch order and check that the injected script loaded; not all clients support it. |
| **The three dots are not visible on desktop** | Hover or keyboard-focus the Franchises tile. The control is intentionally hidden at rest. |
| **Cannot find the Hide active titles switch** | Open **Dashboard → Plugins → Franchise Explorer** and look near the top for **Playback & Home preferences**. |
| **An active show disappeared from Continue Watching or Next Up** | Uncheck **Hide active franchise titles from Continue Watching and Next Up** in plugin settings. |
| **The franchise page has an empty row** | Select the correct group in the editor, check that the row includes matching groups/media, then save. An empty row does not imply missing Jellyfin files. |
| **Art is missing or wrong** | Verify the relevant group/slot, inheritance source, and any custom upload. **Restore inherited** affects only that slot. |
| **A backup import did not apply** | Import loads an unsaved workspace; click **Save plugin configuration** after reviewing it. |
| **A web page still shows an old UI** | After deploying a compiled plugin update, restart Jellyfin and hard-refresh the browser. In a developer console, `window.__franchiseExplorerUiVersion` should display `0.8.9.7` for this release. |

### Limitations and safety

- This is unfinished software. Playback chaining, progress and navigation can vary by Jellyfin Web version/client.
- The plugin organizes **references**. It does not import films, download missing media, build a canonical chronological order automatically, or relocate files.
- The JSON backup and the plugin's uploaded images are **separate**. Retain both before upgrading or removing the plugin.
- All group/row/media edits require a final **Save plugin configuration**. Viewer preferences in plugin settings are stored separately in that user's browser.

For release-specific notes, see [v0.8.9.7 upgrade instructions](../Jellyfin-Franchise-Explorer/docs/UPGRADE_V0897.md).
