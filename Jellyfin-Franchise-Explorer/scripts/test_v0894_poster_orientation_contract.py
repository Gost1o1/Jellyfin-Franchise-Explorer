#!/usr/bin/env python3
"""Portrait posters and landscape backdrops share the same home timeline."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
js = (root / "src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js").read_text(encoding="utf-8")
browser = (root / "scripts/test_v0892_home_browser.py").read_text(encoding="utf-8")

assert "(orientation: portrait) and (max-width: 700px)" in js
assert "artworkPortrait:" in js
assert "function posterRoute(item)" in js
assert "item.ImageTags?.Primary" in js
assert "?maxWidth=600" in js
assert "card.artworkPortrait, card.artwork" in js, "Must fall back to landscape artwork"
assert "new Set(candidates.filter(Boolean))" in js
assert "fe-resume-portrait" in js and "object-fit:contain" in js
assert "feArtworkKind = usesPoster ? 'poster' : 'landscape'" in js
assert "window.addEventListener('resize', scheduleMount)" in js
assert "window.addEventListener('orientationchange', scheduleMount)" in js
assert "const signature = JSON.stringify({cards,confirmedEmpty,portrait})" in js
assert '"ImageTags": {"Primary": "poster-tag"}' in browser
assert 'page.set_viewport_size({"width": 950, "height": 430})' in browser
assert 'page.set_viewport_size({"width": 390, "height": 900})' in browser
assert "feArtworkKind === 'poster'" in browser
assert "feArtworkKind === 'landscape'" in browser
print('v0.8.9.4 phone portrait/landscape image selection contract passed.')
