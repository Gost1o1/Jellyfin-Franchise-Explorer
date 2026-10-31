#!/usr/bin/env python3
"""Guard against placing Franchises options below the My Media artwork."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
script = (root / "src/Jellyfin.Plugin.FranchiseExplorer/Web/franchise-my-media.js").read_text(encoding="utf-8")
service = (root / "src/Jellyfin.Plugin.FranchiseExplorer/Web/HomeTileRegistrationService.cs").read_text(encoding="utf-8")
browser = (root / "scripts/test_my_media_tile_browser.py").read_text(encoding="utf-8")
home_browser = (root / "scripts/test_v0892_home_browser.py").read_text(encoding="utf-8")
browse = (root / "src/Jellyfin.Plugin.FranchiseExplorer/Configuration/browsePage.html").read_text(encoding="utf-8")
config = (root / "src/Jellyfin.Plugin.FranchiseExplorer/Configuration/configPage.html").read_text(encoding="utf-8")

assert "const controlsHost = imageHost || art;" in script
assert "controlsHost.append(controls)" in script
assert "tile.append(controls)" not in script
assert "window.getComputedStyle(controlsHost).position === 'static'" in script
assert script.index("syncNativeInlineStyles(tile, ref);") < script.index("window.getComputedStyle(controlsHost).position === 'static'")
assert "if (!imageHost) controlsHost.style.pointerEvents = 'auto'" in script
assert "bottom:3px" in script and "right:6px" in script
assert "background:transparent;color:white" in script
assert "opacity:0;pointer-events:none;transition:opacity" in script
assert ":hover .fe-settings-toggle" in script
assert ":focus-within .fe-settings-toggle" in script
assert "@media(hover:none), (pointer:coarse)" in script
assert "tile.hover()" in home_browser
assert home_browser.index("tile.hover()") < home_browser.index('tile.locator(".fe-settings-toggle").click()')
assert '.fe-settings-toggle[aria-expanded="true"]' in script
assert 'id="fe-native-rows"' not in browse
assert 'id="fx-hide-native-pref"' in config
assert "hide.checked?'0':'1'" in config
assert "Hide active franchise titles from Continue Watching and Next Up" in config
assert "'fe-show-active-native-rows:'" in script and "'fe-show-active-native-rows:'" in config
assert "itemId: id" in script and "seriesId: item?.Type === 'Episode'" in script
assert "card.classList.toggle(NATIVE_HIDE_CLASS" in script
assert "const image=tile.querySelector(" in browser
assert "holder.parentElement===image" in browser
assert "menu_geometry['bottomGap']" in browser
assert 'CurrentScriptId = "jellyfin-franchise-explorer-my-media-v08912"' in service
assert '"jellyfin-franchise-explorer-my-media-v0894"' in service
assert '"jellyfin-franchise-explorer-my-media-v0893"' in service
assert '"jellyfin-franchise-explorer-my-media-v1"' in service
print('v0.8.9.4 image-anchored menu placement contract passed; browser tests still required.')
