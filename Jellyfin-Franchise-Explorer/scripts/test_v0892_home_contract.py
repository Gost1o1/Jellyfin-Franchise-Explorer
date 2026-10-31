#!/usr/bin/env python3
"""Static contract for v0.8.9.2; CI also runs a real browser mock."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "src/Jellyfin.Plugin.FranchiseExplorer"
JS = (PROJECT / "Web/franchise-my-media.js").read_text(encoding="utf-8")
BROWSE = (PROJECT / "Configuration/browsePage.html").read_text(encoding="utf-8")
README = (ROOT.parent / "README.md").read_text(encoding="utf-8")
CS = (PROJECT / "Jellyfin.Plugin.FranchiseExplorer.csproj").read_text(encoding="utf-8")

assert "<Version>0.8.9.6</Version>" in CS
assert "Continue Your Franchises" in JS
for marker in (
    "sessionStorage.getItem", "sessionStorage.setItem", "MutationObserver",
    "scheduleMount", "authenticatedArtwork", "URL.revokeObjectURL",
    "Marvel",  # only sample text must be in docs, not the hardcoded dashboard
):
    if marker == "Marvel":
        assert "Marvel Cinematic Universe" not in JS, "Franchise title must come from server catalog."
    else:
        assert marker in JS, marker
assert "FranchiseExplorer/Catalog" in JS
assert "FranchiseExplorer/TimelineState" in JS
assert "completedKeys" in JS
assert "queueKeys" in JS
assert "SeriesName" in JS
assert "Images/Thumb" in JS
assert "configurationpage?name=Franchise%20Explorer" in JS
assert 'id="fe-config-settings"' in BROWSE
assert "configurationpage?name=Franchise%20Explorer" in BROWSE
assert "src=\"docs/Gost1o1-logo.png\"" in README
assert "docs/franchise-explorer-preview.png" in README
for name in ("Gost1o1-logo.png", "franchise-explorer-preview.png"):
    file = ROOT.parent / "docs" / name
    assert file.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n", name

print("v0.8.9.2 home/menu/README static contract passed.")
