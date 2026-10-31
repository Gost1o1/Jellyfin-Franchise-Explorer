# Franchises in My Media — optional Jellyfin Web integration

> **EXPERIMENTAL AND UNVERIFIED ON A LIVE JELLYFIN 12.2 SERVER. BACK UP YOUR JELLYFIN CONFIGURATION FIRST.**

## What this does

When the independent **JavaScript Injector** companion is installed, Franchise Explorer v0.7.1 registers a small browser script that adds a new **Franchises** card after your existing libraries in the **My Media** shelf. Clicking it opens `/FranchiseExplorer/Browse` and uses the same franchise groups and art you already configured.

This is a **Web-only visual tile**, not a native library. It does not appear in Jellyfin's library management, change the Contents of Collections, or add a new server-side library to other apps.

## Setup (preferred, no manual JavaScript copying)

1. From the installed Franchise Explorer v0.7 admin editor, **Export backup JSON** and back up the plugin's `franchise-artwork` directory as well as Jellyfin configuration.
2. In **Dashboard → Plugins → Repositories**, add JavaScript Injector's catalog `https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/manifest.json` if not already present. This is third-party software under its own license, not bundled with Franchise Explorer.
3. In **Plugins → Catalog**, install the JavaScript Injector version explicitly compatible with **Jellyfin 12**. Restart your Windows Jellyfin service.
4. Install/update **Franchise Explorer v0.8.9.14** from your existing GitHub plugin repository and restart the Jellyfin service.
5. Hard-refresh Jellyfin Web using `Ctrl+Shift+R` or clear its cached assets; return to Home → **My Media**. A teal Franchises card should appear after the existing library cards.
6. Click the card. It should open the same separate Franchises browser that worked from the plugin's settings page.

If it does not appear, verify Jellyfin logs for `My Media web tile registered` and that JavaScript Injector is active; the registration is optional and fails safely. Modern or translated client layouts may require follow-up work.

### Manual fallback

If the companion is installed but automatic registration fails, prefer fixing the plugin registration and restarting Jellyfin. If using **JavaScript Injector → Add Script** as an emergency manual fallback, paste the contents of `src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-timeline.js` **first**, followed by `src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js` as **one script**, then enable it and hard-refresh. The combined script supports the Home chronological picker; only pasting `franchise-my-media.js` omits that dependency. The tile artwork normally comes from the plugin's own embedded Injector registration. **Disable an unnecessary duplicate manual entry** when automatic registration is restored.

## Responsive behavior

The card uses the first real My Media card to establish its width; its visual artwork matches the measured height of a native My Media tile and resizes when native card dimensions change. It supports click, tap, keyboard Enter, and Space. The separate Franchises browse page retains its responsive TV/desktop/tablet/phone layout from v0.7. Tested with **simulated** web-client markup at 390, 620, 900, 1440 and 1920 pixels; production Jellyfin markup or a television browser may differ. Native Roku, Apple TV and Android TV apps do not load this web script.

## Safety and rollback

- The script does not read server API keys, store user tokens, alter any files, call media-write APIs, or change Jellyfin Home section preferences.
- It injects only one card in the visible My Media row and never rewrites existing media cards.
- To revert the new card, disable the Franchise Explorer entry in JavaScript Injector or uninstall JavaScript Injector, then hard-refresh Jellyfin Web. Your plugin's franchises, custom artwork and links remain intact.
- If a later Jellyfin Web release changes the My Media markup, the tile may stop appearing without damaging any saved franchise configuration.
- Before installing a third-party injector on a production Windows service, make a service/config backup and understand that it changes client-side browser behavior for users of that web UI.

## Advanced: supported menu link remains available

You can still link to the standalone browser via Jellyfin Web `menuLinks`; see `docs/FRANCHISES_NAVIGATION.md`. A menu link is not a native My Media card.
