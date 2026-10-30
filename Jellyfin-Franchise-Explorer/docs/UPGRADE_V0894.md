# Franchise Explorer v0.8.9.4 — My Media options alignment

Experimental Jellyfin 12.2 source release. This is **source code**, not an
installable plugin. Save a backup of your plugin and configuration first.

## Confirmed from live screenshots

- **Working in v0.8.9.3:** The new **Continue Your Franchises** card appears
  with the **Marvel Cinematic Universe** root, **Agent Carter** series artwork,
  an upcoming episode, timeline position, and **Resume Watch Order**.
- **Layout bug:** The Franchises three-dot button appears just **below the
  bottom-right of the artwork**, in the caption area. The matching native
  **Live TV** button is **inside the bottom-right of its artwork**.
- **Cause in source:** The injected options wrapper used `tile.append(controls)`
  on the outer card. That card includes Jellyfin's separate caption below the
  image, so `bottom:9px` positioned the button too low.

## Fix

- Attach the options wrapper to the cloned native image container, making it
  position-relative only when needed. Keep its position at the artwork's
  bottom-right with the same unfilled white-dot treatment as other tiles.
- Keep both **Open Franchises** and **Franchise Explorer Settings** in the
  accessible menu. A click on the dots should open the menu, not browsing.
- Register as `jellyfin-franchise-explorer-my-media-v0894` and, after the new
  registration succeeds, retire only the older plugin-owned `-v0893` and
  `-v1` registrations. No user-created JavaScript Injector scripts are removed.
- Keep the working v0.8.9.3 homepage tracker, timeline data, playback/session
  protections, image loading, and virtual franchise configuration unchanged.
- On phones held vertically, use a series or movie's Jellyfin **Primary**
  portrait poster instead of cropping its horizontal Thumb/Backdrop image.
  Keep the existing horizontal image in landscape and on desktop. If no
  vertical poster is available, retain the horizontal image.
- Re-select artwork after phone rotation without changing watch progress or
  losing the resume control. Images still use authenticated Jellyfin requests;
  authentication tokens are never placed in image URLs.
- Show the My Media three-dot button only while hovered/focused with a mouse
  or keyboard, while leaving it available on touch screens and when its menu
  is expanded.
- Add **Hide active franchise titles from Continue Watching and Next Up** beside
  the Franchise Explorer browser's subtitle checkbox. It defaults to off.
  Turning it on hides only the active watch-order movie or series from the
  two native Jellyfin Web rows (including other episodes of the same series).
  It never changes watched flags or Jellyfin server recommendations. This
  setting is stored per Jellyfin user and per browser, not server-synchronized.

## Upload and verify

1. Extract the ZIP at the GitHub repository root, preserving folders. Do not
   replace the auto-managed `manifest.json` from a source package.
2. Wait for both `build` and `ui-browser` GitHub Actions jobs to pass. The
   browser suite now checks the menu button's geometry against the native
   card **image**, rather than its outer caption-inclusive height. It also
   checks portrait poster selection and landscape fallback on rotation,
   as well as the optional active-title row filtering and hover behavior.
3. Publish/install the experimental v0.8.9.4 plugin using the workflow and
   restart your Jellyfin service. Open **Dashboard → Plugins → JS Injector**
   and verify **one** enabled My Media script shows version `0.8.9.4`.
4. Hard-refresh Jellyfin Web. Hover over the turquoise Franchises artwork and
   check that the dots appear **inside** its lower-right corner (not at rest).
   Check that the tracker below Continue Watching still works. Open
   **Franchises** to try the new native-row visibility checkbox; verify that
   only the active franchise's series/movie disappears from **Continue
   Watching** and **Next Up** when checked.

If you still see the older position, check the current browser script version:

```javascript
window.__franchiseExplorerUiVersion
document.querySelector('#franchise-explorer-my-media-tile')?.dataset.feVersion
```

Both should read `0.8.9.4`. Live Jellyfin and all native clients still need
verification; UI mocks alone cannot establish compatibility.
