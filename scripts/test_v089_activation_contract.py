#!/usr/bin/env python3
"""Static server contracts for v0.8.9; .NET build and live Jellyfin still required."""
from pathlib import Path

project = Path(__file__).resolve().parents[1] / 'src/Jellyfin.Plugin.FranchiseExplorer'
controller = (project / 'Api/FranchiseTimelineController.cs').read_text()
monitor = (project / 'Web/TimelinePlaybackMonitorService.cs').read_text()
bridge = (project / 'Web/franchise-my-media.js').read_text()

for marker in (
    'PlaybackMode == "armed"', 'RecentlyArmed(progress)',
    'CurrentItemMatches(progress, itemId)', 'activePlaybackEvent',
    'progress.SessionId = sessionId', 'state.ArmedUtc = null',
    '[HttpPost("{rowId:guid}/Activate")]', 'ConfirmLocalActivation',
    'completed playback did not advance a timeline',
    'await WriteProgressAsync(path, progress, cancellationToken)',
):
    assert marker in controller, marker
assert 'Dispatch(args, false, true)' in monitor
assert 'Dispatch(args, completed, false)' in monitor
assert "/Activate',auth" in bridge
assert 'serverState.playbackMode' not in bridge  # No recovery PUT of stale snapshots.
assert 'for(let i=state.index;i<current;i++)' not in bridge  # No skipped-title auto-completion.
print('v0.8.9 server activation and no-clobber contracts passed.')
