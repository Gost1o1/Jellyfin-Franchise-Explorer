# Franchise Explorer v0.8.9.12 — Direct playback and chronological popup repair

This is a **complete source package**, not a compiled Jellyfin plugin. Run the GitHub Actions release workflow, then install the actual release package via your Jellyfin repository and restart the Jellyfin service.

## What was wrong in v0.8.9.11

The exported JavaScript Injector script showed the new version was loaded. Its direct-playback handoff built an invisible button inside the Jellyfin Home items container, but the button did **not** create Jellyfin Web's required `itemAction` card or provide the media type and server ID. Jellyfin's delegated shortcut handler ignored the click. After 12 seconds, our compatibility route opened Details and clicked Jellyfin's normal Play/Resume button. The chronological modal remained mounted, so it could obscure playback and retain focus. A tracked choice also called the browser's native `confirm()` function.

## Changes

- **Direct Play:** Creates a temporary `.itemAction` card with `data-id`, `data-serverid`, `data-type` (`Movie`/`Episode`), `data-mediatype`, `data-action`, and `data-positionticks`. This matches the action metadata used by Jellyfin Web's native shortcut handler and preserves Jellyfin's own playback / transcoding decision.
- **Restart current viewing:** Dispatches native `play` with `data-positionticks="0"` instead of invoking Resume with Jellyfin's separate saved watched offset. It retains earlier franchise completions.
- **Popup cleanup:** The chronological list closes when a local playback handoff is accepted, before Jellyfin begins video playback. A failed or unsupported shortcut still retains the older details-page compatibility fallback.
- **Watch and track from here:** Uses a centered, keyboard-accessible in-page confirmation instead of the browser's top-anchored `confirm()`.
- **Watch only / No franchise tracking:** Disarms the chronological tracker and does not produce a misleading timeline-verification warning. Jellyfin may continue to save its own normal watched/resume data independently.
- **Other chronological confirmations:** Centered in-page confirmation is used instead of browser-native `confirm()` throughout the timeline dialog.
- **Version migration:** Registers `jellyfin-franchise-explorer-my-media-v08912` and attempts to unregister older plugin-owned IDs (including v08911) after the new script is registered.

## Verification on your server

1. After installing the new compiled plugin, restart Jellyfin and check **Dashboard → Plugins → JavaScript Injector** for the enabled script ID `jellyfin-franchise-explorer-my-media-v08912`.
2. Disable older duplicate Franchise Explorer script registrations if they remain enabled. Keep unrelated user scripts.
3. Hard-refresh your browser and check `window.__franchiseAutoplayBridgeVersion` and `window.FranchiseExplorerNativePlayback?.version` in the developer console. Both should return `0.8.9.12`.
4. Test **Restart current viewing** on a partially watched Agent Carter episode: the player should launch without showing Details, and position should start at 0:00.
5. From the Home card, choose **Select from chronological list → Watch… → Watch only**. The popup should close immediately and video should play without requiring manual dismissal; franchise history should not advance.
6. Try **Watch and track from here**. Its confirmation should be centered. Once video starts, the popup should close and confirmed timeline playback should update the franchise's progress.
7. Confirm **Restart chronological history** still resets that franchise's timeline without navigating away or altering native Jellyfin watched data.

These are **source and offline contract fixes**. Real Jellyfin host/browser testing remains required, especially on versions/themes that change their shortcut delegation or native playback controls.
