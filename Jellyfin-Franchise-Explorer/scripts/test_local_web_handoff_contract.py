#!/usr/bin/env python3
"""CI-safe source contract for the v0.8.3 local Web handoff.
Jellyfin integration and client autoplay still require live testing.
"""
from pathlib import Path
root=Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer'
js=(root/'Web/franchise-timeline.js').read_text()
bridge=(root/'Web/franchise-my-media.js').read_text()
for needle in ("This browser (local playback",'playHere(row,queue,index','homeOnly:true',
               'FranchiseExplorerNativePlayback',"'fe-local-timeline-v1:'",
               'localStorage.setItem(this.handoffKey()',"select.value='__local__'"):
    assert needle in js,needle
for needle in ('confirmLocalTimeline(expectedId)','feLocalTimeline',"sessionId:started.Id",'/Activate','window.__franchiseAutoplayBridgeLoaded',"lastFollowKey",'localStorage.removeItem(intent.key)'):
    assert needle in bridge,needle
assert 'if(!intent.replayOnly)' in bridge
assert 'localVideoAdvancing(videoStart)' in bridge and 'DeviceId' in bridge
assert 'play.click()' in bridge
print('Same-browser native playback and no-false-history source contract passed')
