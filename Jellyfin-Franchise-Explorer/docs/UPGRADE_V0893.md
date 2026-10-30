# Franchise Explorer v0.8.9.3 — JavaScript Injector migration and homepage reliability

Experimental Jellyfin 12.2 development source package, **not an installable
DLL**. Back up the Jellyfin plugin folder and Franchise Explorer data/artwork.

## Why this version

The server's JavaScript Injector page reported the v0.8.9.2 script, yet the
Jellyfin homepage still showed the *old* compact "Chronological Order" card
and the Franchises tile's three-dot menu was missing. The old UI does not
match the JavaScript supplied with v0.8.9.2. This points to a stale injection
or browser script, but the precise live-server cause is not yet confirmed.

## Changes

1. Register a version-specific Injector script ID
   `jellyfin-franchise-explorer-my-media-v0893`. Only after successful
   registration, ask JavaScript Injector to remove the *exact* legacy ID
   `jellyfin-franchise-explorer-my-media-v1`. Do not delete user scripts.
2. Mark the current JavaScript, the My Media tile and the home tracker with
   `0.8.9.3` for direct version diagnostics.
3. The home tracker keeps its previously loaded franchise cards during
   transient network/API errors. While resolving a session or initial state,
   show a loading placeholder; remove the section only when the server
   explicitly confirms there are no active watch orders.
4. Strengthen tile settings controls and present both **Open Franchises** and
   **Franchise Explorer Settings** under the three-dot button. The main tile
   continues to open browsing; the dedicated browser header still has Settings.
5. Preserve v0.8.9.1 completion safeguards, per-user timeline history,
   virtual-only media references, poster overrides, and the My Media native
   layout sizing. No playlist/media/watch-history rewrite is involved.

## Installation

1. Upload the ZIP **contents** at the Git repository root, preserving the
   directory structure, then wait for **both** `build` and `ui-browser` jobs.
2. Do not overwrite `manifest.json` yourself. The manual prerelease workflow
   publishes a compiled ZIP and updates that catalog entry when authorized.
3. Confirm both Jellyfin plugin repositories and their **manifest.json URLs**
   from the root [README](../../README.md), then install/update the two
   plugins. Restart the Windows Jellyfin service.
4. In **Dashboard → Plugins → JS Injector**, check **Plugin Scripts**: expect
   one enabled `Franchise Explorer - My Media tile` script, version `0.8.9.3`,
   ID `jellyfin-franchise-explorer-my-media-v0893`. If the old `-v1` copy
   remains, verify the new version is loaded before removing the older entry.
5. In Jellyfin Web, press **Ctrl+Shift+R** (or open a private browser window).
   Verify the redesigned **Continue Your Franchises** cards have a franchise
   name, movie/series, artwork, next episode when applicable, and progress.
   Open the Franchises tile's three-dot options, then the Settings shortcut.

## Diagnosing an old-looking homepage

In the same browser window, open DevTools → Console and run:

```javascript
window.__franchiseExplorerUiVersion
document.querySelector('#franchise-explorer-my-media-tile')?.dataset.feVersion
document.querySelector('#franchise-timeline-resume')?.dataset.feVersion
```

Expect `0.8.9.3` for each rendered element. If the version is missing or old,
check the installed DLL and Injector **Plugin Scripts** registration before
investigating watch-order state. Check the console for a
`[Franchise Explorer 0.8.9.3]` HTTP error if the new tracker remains loading.
Never paste API tokens or server credentials into bug reports.

## Live test still required

Offline scripts cannot establish what a real Jellyfin 12.2 web instance
loads after upgrading. Test a short timeline, refresh repeatedly, verify the
tile menu and multi-franchise cards, and ensure playback auto-next only
advances after an actual completed item.
