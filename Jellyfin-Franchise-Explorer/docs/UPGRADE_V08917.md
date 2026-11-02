# Franchise Explorer v0.8.9.17 — Import destination and browse-row assignments

Experimental update for Jellyfin 12.2. Back up your plugin configuration and uploaded artwork before installing. No native media files or Jellyfin collection members are modified by these controls.

## What's new

1. **Choose a destination for collection imports:** Select a franchise or subgroup in the editor, connect an existing Jellyfin collection, then choose **Import members into group** before clicking **Import collection members**. The collection's artwork association stays on the group where you connected it; only the new virtual media references go to the chosen destination group.
2. **Move existing virtual references:** In **Manage imported virtual references**, expand **View and remove individual virtual references** and choose **Assign to group** for any title. Only groups within the same top-level franchise are offered. The link disappears from the source group's list and appears under the destination group. Valid ancestor-row references stay intact; incompatible old-subgroup row references are removed.
3. **See and edit row membership:** Under each reference, **Rows using this reference** shows the rows linking that exact reference. **Same title added separately in** identifies independent library-search entries that do not count as this reference's assignment. Expand **Show in browse rows** and tick or untick compatible browse rows to attach or detach the virtual reference. If the same title was separately added to a row, the editor warns that it may appear twice.
4. **Unassigned shelf accuracy:** Only rows capable of showing media in the currently selected group count as assignments for the **Remove unassigned references** button. Merely moving a link into a group with custom rows does not automatically choose a row in that group.

After changes, click **Save plugin configuration** at the top of the editor. Importing remains a one-time snapshot, not synchronization; disconnecting/deleting the original Jellyfin collection still does not delete imported references.

## Install / verify

1. Publish a new version **0.8.9.17** from the completed source (do not try to overwrite the v0.8.9.16 release tag).
2. Install the compiled plugin release via Jellyfin's plugin catalog and restart the server. The optional JavaScript Injector script ID becomes `jellyfin-franchise-explorer-my-media-v08917`; the plugin attempts to retire the previous plugin-owned v08916 entry.
3. Hard-refresh Jellyfin Web. Open the plugin editor, select a franchise, connect a test collection, and import a couple of titles into a subgroup.
4. Change one title's group, tick a compatible browse row, and verify that **Rows using this reference** updates. Check the corresponding browser shelf. Click Save, reload the editor and verify the assignment persisted.
5. Confirm the previously working German-language Franchises tile, subtitle preference, chronological viewing order, and homepage resume card still behave as expected.

The Node/static regression suite covers destination filtering, cross-franchise isolation, duplicate-link prevention, compatible row retention and browse-row assignments. These offline checks do not replace real Jellyfin Web and playback verification.
