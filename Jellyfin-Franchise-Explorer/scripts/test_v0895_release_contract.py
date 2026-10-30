#!/usr/bin/env python3
"""Guard unique release tags and v0.8.9.5 Injector/version migration."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
repo = root.parent
project = root / 'src/Jellyfin.Plugin.FranchiseExplorer'
csproj = (project / 'Jellyfin.Plugin.FranchiseExplorer.csproj').read_text()
service = (project / 'Web/HomeTileRegistrationService.cs').read_text()
script = (project / 'Web/franchise-my-media.js').read_text()
browse = (project / 'Configuration/browsePage.html').read_text()
release = (repo / '.github/workflows/release.yml').read_text()

for field in ('Version', 'AssemblyVersion', 'FileVersion'):
    assert f'<{field}>0.8.9.5</{field}>' in csproj
assert 'CurrentScriptId = "jellyfin-franchise-explorer-my-media-v0895"' in service
assert '"jellyfin-franchise-explorer-my-media-v0894"' in service
assert '["pluginVersion"] = "0.8.9.5"' in service
assert "window.__franchiseExplorerUiVersion = '0.8.9.5'" in script
assert "CACHE_PREFIX = 'fe-franchise-home-v0895:'" in script
assert "widget.setAttribute('data-fe-version','0.8.9.5')" in script
assert "Hide active franchise titles from Continue Watching and Next Up" in browse
assert "$('fe-native-rows').checked=localStorage.getItem(nativeRowPreferenceKey())==='0'" in browse
assert "default: '0.8.9.5'" in release
assert 'gh release view "v${RELEASE_VERSION}"' in release
assert release.index('gh release view "v${RELEASE_VERSION}"') < release.index('dotnet build')
assert 'gh release create "v${RELEASE_VERSION}"' in release
assert '--clobber' not in release
assert 'v0.8.9.5' in (repo / 'README.md').read_text()
assert (root / 'docs/UPGRADE_V0895.md').is_file()
print('v0.8.9.5 release version and duplicate-tag guard contract passed.')
