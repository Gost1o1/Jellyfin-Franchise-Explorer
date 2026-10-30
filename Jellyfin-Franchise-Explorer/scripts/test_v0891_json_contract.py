#!/usr/bin/env python3
"""Source contracts for deterministic timeline JSON, beyond Jellyfin MVC defaults.
Does not substitute for compiling on .NET 10 or testing in Jellyfin 12.2.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]/'src/Jellyfin.Plugin.FranchiseExplorer'
controller = (root/'Api/FranchiseTimelineController.cs').read_text()
timeline = (root/'Web/franchise-timeline.js').read_text()
bridge = (root/'Web/franchise-my-media.js').read_text()

assert 'JsonSerializer.Serialize(state, JsonOptions)' in controller
assert '"application/json; charset=utf-8"' in controller
assert 'return TimelineJson(rows.OrderByDescending' in controller
assert 'return TimelineJson(record)' in controller
assert controller.count('return TimelineJson(state)') >= 5
assert 'return Ok(' not in controller
assert "path.startsWith('/FranchiseExplorer/TimelineState')?timelineResponse(value):value" in timeline
assert bridge.count("path.startsWith('/FranchiseExplorer/TimelineState')?timelineResponse(value):value") == 1
# The v0.8.9.2 home viewer uses its own equivalent defensive normalization.
assert "path.startsWith('/FranchiseExplorer/TimelineState')" in bridge
assert "Array.isArray(json) ? json.map(normalize) : normalize(json)" in bridge
print('v0.8.9.1 deterministic API/consumer casing contracts passed.')
