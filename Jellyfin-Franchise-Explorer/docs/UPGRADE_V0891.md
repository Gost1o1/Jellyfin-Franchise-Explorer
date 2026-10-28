# Franchise Explorer v0.8.9.1 — Timeline JSON response fix

This is **changed source**, not a compiled Jellyfin plugin ZIP or a release.
Source was based on the live `main` repository after v0.8.9.0 and excludes
the workflow-generated `manifest.json` from the upload.

## Why this version is necessary

The real Jellyfin 12.2 server recorded Captain America as completed and saved
`Index=1`, `Total=422`, one `CompletedKeys` entry, and a fresh pending next-item
marker. Yet the browser still displayed 0% and did not begin the next episode.

The authenticated API returned PascalCase property names; all browser state
readers expected camelCase. The server now emits camelCase explicitly for
timeline data, and the browser tolerates either case. The first completion is
roughly **0.24%**, separate from Jellyfin's native Watched status.

## Upload instructions

1. Extract the changed-source ZIP. Upload its contents at the original
   repository-relative paths. Do not upload the ZIP file itself or overwrite
   the live root `manifest.json`.
2. Manually replace the **full contents** of the root
   `.github/workflows/build.yml` and `.github/workflows/release.yml` using
   the two separately supplied complete files. GitHub web upload cannot
   directly handle the hidden `.github` folder in this workflow.
3. Wait for both `build` and `ui-browser` jobs to pass, including the new
   v0.8.9.1 tests. Never publish a release if either job fails.
4. With explicit approval, run the guarded experimental release workflow for
   `0.8.9.1` (confirm `RELEASE_EXPERIMENTAL`). Verify catalog manifest and
   compiled release archive before installing the update.

## Real-server test

- Back up plugin configuration, artwork overrides and per-user
  `timeline-progress` records before updating. Never move/delete original media.
- Verify the loaded Jellyfin plugin assembly version is `0.8.9.1`.
- In the browser, confirm the saved Chronological Order progress is now about
  **0.24% (1/422)**. This is a read-only check: **do not** restart the whole
  Marvel timeline merely to test the display.
- The old completion marker is now expired by design; refreshing cannot
  retroactively start Agent Carter. Use **Resume timeline** to begin Agent
  Carter S1E1, or test automatic movie-to-episode handoff on a separate short
  timeline. Do not erase completed history for a regression test.
- When a newly played item completes, verify the server writes its completed
  key and pending marker, the browser receives camelCase fields, and the next
  exact episode begins automatically without manual Play.
- Check Replay only, unrelated playback, user separation, and refresh/restart
  persistence remain safe. Native/remote players may require separate support.

**Not yet claimed fixed on the real server:** The automated browser test mocks
Jellyfin Web's navigation lifecycle, and compilation is done by GitHub Actions.
