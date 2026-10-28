# Franchise Explorer v0.8.9.0 — experimental timeline reliability

This is a source update. It is **not** the compiled Jellyfin plugin ZIP and is
not a release. Keep your current v0.8.8 installation until GitHub Actions
passes, the experimental build is deliberately published, and you back up the
plugin's configuration, artwork overrides and `timeline-progress` directory.

## GitHub upload process

1. Upload only the changed source files from the accompanying source ZIP at
   their existing repository-relative paths. Keep the top-level directory
   `Jellyfin-Franchise-Explorer/`. Do not upload the generated manifest.
2. Edit `.github/workflows/build.yml` and `.github/workflows/release.yml`
   **manually** on GitHub using the separately supplied complete replacement
   YAML files. These files belong at the repository root.
3. Run GitHub Actions **Build and validate** and confirm both `build` and
   `ui-browser` jobs pass, including new v0.8.9 test commands. Do not publish
   if a job fails, the source upload is incomplete, or version checks fail.
4. Only after you approve, use the manual experimental release workflow with
   version `0.8.9.0` and confirmation `RELEASE_EXPERIMENTAL`. Verify the tag,
   release DLL ZIP, checksum and catalog `manifest.json` before installation.

## First real-server acceptance test

1. Back up plugin configuration, custom artwork files and `timeline-progress`
   separately. Back up is not included in a configuration JSON export.
2. Install through your existing Jellyfin plugin catalog, restart, confirm
   active assembly version **0.8.9.0** in the Jellyfin log.
3. Create or use a short test timeline **movie -> one TV episode -> movie**.
   Do not start with the full 422-item Marvel queue.
4. Click **Play from beginning** in this browser. Confirm the plugin's per-user
   timeline state is `armed`, then `playing` with a real `sessionId`. The log
   should report `armed timeline activated by server playback` for the row.
5. Let the movie play naturally through the end. Verify `completedKeys`,
   `index`, `pendingAutoAdvanceUtc` and a `timeline completion saved` log.
   The browser should start the next **actual episode** without manual Play.
6. Check manual Stop, Replay only, refresh/restart persistence and unrelated
   playback do not create completion records or redirect unexpectedly.

If completion still does not persist, look for the new log summary:

- `validRows=0`: likely missing progress JSON or invalid row association.
- `playingRows=0`: Play intent was not armed or activated (or expired).
- `matchingSessions=0`: active state exists, but a different Jellyfin session
  reported completion.
- `matchingItems=0`: the active session played a different item from the queue.

These are **diagnostics**, not proof that automatic continuation is fixed.
Do not change folders named `Season 01`: Jellyfin episode metadata determines
the watch order, not the folder name.
