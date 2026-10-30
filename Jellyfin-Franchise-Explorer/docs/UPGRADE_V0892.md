# Franchise Explorer v0.8.9.2 — Homepage resume and settings links

Experimental Jellyfin 12.2 development update. This package is **source code**,
not an installable Jellyfin plugin DLL. Back up your plugin data, configuration,
and artwork before installing a build. The configuration JSON export does
**not** include uploaded image files.

## Improvements

1. Each active, incomplete user timeline appears on Jellyfin Web's homepage as
   a card under "Continue Your Franchises." The display derives its root
   franchise name from the plugin catalog and its next movie or episode from
   that user's permitted Jellyfin item metadata.
2. The card displays show/movie artwork, episode details when available,
   current queue position, completion percentage, and a resume button.
   Artwork is fetched with Jellyfin Web's existing authenticated session; API
   tokens are never added to media image URLs.
3. A MutationObserver reattaches the widget if Jellyfin redraws its home
   screen. User-scoped, session-only display metadata can restore it promptly
   after a full refresh; server timeline state remains authoritative.
4. The virtual My Media Franchises tile has a dedicated three-dot menu with a
   shortcut to Franchise Explorer's configuration page. The browser also has
   a settings button next to its existing Jellyfin and Back navigation.
   Jellyfin's normal administrator permissions still apply.
5. The main GitHub README uses self-contained assets under the repository's
   root docs/ directory instead of a logo in a different project.

## Updating the source

- Upload the **contents** of the version's changed-source ZIP to the matching
  paths at the Git repository root using GitHub Desktop or Git. Do not nest the
  entire ZIP under a new folder.
- The root README.md references docs/Gost1o1-logo.png and
  docs/franchise-explorer-preview.png. Keep both files beside it at those
  paths in the same commit.
- Update .github/workflows/build.yml with the supplied complete version if
  you want the new offline browser checks in GitHub Actions.
- Keep the workflow-managed **root** manifest.json unchanged. Do not upload
  a source ZIP as a plugin. Wait for the build check before a release.
- For an installed build, restart Jellyfin and hard-refresh Jellyfin Web. The
  My Media integration requires a compatible JavaScript Injector; disable a
  duplicate manually pasted script if the plugin registered it automatically.

## Test checklist

- Refresh the Jellyfin homepage and wait for the authenticated state request.
  The card should appear, retain the same franchise, and survive repeated
  frontend redraws without duplicating itself.
- Complete an episode using the already-working v0.8.9.1 chronological player,
  return to the homepage, and confirm the card advances the next item without
  changing Jellyfin's native played flags.
- Start a second franchise watch order. Both unfinished timelines should be
  visible, with their own progress and artwork.
- Open the My Media tile's three-dot menu and the browser header gear. Both
  should navigate to the plugin's Jellyfin administrator configuration page.
- Confirm the README logo and preview render on GitHub.

Offline static tests and GitHub Actions browser mocks do not establish native
player, Android WebView, or remote-client compatibility. Validate a short
watch order first. No media files, Jellyfin collections, or existing franchise
data are moved or rewritten by this UI update.
