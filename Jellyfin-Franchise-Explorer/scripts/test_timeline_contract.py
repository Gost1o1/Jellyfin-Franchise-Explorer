#!/usr/bin/env python3
"""Static lifecycle / storage checks; not a substitute for C# compilation."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer'
controller=(root/'Api/FranchiseTimelineController.cs').read_text()
listener=(root/'Web/TimelinePlaybackMonitorService.cs').read_text()
reg=(root/'Web/HomeTileRegistrationService.cs').read_text()
browse=(root/'Configuration/browsePage.html').read_text()
api=(root/'Api/FranchiseBrowseController.cs').read_text()
script=(root/'Web/franchise-timeline.js').read_text()
assert 'Jellyfin-UserId' in controller and '[Authorize]' in controller
assert 'timeline-progress' in controller and 'WriteLock' in controller
assert 'RecordPlaybackAsync' in controller and 'PlaybackMode != "playing"' in controller
assert 'PlaybackStart +=' in listener and 'PlaybackProgress +=' in listener and 'PlaybackStopped +=' in listener
assert 'PendingAutoAdvanceUtc' in controller and 'ConfirmLocalCompletion' in controller
assert 'pendingAutoAdvanceUtc' in (root/'Web/franchise-my-media.js').read_text()
assert 'TimelinePlaybackMonitorService' in reg
assert 'HttpGet("TimelineClient.js")' in api
assert 'EmbeddedResource Include="Web/franchise-timeline.js"' in (root/'Jellyfin.Plugin.FranchiseExplorer.csproj').read_text()
assert 'TimelineClient.js' in browse and 'FranchiseTimeline.TimelineManager' in browse
for text in ('Play chronological order','Replay only','Restart timeline here','queueSourceItemIds','getEpisodes','playCommand='):
    assert text in script,text
print('Timeline storage, event lifecycle and responsive UI static contracts passed.')
